<<<<<<< HEAD
#pragma once
#include <memory>
#include <string>
#include <vector>
#include <cstdint>
#include <iostream>

#include "../../qlm/QLM.hpp"
#include "../../qml/QKMFormat.hpp"
#include "../../qml/Inference.hpp"
#include "../../../src/QObject.hpp"

namespace vedaros::quantum
{
    class VedaQlm
    {
    private:
        qhal::IQuantumBackend *backend_;
        size_t qubits_;
        size_t layers_;

    public:
        VedaQlm(qhal::IQuantumBackend *be, size_t qubits = 16, size_t layers = 6)
            : backend_(be), qubits_(qubits), layers_(layers)
        {
            std::cout << "[vedaRos.qlm] QLM online (" << qubits_
                      << " qubits, " << layers_ << " layers).\n";
        }

        qml::QKMModel<double> train(std::vector<std::shared_ptr<quark::QObject>> &dataset,
                                    int epochs, double lr,
                                    const std::string &export_path)
        {
            qlm::QLM learning_machine(backend_, qubits_, layers_);
            return learning_machine.train_and_export(epochs, lr, export_path, dataset);
        }

        size_t qubits() const { return qubits_; }
        size_t layers() const { return layers_; }
    };

    inline void veda_qlm_train_impl(QObject *obj, int epochs, double lr)
    {
        if (!obj || !obj->qlm_data || !global_qm)
        {
            std::cerr << "[vedaRos.qlm] train: invalid state object or backend.\n";
            return;
        }

        auto *sp = static_cast<std::shared_ptr<quark::QObject> *>(obj->qlm_data);
        if ((*sp)->qlm_data == nullptr)
            (*sp)->qlm_data = new uint8_t(0);

        std::vector<std::shared_ptr<quark::QObject>> dataset{*sp};
        VedaQlm qlm(global_qm, 16, 6);
        qlm.train(dataset, epochs, lr, "veda_trained_model.qkm");

        delete static_cast<uint8_t *>((*sp)->qlm_data);
        (*sp)->qlm_data = nullptr;
    }

}

QUARK_HOST_EXPORT void qk_veda_qlm_train(void *qobj_ptr, int epochs, double lr);

#if defined(QUARK_RT_BUILD)
void qk_veda_qlm_train(void *qobj_ptr, int epochs, double lr)
{
    vedaros::quantum::veda_qlm_train_impl(static_cast<QObject *>(qobj_ptr), epochs, lr);
}
=======
#pragma once
#include <memory>
#include <string>
#include <vector>
#include <cstdint>
#include <iostream>

#include "../../qlm/QLM.hpp"
#include "../../qml/QKMFormat.hpp"
#include "../../qml/Inference.hpp"
#include "../../../src/QObject.hpp"

namespace vedaros::quantum
{
    class VedaQlm
    {
    private:
        qhal::IQuantumBackend *backend_;
        size_t qubits_;
        size_t layers_;

    public:
        VedaQlm(qhal::IQuantumBackend *be, size_t qubits = 16, size_t layers = 6)
            : backend_(be), qubits_(qubits), layers_(layers)
        {
            std::cout << "[vedaRos.qlm] QLM online (" << qubits_
                      << " qubits, " << layers_ << " layers).\n";
        }

        qml::QKMModel<double> train(std::vector<std::shared_ptr<quark::QObject>> &dataset,
                                    int epochs, double lr,
                                    const std::string &export_path)
        {
            qlm::QLM learning_machine(backend_, qubits_, layers_);
            return learning_machine.train_and_export(epochs, lr, export_path, dataset);
        }

        size_t qubits() const { return qubits_; }
        size_t layers() const { return layers_; }
    };

    inline void veda_qlm_train_impl(QObject *obj, int epochs, double lr)
    {
        if (!obj || !obj->qlm_data || !global_qm)
        {
            std::cerr << "[vedaRos.qlm] train: invalid state object or backend.\n";
            return;
        }

        auto *sp = static_cast<std::shared_ptr<quark::QObject> *>(obj->qlm_data);
        if ((*sp)->qlm_data == nullptr)
            (*sp)->qlm_data = new uint8_t(0);

        std::vector<std::shared_ptr<quark::QObject>> dataset{*sp};
        VedaQlm qlm(global_qm, 16, 6);
        qlm.train(dataset, epochs, lr, "veda_trained_model.qkm");

        delete static_cast<uint8_t *>((*sp)->qlm_data);
        (*sp)->qlm_data = nullptr;
    }

}

QUARK_HOST_EXPORT void qk_veda_qlm_train(void *qobj_ptr, int epochs, double lr);

#if defined(QUARK_RT_BUILD)
void qk_veda_qlm_train(void *qobj_ptr, int epochs, double lr)
{
    vedaros::quantum::veda_qlm_train_impl(static_cast<QObject *>(qobj_ptr), epochs, lr);
}
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
#endif