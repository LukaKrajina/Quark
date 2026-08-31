<<<<<<< HEAD
#pragma once
#include "IQuantumBackend.hpp"
#include <cstddef>
#include <iostream>
#include <vector>
#include <cmath>
#include <complex>
#include <mutex>
#include <stdexcept>

#if defined(__linux__) || defined(__APPLE__)
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <sys/ioctl.h>
#define HAS_POSIX_MMAP 1
#define HARDWARE_HOST_MODE 1
#ifndef MAP_FAILED
#define MAP_FAILED ((void *)-1)
#endif
#else
#define HAS_POSIX_MMAP 0
#define HARDWARE_HOST_MODE 0
#define MAP_FAILED nullptr

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#endif
#include <cstdlib>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#include <winsock2.h>
#endif

#ifndef START_DMA_TRANSACTION
#define START_DMA_TRANSACTION 0x444D4101
#endif

#ifndef FETCH_ADC_TRANSACTION
#define FETCH_ADC_TRANSACTION 0x444D4102
#endif

namespace qhal
{

    struct MicrowavePulse
    {
        double frequency_ghz;
        double duration_ns;
        std::vector<std::complex<double>> envelope_iq;
    };

    struct MLStateClassifier
    {
    private:
        const double SVM_WEIGHT_I = 0.5;
        const double SVM_WEIGHT_Q = -0.35;
        const double SVM_BIAS = -0.12;

    public:
        int predict(const std::vector<std::complex<double>> &trajectory)
        {
            if (trajectory.empty())
                return 0;
            double sum_i = 0.0;
            double sum_q = 0.0;

            for (const auto &sample : trajectory)
            {
                sum_i += sample.real();
                sum_q += sample.imag();
            }

            double avg_i = sum_i / trajectory.size();
            double avg_q = sum_q / trajectory.size();

            double decision_value = (avg_i * SVM_WEIGHT_I) + (avg_q * SVM_WEIGHT_Q) + SVM_BIAS;

            return (decision_value > 0.0) ? 1 : 0;
        }
    };

    class SuperconductingBackend : public IQuantumBackend
    {
    private:
        std::mutex dac_mutex;
        size_t active_qubits = 0;
        std::vector<double> virtual_z_phases;
        std::vector<bool> is_qubit_allocated;
        std::vector<bool> is_qubit_locked;
        const size_t DMA_BUFFER_SIZE = 512 * 1024;

        // Linux-only bare-metal variables
        int dma_fd = -1;
        void *dma_buffer_ptr = MAP_FAILED;

        // Windows-only networking variables
        std::string host_server_ip = "192.168.1.100";
        int host_port = 50051;

        const double ANHARMONICITY_GHZ = -0.3;
        const double PI = M_PI;

        MLStateClassifier ml_classifier;

#if HARDWARE_HOST_MODE == 0
        void Network_SendPayload(const std::string &ip, int port, const MicrowavePulse &pulse)
        {
            WSADATA wsaData;
            if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0)
            {
                std::cerr << "[QHAL Client ERROR] Winsock initialization failed.\n";
                return;
            }

            SOCKET connectSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
            if (connectSocket == INVALID_SOCKET)
            {
                std::cerr << "[QHAL Client ERROR] Socket creation failed.\n";
                WSACleanup();
                return;
            }

            sockaddr_in serverAddress;
            serverAddress.sin_family = AF_INET;
            serverAddress.sin_port = htons(port);
            inet_pton(AF_INET, ip.c_str(), &serverAddress.sin_addr);

            if (connect(connectSocket, (SOCKADDR *)&serverAddress, sizeof(serverAddress)))
            {
                std::cerr << "[QHAL Client ERROR] Connection to server failed.\n";
                closesocket(connectSocket);
                WSACleanup();
                return;
            }

            send(connectSocket, reinterpret_cast<const char *>(&pulse.frequency_ghz), sizeof(pulse.frequency_ghz), 0);
            send(connectSocket, reinterpret_cast<const char *>(&pulse.duration_ns), sizeof(pulse.duration_ns), 0);

