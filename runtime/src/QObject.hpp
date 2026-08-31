<<<<<<< HEAD
#pragma once
#include <vector>
#include <complex>
#include <cmath>
#include <string>
#include <memory>
#include <stdexcept>
#include "../include/qhal/IQuantumBackend.hpp"

namespace quark
{
    class QUARK_RT_API QObject
    {
    protected:
        qhal::IQuantumBackend *backend;
        std::vector<size_t> hardware_ids;
        bool is_owning;

        QObject(qhal::IQuantumBackend *active_backend, const std::vector<size_t> &existing_ids, bool owns_resource)
            : backend(active_backend), hardware_ids(existing_ids), is_owning(owns_resource) {}

    public:
        void *qlm_data = nullptr;

        QObject(qhal::IQuantumBackend *active_backend, size_t num_qubits) : backend(active_backend), is_owning(true)
        {
            backend->allocate_qubits(num_qubits);
            hardware_ids.reserve(num_qubits);
            for (size_t i = 0; i < num_qubits; ++i)
            {
                hardware_ids.push_back(i);
            }
        }

        virtual ~QObject()
        {
            if (is_owning)
            {
                for (size_t id : hardware_ids)
                {
                    int final_state = backend->measure(id);
                    if (final_state == 1)
                    {
                        backend->apply_x(id);
                    }
                    backend->release_qubit(id);
                }
            }
            else
            {
                for (size_t id : hardware_ids)
                {
                    backend->unlock_hardware_id(id);
                }
            }
        }

        virtual void reset_to_ground_state() = 0;

        virtual std::vector<int> measure()
        {
            std::vector<int> results;
            results.reserve(hardware_ids.size());
            for (size_t id : hardware_ids)
            {
                results.push_back(backend->measure(id));
            }
            return results;
        }

        virtual size_t size() const
        {
            return hardware_ids.size();
        }

        const std::vector<size_t> &get_ids() const
        {
            return hardware_ids;
        }
    };

    class QUARK_RT_API DiracState : public QObject
    {
    private:
        bool init_to_one;

        bool holds_superposition;

    public:
        DiracState(qhal::IQuantumBackend *active_backend, bool start_in_excited_state = false)
            : QObject(active_backend, 1), init_to_one(start_in_excited_state), holds_superposition(false)
        {
            reset_to_ground_state();
        }

        DiracState(qhal::IQuantumBackend *active_backend, size_t existing_id)
            : QObject(active_backend, std::vector<size_t>{existing_id}, false),
              init_to_one(false),
              holds_superposition(true)
        {
            backend->lock_hardware_id(existing_id);
        }

        void reset_to_ground_state() override
        {
            int current_state = backend->measure(hardware_ids[0]);

            if (current_state == 1)
            {
                backend->apply_x(hardware_ids[0]);
            }

            if (init_to_one)
            {
                backend->apply_x(hardware_ids[0]);
            }
            holds_superposition = false;
        }
    };

    class QUARK_RT_API BellState : public QObject
    {
    public:
        BellState(qhal::IQuantumBackend *backend)
            : QObject(backend, 2)
        {
            reset_to_ground_state();
        }

        void reset_to_ground_state() override
        {
            size_t q0 = hardware_ids[0];
            size_t q1 = hardware_ids[1];

            backend->apply_rz(q0, M_PI / 2);
            backend->apply_x(q0);
            backend->apply_rz(q0, M_PI / 2);
            backend->apply_cnot(q0, q1);
        }
    };

    class QUARK_RT_API QuantumRegister : public QObject
    {
    public:
        QuantumRegister(qhal::IQuantumBackend *backend, size_t n)
            : QObject(backend, n)
        {
            reset_to_ground_state();
        }

        void reset_to_ground_state() override
        {
            for (size_t id : hardware_ids)
            {
                int collapsed_state = backend->measure(id);
                if (collapsed_state == 1)
                {
                    backend->apply_x(id);
                }
            }
        }

        DiracState extract_qubit(size_t index)
        {
            if (index >= size())
                throw std::out_of_range("Quark Runtime Error: Register index out of bounds.");

            return DiracState(backend, hardware_ids[index]);
        }
    };

    class QUARK_RT_API QDataState : public QObject
    {
    public:
        QDataState(qhal::IQuantumBackend *backend, const std::vector<size_t> &encoded_ids)
            : QObject(backend, encoded_ids, true) {}

