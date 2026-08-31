<<<<<<< HEAD
#pragma once
#include <thread>
#include <mutex>
#include <atomic>
#include <chrono>
#include <vector>
#include <string>
#include <complex>
#include <cstdio>
#include "QVM.hpp"
#include "../gui/protocol.hpp"

namespace qhal
{

    class QUARK_RT_API VisualizationService
    {
    public:
        VisualizationService() = default;
        ~VisualizationService() { stop(); }

        VisualizationService(const VisualizationService &) = delete;
        VisualizationService &operator=(const VisualizationService &) = delete;

        void start()
        {
            if (running_.exchange(true))
                return;
            worker_ = std::thread([this]
                                  { run(); });
        }

        void stop()
        {
            running_ = false;
            if (worker_.joinable())
                worker_.join();
        }

        qgui::StateSnapshot snapshot()
        {
            std::lock_guard<std::mutex> lock(mutex_);
            return snapshot_;
        }

    private:
        void run();

        std::thread worker_;
        std::mutex mutex_;
        qgui::StateSnapshot snapshot_;
        std::vector<qgui::GateRecord> gate_history_;
        std::vector<qgui::MeasurementRecord> meas_history_;
        std::atomic<bool> running_{false};
    };

    inline void VisualizationService::run()
    {
        constexpr size_t kNumQubits = 5;
        qhal::QVM qvm;
        qvm.allocate_qubits(kNumQubits);

        uint64_t generation = 0;
        uint64_t step = 0;
        uint64_t seq = 0;
        double angle2 = 0.0;
        double angle3 = 0.0;

        while (running_)
        {
            std::vector<qgui::GateRecord> new_gates;
            auto push_gate = [&](const char *name, int target, int control)
            {
                qgui::GateRecord g{};
                std::snprintf(g.name, sizeof(g.name), "%s", name);
                g.target = target;
                g.control = control;
                g.step = step++;
                new_gates.push_back(g);
            };

            if (generation == 0)
            {
                qvm.apply_h(0);
                push_gate("H", 0, -1);
                qvm.apply_cnot(0, 1);
                push_gate("CNOT", 1, 0);
                qvm.apply_h(2);
                push_gate("H", 2, -1);
                qvm.apply_h(3);
                push_gate("H", 3, -1);
                qvm.apply_h(4);
                push_gate("H", 4, -1);
            }

            angle2 += 0.18;
            angle3 -= 0.12;
            qvm.apply_rz(2, angle2);
            push_gate("Rz", 2, -1);
            qvm.apply_rz(3, angle3);
            push_gate("Rz", 3, -1);
            int m = qvm.measure(4);
            qgui::MeasurementRecord rec{};
            rec.qubit = 4;
            rec.result = m;
            rec.seq = seq++;
            meas_history_.push_back(rec);
            if (meas_history_.size() > 200)
                meas_history_.erase(meas_history_.begin());

            qvm.apply_h(4);
            push_gate("H", 4, -1);

            for (const auto &g : new_gates)
            {
                gate_history_.push_back(g);
                if (gate_history_.size() > 64)
                    gate_history_.erase(gate_history_.begin());
            }

            qgui::StateSnapshot snap;
            snap.generation = generation;
            snap.num_qubits = static_cast<uint32_t>(kNumQubits);
            snap.amplitudes = qvm.get_amplitudes();
            snap.gates = gate_history_;
            snap.measurements = meas_history_;
            snap.backend_name = "QVM (Polyhedral Graph)";

            snap.objects.push_back(qgui::ObjectRecord{"QuantumRegister", {0, 1, 2, 3, 4}});
            snap.objects.push_back(qgui::ObjectRecord{"BellState", {0, 1}});
            snap.objects.push_back(qgui::ObjectRecord{"DiracState", {2}});
            snap.objects.push_back(qgui::ObjectRecord{"DiracState", {3}});

            {
                std::lock_guard<std::mutex> lock(mutex_);
                snapshot_ = std::move(snap);
            }

            ++generation;
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }
    }
=======
#pragma once
#include <thread>
#include <mutex>
#include <atomic>
#include <chrono>
#include <vector>
#include <string>
#include <complex>
#include <cstdio>
#include "QVM.hpp"
#include "../gui/protocol.hpp"

namespace qhal
{