            size_t envelope_size = pulse.envelope_iq.size();
            send(connectSocket, reinterpret_cast<const char *>(&envelope_size), sizeof(size_t), 0);
            size_t bytes_to_send = envelope_size * sizeof(std::complex<double>);
            send(connectSocket, reinterpret_cast<const char *>(pulse.envelope_iq.data()), bytes_to_send, 0);

            std::cout << "[QHAL Client] Successfully dispatched " << bytes_to_send
                      << " bytes of microwave envelope data to " << ip << "\n";

            closesocket(connectSocket);
            WSACleanup();
        }

        std::vector<std::complex<double>> Network_ReceivePayload(const std::string &ip, int port)
        {
            WSADATA wsaData;
            WSAStartup(MAKEWORD(2, 2), &wsaData);

            SOCKET connectSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);

            sockaddr_in serverAddress;
            serverAddress.sin_family = AF_INET;
            serverAddress.sin_port = htons(port);
            inet_pton(AF_INET, ip.c_str(), &serverAddress.sin_addr);

            if (connect(connectSocket, (SOCKADDR *)&serverAddress, sizeof(serverAddress)) == SOCKET_ERROR)
            {
                std::cerr << "[QHAL Client ERROR] Failed to connect for ADC retrieval.\n";
                closesocket(connectSocket);
                WSACleanup();
                return std::vector<std::complex<double>>();
            }

            char fetch_command = 0x01;
            send(connectSocket, &fetch_command, 1, 0);

            size_t incoming_samples = 0;
            recv(connectSocket, reinterpret_cast<char *>(&incoming_samples), sizeof(size_t), MSG_WAITALL);

            std::vector<std::complex<double>> trajectory(incoming_samples);
            size_t bytes_to_receive = incoming_samples * sizeof(std::complex<double>);

            int bytes_received = recv(connectSocket, reinterpret_cast<char *>(trajectory.data()), bytes_to_receive, MSG_WAITALL);

            if (bytes_received > 0)
            {
                std::cout << "[QHAL Client] Successfully received " << incoming_samples
                          << " digitized IQ samples from the Linux Host.\n";
            }

            closesocket(connectSocket);
            WSACleanup();

            return trajectory;
        }