        void reset_to_ground_state() override
        {
            for (size_t id : hardware_ids)
            {
                int collapsed_state = backend->measure(id);
                if (collapsed_state == 1)
                {
                    backend->apply_x(id);
                }
            }
        }
    };
=======
#pragma once
#include <vector>
#include <complex>
#include <cmath>
#include <string>
#include <memory>
#include <stdexcept>
#include "../include/qhal/IQuantumBackend.hpp"

namespace quark
{
    class QUARK_RT_API QObject
    {
    protected:
        qhal::IQuantumBackend *backend;
        std::vector<size_t> hardware_ids;
        bool is_owning;

        QObject(qhal::IQuantumBackend *active_backend, const std::vector<size_t> &existing_ids, bool owns_resource)
            : backend(active_backend), hardware_ids(existing_ids), is_owning(owns_resource) {}

    public:
        void *qlm_data = nullptr;

        QObject(qhal::IQuantumBackend *active_backend, size_t num_qubits) : backend(active_backend), is_owning(true)
        {
            backend->allocate_qubits(num_qubits);
            hardware_ids.reserve(num_qubits);
            for (size_t i = 0; i < num_qubits; ++i)
            {
                hardware_ids.push_back(i);
            }
        }

        virtual ~QObject()
        {
            if (is_owning)
            {
                for (size_t id : hardware_ids)
                {
                    int final_state = backend->measure(id);
                    if (final_state == 1)
                    {
                        backend->apply_x(id);
                    }
                    backend->release_qubit(id);
                }
            }
            else
            {
                for (size_t id : hardware_ids)
                {
                    backend->unlock_hardware_id(id);
                }
            }
        }

        virtual void reset_to_ground_state() = 0;

        virtual std::vector<int> measure()
        {
            std::vector<int> results;
            results.reserve(hardware_ids.size());
            for (size_t id : hardware_ids)
            {
                results.push_back(backend->measure(id));
            }
            return results;
        }

        virtual size_t size() const
        {
            return hardware_ids.size();
        }

        const std::vector<size_t> &get_ids() const
        {
            return hardware_ids;
        }
    };

    class QUARK_RT_API DiracState : public QObject
    {
    private:
        bool init_to_one;

        bool holds_superposition;

    public:
        DiracState(qhal::IQuantumBackend *active_backend, bool start_in_excited_state = false)
            : QObject(active_backend, 1), init_to_one(start_in_excited_state), holds_superposition(false)
        {
            reset_to_ground_state();
        }

        DiracState(qhal::IQuantumBackend *active_backend, size_t existing_id)
            : QObject(active_backend, std::vector<size_t>{existing_id}, false),
              init_to_one(false),
              holds_superposition(true)
        {
            backend->lock_hardware_id(existing_id);
        }

        void reset_to_ground_state() override
        {
            int current_state = backend->measure(hardware_ids[0]);

            if (current_state == 1)
            {
                backend->apply_x(hardware_ids[0]);
            }

            if (init_to_one)
            {
                backend->apply_x(hardware_ids[0]);
            }
            holds_superposition = false;
        }
    };

    class QUARK_RT_API BellState : public QObject
    {
    public:
        BellState(qhal::IQuantumBackend *backend)
            : QObject(backend, 2)
        {
            reset_to_ground_state();
        }

        void reset_to_ground_state() override
        {
            size_t q0 = hardware_ids[0];
            size_t q1 = hardware_ids[1];

            backend->apply_rz(q0, M_PI / 2);
            backend->apply_x(q0);
            backend->apply_rz(q0, M_PI / 2);
            backend->apply_cnot(q0, q1);
        }
    };

    class QUARK_RT_API QuantumRegister : public QObject
    {
    public:
        QuantumRegister(qhal::IQuantumBackend *backend, size_t n)
            : QObject(backend, n)
        {
            reset_to_ground_state();
        }

        void reset_to_ground_state() override
        {
            for (size_t id : hardware_ids)
            {
                int collapsed_state = backend->measure(id);
                if (collapsed_state == 1)
                {
                    backend->apply_x(id);
                }
            }
        }

        DiracState extract_qubit(size_t index)
        {
            if (index >= size())
                throw std::out_of_range("Quark Runtime Error: Register index out of bounds.");

            return DiracState(backend, hardware_ids[index]);
        }
    };

    class QUARK_RT_API QDataState : public QObject
    {
    public:
        QDataState(qhal::IQuantumBackend *backend, const std::vector<size_t> &encoded_ids)
            : QObject(backend, encoded_ids, true) {}

        void reset_to_ground_state() override
        {
            for (size_t id : hardware_ids)
            {
                int collapsed_state = backend->measure(id);
                if (collapsed_state == 1)
                {
                    backend->apply_x(id);
                }
            }
        }
    };
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}