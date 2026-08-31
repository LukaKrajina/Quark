<<<<<<< HEAD
#pragma once
#include <memory>
#include <stdexcept>
#include <iostream>
#include <string>

#include "IQuantumBackend.hpp"
#include "NeutralAtomBackend.hpp"
#include "SuperconductingBackend.hpp"
#include "TrappedIonBackend.hpp"

#include "r/Karma_real.hpp"
#include "r/KarmaBus_real.hpp"
#include "r/AtomicVaporORAM.hpp"
#include "r/ThermalController.hpp"

namespace qhal
{
    enum class HardwareModality
    {
        Superconducting,
        TrappedIon,
        NeutralAtom
    };

    class QUARK_RT_API QM : public IQuantumBackend
    {
    private:
        std::unique_ptr<Karma_real> qpu;
        std::unique_ptr<KarmaBus_real> qpl;
        std::unique_ptr<IORAM> oram;
        std::unique_ptr<ThermalController> thermal;
        HardwareModality active_modality;
        size_t machine_node_id;

    public:
        QM(HardwareModality modality, size_t node_id = 0)
            : active_modality(modality), machine_node_id(node_id)
        {
            std::unique_ptr<IQuantumBackend> physical_driver;
            switch (modality)
            {
            case HardwareModality::Superconducting:
                physical_driver = std::make_unique<SuperconductingBackend>();
                std::cout << "[QM] Initialized Superconducting Microwave DMA Pipeline.\n";
                break;
            case HardwareModality::TrappedIon:
                physical_driver = std::make_unique<TrappedIonBackend>();
                std::cout << "[QM] Initialized Trapped Ion QCCD Optical Trap Topology.\n";
                break;
            case HardwareModality::NeutralAtom:
                physical_driver = std::make_unique<NeutralAtomBackend>();
                std::cout << "[QM] Initialized Neutral Atom Rydberg Blockade Matrix.\n";
                break;
            default:
                throw std::runtime_error("[QM Fatal] Unknown Hardware Modality requested.");
            }

            qpu = std::make_unique<Karma_real>(std::move(physical_driver));
            qpl = std::make_unique<KarmaBus_real>();
            oram = std::make_unique<AtomicVaporORAM>(oram_params::NUM_RAILS);
            double target_kelvin = ThermalSetpoint::CsVaporCell_K;
            switch (modality)
            {
            case HardwareModality::Superconducting:
                target_kelvin = ThermalSetpoint::SuperconductingMixChamber_K;
                break;
            case HardwareModality::TrappedIon:
                target_kelvin = ThermalSetpoint::TrappedIonChamber_K;
                break;
            case HardwareModality::NeutralAtom:
                target_kelvin = ThermalSetpoint::NeutralAtomChamber_K;
                break;
            default:
                break;
            }
            thermal = std::make_unique<ThermalController>(
                std::make_unique<CryostatThermometer>(target_kelvin), target_kelvin);

            std::cout << "[QM] Quantum Machine (Node " << machine_node_id << ") Online and Locked.\n";
        }

        void allocate_qubits(size_t num_qubits) override { qpu->allocate_qubits(num_qubits); }
        void release_qubit(size_t qubit_id) override { qpu->release_qubit(qubit_id); }
        void lock_hardware_id(size_t qubit_id) override { qpu->lock_hardware_id(qubit_id); }
        void unlock_hardware_id(size_t qubit_id) override { qpu->unlock_hardware_id(qubit_id); }
        int measure(size_t qubit_id) override { return qpu->measure(qubit_id); }

        void apply_h(size_t qubit_id) override { qpu->apply_h(qubit_id); }
        void apply_x(size_t qubit_id) override { qpu->apply_x(qubit_id); }
        void apply_rz(size_t qubit_id, double angle) override { qpu->apply_rz(qubit_id, angle); }
        void apply_cnot(size_t control, size_t target) override { qpu->apply_cnot(control, target); }
        void apply_toffoli(size_t c1, size_t c2, size_t target) override { qpu->apply_toffoli(c1, c2, target); }

        void execute_gauge_simulation()
        {
            qpu->simulate_glueball_dynamics();
        }

        void execute_spectral_analytics(size_t betti_target)
        {
            qpu->resolve_hodge_conjecture(betti_target);
        }

        void establish_remote_entanglement(size_t remote_node_id, double measured_latency_ms)
        {
            std::cout << "[QM] Engaging KarmaBus_real to establish physical link to Node " << remote_node_id << "...\n";
            qpl->establish_physical_link(machine_node_id, remote_node_id, measured_latency_ms, qpu.get());
        }
        
        double get_temperature_kelvin() const { return thermal->read_kelvin(); }
        double get_target_temperature_kelvin() const { return thermal->target_kelvin(); }
        void set_target_temperature_kelvin(double kelvin) { thermal->set_target_kelvin(kelvin); }
        double stabilize_temperature(double dt_seconds = 1.0) { return thermal->stabilize(dt_seconds); }
        IORAM *get_oram() { return oram.get(); }
        void write_oram(size_t rail, double value) { oram->write_rail(rail, value); }
        double read_oram(size_t rail) { return oram->read_rail(rail); }
        void reset_oram(size_t rail) { oram->reset_rail(rail); }
        void step_oram() { oram->step(); }
    };
=======
#pragma once
#include <memory>
#include <stdexcept>
#include <iostream>
#include <string>

#include "IQuantumBackend.hpp"
#include "NeutralAtomBackend.hpp"
#include "SuperconductingBackend.hpp"
#include "TrappedIonBackend.hpp"

#include "r/Karma_real.hpp"
#include "r/KarmaBus_real.hpp"
#include "r/AtomicVaporORAM.hpp"
#include "r/ThermalController.hpp"

namespace qhal
{
    enum class HardwareModality
    {
        Superconducting,
        TrappedIon,
        NeutralAtom
    };