#endif

        std::vector<std::complex<double>> fetch_adc_buffer(const size_t adc_read_samples)
        {
            std::lock_guard<std::mutex> lock(dac_mutex);
            std::vector<std::complex<double>> trajectory(adc_read_samples);
#if HARDWARE_HOST_MODE && HAS_POSIX_MMAP
            if (dma_buffer_ptr == MAP_FAILED)
            {
                throw std::runtime_error("[QHAL FATAL] DMA Buffer not initialized for ADC fetch.");
            }
            ioctl(dma_fd, FETCH_ADC_TRANSACTION, adc_read_samples * sizeof(std::complex<double>));
            auto *mapped_array = static_cast<std::complex<double> *>(dma_buffer_ptr);
            for (size_t i = 0; i < adc_read_samples; ++i)
            {
                trajectory[i] = mapped_array[i];
            }
#else
            std::cout << "[QHAL Client] Awaiting ADC trajectory from Linux Host...\n";
            trajectory = Network_ReceivePayload(host_server_ip, host_port);
#endif

            return trajectory;
        }

        void dispatch_to_fpga(const MicrowavePulse &pulse)
        {
            std::lock_guard<std::mutex> lock(dac_mutex);
            if (dma_buffer_ptr == MAP_FAILED)
            {
                throw std::runtime_error("DMA Buffer not initialized.");
            }

#if HARDWARE_HOST_MODE && HAS_POSIX_MMAP
            auto *mapped_array = static_cast<std::complex<double> *>(dma_buffer_ptr);
            for (size_t i = 0; i < pulse.envelope_iq.size(); ++i)
            {
                mapped_array[i] = pulse.envelope_iq[i];
            }
            ioctl(dma_fd, START_DMA_TRANSACTION, pulse.envelope_iq.size() * sizeof(std::complex<double>));
#else
            std::cout << "[QHAL Client] Serializing microwave pulse...\n";
            std::cout << "[QHAL Client] Sending pulse via TCP/IP to Linux Host at "
                      << host_server_ip << ":" << host_port << "\n";

            Network_SendPayload(host_server_ip, host_port, pulse);
#endif
        }

        MicrowavePulse synthesize_drag_pulse(double amp, double duration_ns)
        {
            MicrowavePulse pulse;
            pulse.frequency_ghz = 5.0;
            pulse.duration_ns = duration_ns;

            size_t samples = static_cast<size_t>(duration_ns);
            pulse.envelope_iq.resize(samples);

            double sigma = duration_ns / 4.0;
            double mu = duration_ns / 2.0;

            for (size_t t = 0; t < samples; ++t)
            {
                double time = static_cast<double>(t);
                double gauss = amp * std::exp(-0.5 * std::pow((time - mu) / sigma, 2));
                double d_gauss = -(time - mu) / (sigma * sigma) * gauss;
                double quad = d_gauss / (2.0 * PI * ANHARMONICITY_GHZ);
                pulse.envelope_iq[t] = std::complex<double>(gauss, quad);
            }
            return pulse;
        }

        void update_nco_phase(size_t qubit_id, double angle)
        {
            std::lock_guard<std::mutex> lock(dac_mutex);
            if (qubit_id >= virtual_z_phases.size())
            {
                return;
            }
            virtual_z_phases[qubit_id] += angle;
            virtual_z_phases[qubit_id] = std::fmod(virtual_z_phases[qubit_id], 2.0 * PI);
            if (virtual_z_phases[qubit_id] < 0)
            {
                virtual_z_phases[qubit_id] += 2.0 * PI;
            }
        }

        void apply_ecr(size_t control, size_t target)
        {
            MicrowavePulse cr_pos = synthesize_drag_pulse(0.5, 100.0);
            dispatch_to_fpga(cr_pos);
            apply_x(control);
            MicrowavePulse cr_neg = synthesize_drag_pulse(-0.5, 100.0);
            dispatch_to_fpga(cr_neg);
            apply_x(control);
        }

    public:
        SuperconductingBackend()
        {
#if HEADWARE_HOST_MODE && HAS_POSIX_MMAP
            dma_fd = open("/dev/udmabuf0", O_RDWR | O_SYNC);
            if (dma_fd >= 0)
            {
                dma_buffer_ptr = mmap(NULL, DMA_BUFFER_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, dma_fd, 0);
            }
#else
            std::cout << "[QHAL] Booting in CLIENT mode. Establishing connection to Quantum Server...\n";
            dma_buffer_ptr = std::malloc(DMA_BUFFER_SIZE);
#endif
        }

        ~SuperconductingBackend() override
        {
#if HAS_POSIX_MMAP
            if (dma_buffer_ptr != MAP_FAILED)
            {
                munmap(dma_buffer_ptr, DMA_BUFFER_SIZE);
            }
            if (dma_fd >= 0)
            {
                close(dma_fd);
            }
#else
            if (dma_buffer_ptr && dma_buffer_ptr != MAP_FAILED)
            {
                std::free(dma_buffer_ptr);
            }
#endif
        }

        void allocate_qubits(size_t num_qubits) override
        {
            std::lock_guard<std::mutex> lock(dac_mutex);
            active_qubits = num_qubits;
            virtual_z_phases.resize(num_qubits, 0.0);
            is_qubit_allocated.resize(num_qubits, true);
            is_qubit_locked.resize(num_qubits, false);
        }

        void release_qubit(size_t qubit_id) override 
        {
            if (qubit_id >= is_qubit_allocated.size()) return;
            if (is_qubit_locked[qubit_id]) {
                throw std::runtime_error("Lifecycle Error: Cannot release a locked qubit.");
            }
            is_qubit_allocated[qubit_id] = false;
        }

        void lock_hardware_id(size_t qubit_id) override 
        {
            if (is_qubit_locked[qubit_id]) {
                throw std::runtime_error("Concurrency Error: Qubit already locked.");
            }
            is_qubit_locked[qubit_id] = true;
        }

        void unlock_hardware_id(size_t qubit_id) override 
        {
            is_qubit_locked[qubit_id] = false;
        }

        int measure(size_t qubit_id) override
        {
            MicrowavePulse readout_pulse = synthesize_drag_pulse(1.0, 500.0);
            dispatch_to_fpga(readout_pulse);
            std::vector<std::complex<double>> adc_trajectory = fetch_adc_buffer(500);
            int classified_state = ml_classifier.predict(adc_trajectory);

            return classified_state;
        }

        void apply_x(size_t qubit_id) override
        {
            MicrowavePulse x_pulse = synthesize_drag_pulse(1.0, 20.0);
            dispatch_to_fpga(x_pulse);
        }

        void apply_rz(size_t qubit_id, double angle) override
        {
            // Z-gates are typically implemented virtually in software by shifting the reference frame
            // of the FPGA numerically controlled oscillator (NCO) phases. [1, 15]
            update_nco_phase(qubit_id, angle);
        }

        void apply_cnot(size_t control, size_t target) override
        {
            apply_rz(control, -PI / 2);
            apply_x(target);
            apply_ecr(control, target);
            apply_x(target);
        }

        void apply_toffoli(size_t control1, size_t control2, size_t target) override
        {
            apply_rz(target, PI / 4);
            apply_cnot(control2, target);
            apply_rz(target, -PI / 4);
            apply_cnot(control1, target);
            apply_rz(target, PI / 4);
            apply_cnot(control2, target);
            apply_rz(target, -PI / 4);
            apply_cnot(control1, target);
            apply_rz(control2, PI / 4);
            apply_cnot(control1, control2);
            apply_rz(control1, PI / 4);
            apply_rz(control2, -PI / 4);
            apply_cnot(control1, control2);
        }
    };