    class QUARK_RT_API VisualizationService
    {
    public:
        VisualizationService() = default;
        ~VisualizationService() { stop(); }

        VisualizationService(const VisualizationService &) = delete;
        VisualizationService &operator=(const VisualizationService &) = delete;

        void start()
        {
            if (running_.exchange(true))
                return;
            worker_ = std::thread([this]
                                  { run(); });
        }

        void stop()
        {
            running_ = false;
            if (worker_.joinable())
                worker_.join();
        }

        qgui::StateSnapshot snapshot()
        {
            std::lock_guard<std::mutex> lock(mutex_);
            return snapshot_;
        }

    private:
        void run();

        std::thread worker_;
        std::mutex mutex_;
        qgui::StateSnapshot snapshot_;
        std::vector<qgui::GateRecord> gate_history_;
        std::vector<qgui::MeasurementRecord> meas_history_;
        std::atomic<bool> running_{false};
    };

    inline void VisualizationService::run()
    {
        constexpr size_t kNumQubits = 5;
        qhal::QVM qvm;
        qvm.allocate_qubits(kNumQubits);

        uint64_t generation = 0;
        uint64_t step = 0;
        uint64_t seq = 0;
        double angle2 = 0.0;
        double angle3 = 0.0;

        while (running_)
        {
            std::vector<qgui::GateRecord> new_gates;
            auto push_gate = [&](const char *name, int target, int control)
            {
                qgui::GateRecord g{};
                std::snprintf(g.name, sizeof(g.name), "%s", name);
                g.target = target;
                g.control = control;
                g.step = step++;
                new_gates.push_back(g);
            };

            if (generation == 0)
            {
                qvm.apply_h(0);
                push_gate("H", 0, -1);
                qvm.apply_cnot(0, 1);
                push_gate("CNOT", 1, 0);
                qvm.apply_h(2);
                push_gate("H", 2, -1);
                qvm.apply_h(3);
                push_gate("H", 3, -1);
                qvm.apply_h(4);
                push_gate("H", 4, -1);
            }

            angle2 += 0.18;
            angle3 -= 0.12;
            qvm.apply_rz(2, angle2);
            push_gate("Rz", 2, -1);
            qvm.apply_rz(3, angle3);
            push_gate("Rz", 3, -1);
            int m = qvm.measure(4);
            qgui::MeasurementRecord rec{};
            rec.qubit = 4;
            rec.result = m;
            rec.seq = seq++;
            meas_history_.push_back(rec);
            if (meas_history_.size() > 200)
                meas_history_.erase(meas_history_.begin());

            qvm.apply_h(4);
            push_gate("H", 4, -1);

            for (const auto &g : new_gates)
            {
                gate_history_.push_back(g);
                if (gate_history_.size() > 64)
                    gate_history_.erase(gate_history_.begin());
            }

            qgui::StateSnapshot snap;
            snap.generation = generation;
            snap.num_qubits = static_cast<uint32_t>(kNumQubits);
            snap.amplitudes = qvm.get_amplitudes();
            snap.gates = gate_history_;
            snap.measurements = meas_history_;
            snap.backend_name = "QVM (Polyhedral Graph)";

            snap.objects.push_back(qgui::ObjectRecord{"QuantumRegister", {0, 1, 2, 3, 4}});
            snap.objects.push_back(qgui::ObjectRecord{"BellState", {0, 1}});
            snap.objects.push_back(qgui::ObjectRecord{"DiracState", {2}});
            snap.objects.push_back(qgui::ObjectRecord{"DiracState", {3}});

            {
                std::lock_guard<std::mutex> lock(mutex_);
                snapshot_ = std::move(snap);
            }

            ++generation;
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }
    }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}