    class QUARK_RT_API QM : public IQuantumBackend
    {
    private:
        std::unique_ptr<Karma_real> qpu;
        std::unique_ptr<KarmaBus_real> qpl;
        std::unique_ptr<IORAM> oram;
        std::unique_ptr<ThermalController> thermal;
        HardwareModality active_modality;
        size_t machine_node_id;

    public:
        QM(HardwareModality modality, size_t node_id = 0)
            : active_modality(modality), machine_node_id(node_id)
        {
            std::unique_ptr<IQuantumBackend> physical_driver;
            switch (modality)
            {
            case HardwareModality::Superconducting:
                physical_driver = std::make_unique<SuperconductingBackend>();
                std::cout << "[QM] Initialized Superconducting Microwave DMA Pipeline.\n";
                break;
            case HardwareModality::TrappedIon:
                physical_driver = std::make_unique<TrappedIonBackend>();
                std::cout << "[QM] Initialized Trapped Ion QCCD Optical Trap Topology.\n";
                break;
            case HardwareModality::NeutralAtom:
                physical_driver = std::make_unique<NeutralAtomBackend>();
                std::cout << "[QM] Initialized Neutral Atom Rydberg Blockade Matrix.\n";
                break;
            default:
                throw std::runtime_error("[QM Fatal] Unknown Hardware Modality requested.");
            }

            qpu = std::make_unique<Karma_real>(std::move(physical_driver));
            qpl = std::make_unique<KarmaBus_real>();
            oram = std::make_unique<AtomicVaporORAM>(oram_params::NUM_RAILS);
            double target_kelvin = ThermalSetpoint::CsVaporCell_K;
            switch (modality)
            {
            case HardwareModality::Superconducting:
                target_kelvin = ThermalSetpoint::SuperconductingMixChamber_K;
                break;
            case HardwareModality::TrappedIon:
                target_kelvin = ThermalSetpoint::TrappedIonChamber_K;
                break;
            case HardwareModality::NeutralAtom:
                target_kelvin = ThermalSetpoint::NeutralAtomChamber_K;
                break;
            default:
                break;
            }
            thermal = std::make_unique<ThermalController>(
                std::make_unique<CryostatThermometer>(target_kelvin), target_kelvin);

            std::cout << "[QM] Quantum Machine (Node " << machine_node_id << ") Online and Locked.\n";
        }

        void allocate_qubits(size_t num_qubits) override { qpu->allocate_qubits(num_qubits); }
        void release_qubit(size_t qubit_id) override { qpu->release_qubit(qubit_id); }
        void lock_hardware_id(size_t qubit_id) override { qpu->lock_hardware_id(qubit_id); }
        void unlock_hardware_id(size_t qubit_id) override { qpu->unlock_hardware_id(qubit_id); }
        int measure(size_t qubit_id) override { return qpu->measure(qubit_id); }
        double expectation_z(size_t qubit_id) override { return qpu->expectation_z(qubit_id); }

        void apply_h(size_t qubit_id) override { qpu->apply_h(qubit_id); }
        void apply_x(size_t qubit_id) override { qpu->apply_x(qubit_id); }
        void apply_rz(size_t qubit_id, double angle) override { qpu->apply_rz(qubit_id, angle); }
        void apply_cnot(size_t control, size_t target) override { qpu->apply_cnot(control, target); }
        void apply_toffoli(size_t c1, size_t c2, size_t target) override { qpu->apply_toffoli(c1, c2, target); }

        void execute_gauge_simulation()
        {
            qpu->simulate_glueball_dynamics();
        }

        void execute_spectral_analytics(size_t betti_target)
        {
            qpu->resolve_hodge_conjecture(betti_target);
        }

        void establish_remote_entanglement(size_t remote_node_id, double measured_latency_ms)
        {
            std::cout << "[QM] Engaging KarmaBus_real to establish physical link to Node " << remote_node_id << "...\n";
            qpl->establish_physical_link(machine_node_id, remote_node_id, measured_latency_ms, qpu.get());
        }
        
        double get_temperature_kelvin() const { return thermal->read_kelvin(); }
        double get_target_temperature_kelvin() const { return thermal->target_kelvin(); }
        void set_target_temperature_kelvin(double kelvin) { thermal->set_target_kelvin(kelvin); }
        double stabilize_temperature(double dt_seconds = 1.0) { return thermal->stabilize(dt_seconds); }
        IORAM *get_oram() { return oram.get(); }
        void write_oram(size_t rail, double value) { oram->write_rail(rail, value); }
        double read_oram(size_t rail) { return oram->read_rail(rail); }
        void reset_oram(size_t rail) { oram->reset_rail(rail); }
        void step_oram() { oram->step(); }
    };
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}