=======
#pragma once
#include "IQuantumBackend.hpp"
#include <cstddef>
#include <iostream>
#include <vector>
#include <cmath>
#include <complex>
#include <mutex>
#include <stdexcept>

#if defined(__linux__) || defined(__APPLE__)
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <sys/ioctl.h>
#define HAS_POSIX_MMAP 1
#define HARDWARE_HOST_MODE 1
#ifndef MAP_FAILED
#define MAP_FAILED ((void *)-1)
#endif
#else
#define HAS_POSIX_MMAP 0
#define HARDWARE_HOST_MODE 0
#define MAP_FAILED nullptr

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#endif
#include <cstdlib>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#include <winsock2.h>
#endif

#ifndef START_DMA_TRANSACTION
#define START_DMA_TRANSACTION 0x444D4101
#endif

#ifndef FETCH_ADC_TRANSACTION
#define FETCH_ADC_TRANSACTION 0x444D4102
#endif

namespace qhal
{

    struct MicrowavePulse
    {
        double frequency_ghz;
        double duration_ns;
        std::vector<std::complex<double>> envelope_iq;
    };

    struct MLStateClassifier
    {
    private:
        const double SVM_WEIGHT_I = 0.5;
        const double SVM_WEIGHT_Q = -0.35;
        const double SVM_BIAS = -0.12;

    public:
        int predict(const std::vector<std::complex<double>> &trajectory)
        {
            if (trajectory.empty())
                return 0;
            double sum_i = 0.0;
            double sum_q = 0.0;

            for (const auto &sample : trajectory)
            {
                sum_i += sample.real();
                sum_q += sample.imag();
            }

            double avg_i = sum_i / trajectory.size();
            double avg_q = sum_q / trajectory.size();

            double decision_value = (avg_i * SVM_WEIGHT_I) + (avg_q * SVM_WEIGHT_Q) + SVM_BIAS;

            return (decision_value > 0.0) ? 1 : 0;
        }
    };

    class SuperconductingBackend : public IQuantumBackend
    {
    private:
        std::mutex dac_mutex;
        size_t active_qubits = 0;
        std::vector<double> virtual_z_phases;
        std::vector<bool> is_qubit_allocated;
        std::vector<bool> is_qubit_locked;
        const size_t DMA_BUFFER_SIZE = 512 * 1024;

        // Linux-only bare-metal variables
        int dma_fd = -1;
        void *dma_buffer_ptr = MAP_FAILED;

        // Windows-only networking variables
        std::string host_server_ip = "192.168.1.100";
        int host_port = 50051;

        const double ANHARMONICITY_GHZ = -0.3;
        const double PI = M_PI;

        MLStateClassifier ml_classifier;

#if HARDWARE_HOST_MODE == 0
        void Network_SendPayload(const std::string &ip, int port, const MicrowavePulse &pulse)
        {
            WSADATA wsaData;
            if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0)
            {
                std::cerr << "[QHAL Client ERROR] Winsock initialization failed.\n";
                return;
            }

            SOCKET connectSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
            if (connectSocket == INVALID_SOCKET)
            {
                std::cerr << "[QHAL Client ERROR] Socket creation failed.\n";
                WSACleanup();
                return;
            }

            sockaddr_in serverAddress;
            serverAddress.sin_family = AF_INET;
            serverAddress.sin_port = htons(port);
            inet_pton(AF_INET, ip.c_str(), &serverAddress.sin_addr);

            if (connect(connectSocket, (SOCKADDR *)&serverAddress, sizeof(serverAddress)))
            {
                std::cerr << "[QHAL Client ERROR] Connection to server failed.\n";
                closesocket(connectSocket);
                WSACleanup();
                return;
            }

            send(connectSocket, reinterpret_cast<const char *>(&pulse.frequency_ghz), sizeof(pulse.frequency_ghz), 0);
            send(connectSocket, reinterpret_cast<const char *>(&pulse.duration_ns), sizeof(pulse.duration_ns), 0);

            size_t envelope_size = pulse.envelope_iq.size();
            send(connectSocket, reinterpret_cast<const char *>(&envelope_size), sizeof(size_t), 0);
            size_t bytes_to_send = envelope_size * sizeof(std::complex<double>);
            send(connectSocket, reinterpret_cast<const char *>(pulse.envelope_iq.data()), bytes_to_send, 0);

            std::cout << "[QHAL Client] Successfully dispatched " << bytes_to_send
                      << " bytes of microwave envelope data to " << ip << "\n";

            closesocket(connectSocket);
            WSACleanup();
        }
        
        std::vector<std::complex<double>> Network_ReceivePayload(const std::string &ip, int port)
        {
            WSADATA wsaData;
            WSAStartup(MAKEWORD(2, 2), &wsaData);

            SOCKET connectSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);

            sockaddr_in serverAddress;
            serverAddress.sin_family = AF_INET;
            serverAddress.sin_port = htons(port);
            inet_pton(AF_INET, ip.c_str(), &serverAddress.sin_addr);

            if (connect(connectSocket, (SOCKADDR *)&serverAddress, sizeof(serverAddress)) == SOCKET_ERROR)
            {
                std::cerr << "[QHAL Client ERROR] Failed to connect for ADC retrieval.\n";
                closesocket(connectSocket);
                WSACleanup();
                return std::vector<std::complex<double>>();
            }

            char fetch_command = 0x01;
            send(connectSocket, &fetch_command, 1, 0);

            size_t incoming_samples = 0;
            recv(connectSocket, reinterpret_cast<char *>(&incoming_samples), sizeof(size_t), MSG_WAITALL);

            std::vector<std::complex<double>> trajectory(incoming_samples);
            size_t bytes_to_receive = incoming_samples * sizeof(std::complex<double>);

            int bytes_received = recv(connectSocket, reinterpret_cast<char *>(trajectory.data()), bytes_to_receive, MSG_WAITALL);

            if (bytes_received > 0)
            {
                std::cout << "[QHAL Client] Successfully received " << incoming_samples
                          << " digitized IQ samples from the Linux Host.\n";
            }

            closesocket(connectSocket);
            WSACleanup();

            return trajectory;
        }
#endif

        std::vector<std::complex<double>> fetch_adc_buffer(const size_t adc_read_samples)
        {
            std::lock_guard<std::mutex> lock(dac_mutex);
            std::vector<std::complex<double>> trajectory(adc_read_samples);
#if HARDWARE_HOST_MODE && HAS_POSIX_MMAP
            if (dma_buffer_ptr == MAP_FAILED)
            {
                throw std::runtime_error("[QHAL FATAL] DMA Buffer not initialized for ADC fetch.");
            }
            ioctl(dma_fd, FETCH_ADC_TRANSACTION, adc_read_samples * sizeof(std::complex<double>));
            auto *mapped_array = static_cast<std::complex<double> *>(dma_buffer_ptr);
            for (size_t i = 0; i < adc_read_samples; ++i)
            {
                trajectory[i] = mapped_array[i];
            }
#else
            std::cout << "[QHAL Client] Awaiting ADC trajectory from Linux Host...\n";
            trajectory = Network_ReceivePayload(host_server_ip, host_port);
#endif

            return trajectory;
        }

        void dispatch_to_fpga(const MicrowavePulse &pulse)
        {
            std::lock_guard<std::mutex> lock(dac_mutex);
            if (dma_buffer_ptr == MAP_FAILED)
            {
                throw std::runtime_error("DMA Buffer not initialized.");
            }

#if HARDWARE_HOST_MODE && HAS_POSIX_MMAP
            auto *mapped_array = static_cast<std::complex<double> *>(dma_buffer_ptr);
            for (size_t i = 0; i < pulse.envelope_iq.size(); ++i)
            {
                mapped_array[i] = pulse.envelope_iq[i];
            }
            ioctl(dma_fd, START_DMA_TRANSACTION, pulse.envelope_iq.size() * sizeof(std::complex<double>));
#else
            std::cout << "[QHAL Client] Serializing microwave pulse...\n";
            std::cout << "[QHAL Client] Sending pulse via TCP/IP to Linux Host at "
                      << host_server_ip << ":" << host_port << "\n";

            Network_SendPayload(host_server_ip, host_port, pulse);
#endif
        }

        MicrowavePulse synthesize_drag_pulse(double amp, double duration_ns)
        {
            MicrowavePulse pulse;
            pulse.frequency_ghz = 5.0;
            pulse.duration_ns = duration_ns;

            size_t samples = static_cast<size_t>(duration_ns);
            pulse.envelope_iq.resize(samples);

            double sigma = duration_ns / 4.0;
            double mu = duration_ns / 2.0;

            for (size_t t = 0; t < samples; ++t)
            {
                double time = static_cast<double>(t);
                double gauss = amp * std::exp(-0.5 * std::pow((time - mu) / sigma, 2));
                double d_gauss = -(time - mu) / (sigma * sigma) * gauss;
                double quad = d_gauss / (2.0 * PI * ANHARMONICITY_GHZ);
                pulse.envelope_iq[t] = std::complex<double>(gauss, quad);
            }
            return pulse;
        }

        void update_nco_phase(size_t qubit_id, double angle)
        {
            std::lock_guard<std::mutex> lock(dac_mutex);
            if (qubit_id >= virtual_z_phases.size())
            {
                return;
            }
            virtual_z_phases[qubit_id] += angle;
            virtual_z_phases[qubit_id] = std::fmod(virtual_z_phases[qubit_id], 2.0 * PI);
            if (virtual_z_phases[qubit_id] < 0)
            {
                virtual_z_phases[qubit_id] += 2.0 * PI;
            }
        }

        void apply_ecr(size_t control, size_t target)
        {
            MicrowavePulse cr_pos = synthesize_drag_pulse(0.5, 100.0);
            dispatch_to_fpga(cr_pos);
            apply_x(control);
            MicrowavePulse cr_neg = synthesize_drag_pulse(-0.5, 100.0);
            dispatch_to_fpga(cr_neg);
            apply_x(control);
        }

    public:
        SuperconductingBackend()
        {
#if HEADWARE_HOST_MODE && HAS_POSIX_MMAP
            dma_fd = open("/dev/udmabuf0", O_RDWR | O_SYNC);
            if (dma_fd >= 0)
            {
                dma_buffer_ptr = mmap(NULL, DMA_BUFFER_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, dma_fd, 0);
            }
#else
            std::cout << "[QHAL] Booting in CLIENT mode. Establishing connection to Quantum Server...\n";
            dma_buffer_ptr = std::malloc(DMA_BUFFER_SIZE);
#endif
        }

        ~SuperconductingBackend() override
        {
#if HAS_POSIX_MMAP
            if (dma_buffer_ptr != MAP_FAILED)
            {
                munmap(dma_buffer_ptr, DMA_BUFFER_SIZE);
            }
            if (dma_fd >= 0)
            {
                close(dma_fd);
            }
#else
            if (dma_buffer_ptr && dma_buffer_ptr != MAP_FAILED)
            {
                std::free(dma_buffer_ptr);
            }
#endif
        }

        void allocate_qubits(size_t num_qubits) override
        {
            std::lock_guard<std::mutex> lock(dac_mutex);
            active_qubits = num_qubits;
            virtual_z_phases.resize(num_qubits, 0.0);
            is_qubit_allocated.resize(num_qubits, true);
            is_qubit_locked.resize(num_qubits, false);
        }

        void release_qubit(size_t qubit_id) override 
        {
            if (qubit_id >= is_qubit_allocated.size()) return;
            if (is_qubit_locked[qubit_id]) {
                throw std::runtime_error("Lifecycle Error: Cannot release a locked qubit.");
            }
            is_qubit_allocated[qubit_id] = false;
        }

        void lock_hardware_id(size_t qubit_id) override 
        {
            if (is_qubit_locked[qubit_id]) {
                throw std::runtime_error("Concurrency Error: Qubit already locked.");
            }
            is_qubit_locked[qubit_id] = true;
        }

        void unlock_hardware_id(size_t qubit_id) override 
        {
            is_qubit_locked[qubit_id] = false;
        }

        int measure(size_t qubit_id) override
        {
            MicrowavePulse readout_pulse = synthesize_drag_pulse(1.0, 500.0);
            dispatch_to_fpga(readout_pulse);
            std::vector<std::complex<double>> adc_trajectory = fetch_adc_buffer(500);
            int classified_state = ml_classifier.predict(adc_trajectory);

            return classified_state;
        }

        void apply_x(size_t qubit_id) override
        {
            MicrowavePulse x_pulse = synthesize_drag_pulse(1.0, 20.0);
            dispatch_to_fpga(x_pulse);
        }

        void apply_rz(size_t qubit_id, double angle) override
        {
            // Z-gates are typically implemented virtually in software by shifting the reference frame
            // of the FPGA numerically controlled oscillator (NCO) phases. 
            update_nco_phase(qubit_id, angle);
        }

        void apply_cnot(size_t control, size_t target) override
        {
            apply_rz(control, -PI / 2);
            apply_x(target);
            apply_ecr(control, target);
            apply_x(target);
        }

        void apply_toffoli(size_t control1, size_t control2, size_t target) override
        {
            apply_rz(target, PI / 4);
            apply_cnot(control2, target);
            apply_rz(target, -PI / 4);
            apply_cnot(control1, target);
            apply_rz(target, PI / 4);
            apply_cnot(control2, target);
            apply_rz(target, -PI / 4);
            apply_cnot(control1, target);
            apply_rz(control2, PI / 4);
            apply_cnot(control1, control2);
            apply_rz(control1, PI / 4);
            apply_rz(control2, -PI / 4);
            apply_cnot(control1, control2);
        }
    };
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}