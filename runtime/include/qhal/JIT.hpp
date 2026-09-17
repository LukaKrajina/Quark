#pragma once
#include <memory>
#include <string>
#include <iostream>
#include <stdexcept>

// LLVM Core & IR
#include <llvm/IR/LLVMContext.h>
#include <llvm/IR/Module.h>
#include <llvm/IR/IRBuilder.h>
#include "llvm/Support/TargetSelect.h"
#include "llvm/Support/Error.h"

// LLVM ORC JIT
#include "llvm/ExecutionEngine/Orc/LLJIT.h"
#include "llvm/ExecutionEngine/Orc/ThreadSafeModule.h"
#include "llvm/ExecutionEngine/JITSymbol.h"

// LLVM Process
#include "llvm/ExecutionEngine/Orc/ExecutionUtils.h"

// Quark Core
#include "IQuantumBackend.hpp"

// QLM & QML
#include "../qlm/QLM.hpp"
#include "../../src/QDataEncoder.hpp"
#include "../qml/Inference.hpp"

// QBNS
#include "../qbNs/qbNSBridge.hpp"

// VedaROS
#include "../vedaRos/quantum/qlm.hpp"

// Tracker
#include "CircuitTelemetry.hpp"

#include "../numqk/SoftLogic.hpp"
#include "PolymerSampler.hpp"
#include "../qbNs/SpikeBeliefPropagation.hpp"

// QCOS syscall ABI + QMS MK
#include "QcosSyscall.hpp"
#include "Qms.hpp"

// QChain（qk_qchain_* C ABI）
#include "../qchain/bridge/qchain_bridge.hpp"

// Lattice（晶格数组 qk_lattice_* C ABI）
#include "Lattice.hpp"

// 经典 GUI / 图形引擎（cgui_* / cgfx_* C ABI）
#include "ClassicGui.hpp"
#include "ClassicGfx.hpp"


// --- QHAL Trampolines ---
static qhal::IQuantumBackend *ActiveBackend = nullptr;

QUARK_HOST_EXPORT void qk_alloc(size_t num_qubits);
QUARK_HOST_EXPORT int qk_measure(size_t qubit_id);
QUARK_HOST_EXPORT void *qk_create_DiracState(int n);
QUARK_HOST_EXPORT void *qk_create_BellState();
QUARK_HOST_EXPORT void *qk_create_QuantumRegister(int size);
QUARK_HOST_EXPORT void *qk_create_basis_state(double theta, double phi, int value);
QUARK_HOST_EXPORT int qk_measure_object(void *ptr);
QUARK_HOST_EXPORT void quark_chkstk_stub();
QUARK_HOST_EXPORT void qk_release_object(void *ptr);
QUARK_HOST_EXPORT void *qk_encode_text(const char *text);
QUARK_HOST_EXPORT void *qk_qlm_invoke(void *qobj_ptr, int epochs, double lr);
QUARK_HOST_EXPORT void qk_qkm_export(void *model_ptr, const char *path);
QUARK_HOST_EXPORT double qk_surrogate(double x, double theta, double gamma);
QUARK_HOST_EXPORT double qk_tanh_quantize(double w, double alpha, int bits);
QUARK_HOST_EXPORT double qk_lif_step(double v, double current, double tau, double theta);
QUARK_HOST_EXPORT double qk_mellowmax2(double a, double b, double omega);
QUARK_HOST_EXPORT double qk_logsumexp2(double a, double b, double beta);
QUARK_HOST_EXPORT double qk_boltzmann2(double a, double b, double beta);
QUARK_HOST_EXPORT double qk_tnorm_luk(double a, double b);
QUARK_HOST_EXPORT double qk_tnorm_prod(double a, double b);
QUARK_HOST_EXPORT double qk_tnorm_godel(double a, double b);
QUARK_HOST_EXPORT double qk_polymer_weight(double beta, double h, double len);
QUARK_HOST_EXPORT double qk_polymer_mix_bound(double n, double eps);

extern "C" void *__quantum__rt__qubit_allocate();
extern "C" void  __quantum__rt__qubit_release(void *qubit);
extern "C" int   __quantum__qis__measure_int(void *qubit);
extern "C" void __quantum__qis__h(void *qubit);
extern "C" void __quantum__qis__x(void *qubit);
extern "C" void __quantum__qis__rz(double angle, void *qubit);
extern "C" void __quantum__qis__cnot(void *control, void *target);
extern "C" void __quantum__qis__toffoli(void *c1, void *c2, void *target);
extern "C" void __quantum__qis__swap(void *a, void *b);
extern "C" void __quantum__qis__qft(int num_qubits);
extern "C" void __quantum__qis__braid(void *a, void *b);
extern "C" int  __quantum__qis__measure_basis(void *qubit, char basis);

#if defined(QUARK_RT_BUILD)
void qk_alloc(size_t num_qubits)
{
    if (ActiveBackend)
        ActiveBackend->allocate_qubits(num_qubits);
}

int qk_measure(size_t qubit_id)
{
    if (ActiveBackend)
        return ActiveBackend->measure(qubit_id);
    return -1;
}

void *qk_create_DiracState(int n)
{
    QObject *obj = new QObject();
    if (n < 1)
        n = 1;
    for (int i = 0; i < n; ++i)
    {
        obj->hardware_ids.push_back(next_available_qubit.fetch_add(1));
    }
    if (ActiveBackend)
    {
        ActiveBackend->allocate_qubits(next_available_qubit.load());
    }
    qhal::CircuitTelemetry::get_instance().log_object(
        "DiracState", std::vector<int>(obj->hardware_ids.begin(), obj->hardware_ids.end()));
    return obj;
}

void *qk_create_basis_state(double theta, double phi, int value)
{
    QObject *obj = new QObject();
    size_t q = next_available_qubit.fetch_add(1);
    obj->hardware_ids = {q};

    if (ActiveBackend)
    {
        ActiveBackend->allocate_qubits(next_available_qubit.load());
        // 把 |0⟩ 旋转到任意基 (θ, φ) 的 + 本征态；value != 0 时取 - 本征态（X 翻转）。
        ActiveBackend->apply_basis(q, theta, phi);
        if (value != 0)
        {
            ActiveBackend->apply_x(q);
        }
        qhal::CircuitTelemetry::get_instance().log_gate("BASIS", q);
    }

    qhal::CircuitTelemetry::get_instance().log_object(
        "BasisState", std::vector<int>{static_cast<int>(q)}, theta, phi);

    return obj;
}

void *qk_create_BellState()
{
    QObject *obj = new QObject();
    size_t q0 = next_available_qubit.fetch_add(1);
    size_t q1 = next_available_qubit.fetch_add(1);
    obj->hardware_ids = {q0, q1};

    if (ActiveBackend)
    {
        ActiveBackend->allocate_qubits(next_available_qubit.load());
        ActiveBackend->apply_h(q0);
        qhal::CircuitTelemetry::get_instance().log_gate("H", q0);
        ActiveBackend->apply_cnot(q0, q1);
        qhal::CircuitTelemetry::get_instance().log_gate("CNOT", q1, q0);
    }

    qhal::CircuitTelemetry::get_instance().log_object(
        "BellState", std::vector<int>{static_cast<int>(q0), static_cast<int>(q1)});

    return obj;
}

void *qk_create_QuantumRegister(int size)
{
    QObject *obj = new QObject();
    for (int i = 0; i < size; ++i)
    {
        obj->hardware_ids.push_back(next_available_qubit.fetch_add(1));
    }
    if (ActiveBackend)
    {
        ActiveBackend->allocate_qubits(next_available_qubit.load());
    }
    qhal::CircuitTelemetry::get_instance().log_object(
        "QuantumRegister", std::vector<int>(obj->hardware_ids.begin(), obj->hardware_ids.end()));
    return obj;
}

int qk_measure_object(void *ptr)
{
    QObject *obj = static_cast<QObject *>(ptr);
    if (ActiveBackend && obj && !obj->hardware_ids.empty())
    {
        return ActiveBackend->measure(obj->hardware_ids[0]);
    }
    return 0;
}

void quark_chkstk_stub()
{
}

void qk_release_object(void *ptr)
{
    QObject *obj = static_cast<QObject *>(ptr);
    if (obj)
    {
        if (ActiveBackend)
        {
            for (size_t q_id : obj->hardware_ids)
            {
                ActiveBackend->release_qubit(q_id);
            }
        }

        if (obj->qlm_data)
        {
            if (obj->data_kind == QOBJ_DATA_STRING)
            {
                delete static_cast<std::string *>(obj->qlm_data);
            }
            else if (obj->data_kind == QOBJ_DATA_SHARED)
            {
                delete static_cast<std::shared_ptr<quark::QObject> *>(obj->qlm_data);
            }
            obj->qlm_data = nullptr;
            obj->data_kind = QOBJ_DATA_NONE;
        }

        next_available_qubit.fetch_sub(obj->hardware_ids.size());
        delete obj;
    }
}

void *qk_encode_text(const char *text)
{
    if (!ActiveBackend)
        return nullptr;

    quark::qml::QDataEncoder encoder(ActiveBackend);
    auto sp = encoder.text_to_basis(std::string(text));

    QObject *obj = new QObject();
    obj->hardware_ids = sp->get_ids();
    obj->qlm_data = new std::shared_ptr<quark::QObject>(sp);
    obj->data_kind = QOBJ_DATA_SHARED;

    return obj;
}

void *qk_qlm_invoke(void *qobj_ptr, int epochs, double lr)
{
    QObject *obj = static_cast<QObject *>(qobj_ptr);
    QModelJob *job = new QModelJob();

    job->prompt_data = obj->qlm_data;
    job->epochs = epochs;
    job->lr = lr;

    return job;
}

void qk_qkm_export(void *model_ptr, const char *path)
{
    QModelJob *job = static_cast<QModelJob *>(model_ptr);

    if (job && job->prompt_data && ActiveBackend)
    {
        auto *sp = static_cast<std::shared_ptr<quark::QObject> *>(job->prompt_data);
        if ((*sp)->qlm_data == nullptr) {
             (*sp)->qlm_data = new uint8_t(0);
        }

        std::vector<std::shared_ptr<quark::QObject>> dataset_wrapper;
        dataset_wrapper.push_back(*sp);
        qlm::QLM learning_machine(ActiveBackend, 8*2, 6);
        learning_machine.train_and_export(job->epochs, job->lr, std::string(path), dataset_wrapper);
        delete static_cast<uint8_t*>((*sp)->qlm_data);
        (*sp)->qlm_data = nullptr;
    }

    delete job;
}

double qk_surrogate(double x, double theta, double gamma) {
    return numqk::surrogate_gradient(x, theta, gamma);
}
double qk_tanh_quantize(double w, double alpha, int bits) {
    return numqk::tanh_quantize_scalar(w, alpha, bits);
}
double qk_lif_step(double v, double current, double tau, double theta) {
    return qbns::lif_step(v, current, tau, theta);
}
double qk_mellowmax2(double a, double b, double omega) {
    return numqk::mellowmax2(a, b, omega);
}
double qk_logsumexp2(double a, double b, double beta) {
    return numqk::logsumexp2(a, b, beta);
}
double qk_boltzmann2(double a, double b, double beta) {
    return numqk::boltzmann2(a, b, beta);
}
double qk_tnorm_luk(double a, double b)   { return numqk::lukasiewicz_meet(a, b); }
double qk_tnorm_prod(double a, double b)  { return numqk::product_meet(a, b); }
double qk_tnorm_godel(double a, double b) { return numqk::godel_meet(a, b); }
double qk_polymer_weight(double beta, double h, double len) {
    return qhal::PolymerSampler::ferromagnetic_weight(beta, h, static_cast<size_t>(len));
}
double qk_polymer_mix_bound(double n, double eps) {
    return n * std::log(n / eps);
}

void *__quantum__rt__qubit_allocate()
{
    if (!ActiveBackend)
        return nullptr;
    size_t id = next_available_qubit.fetch_add(1);
    ActiveBackend->allocate_qubits(next_available_qubit.load());
    return new size_t(id);
}

void __quantum__rt__qubit_release(void *qubit)
{
    if (!qubit)
        return;
    size_t *id = static_cast<size_t *>(qubit);
    if (ActiveBackend)
        ActiveBackend->release_qubit(*id);
    delete id;
}

int __quantum__qis__measure_int(void *qubit)
{
    if (!qubit || !ActiveBackend)
        return 0;
    size_t *id = static_cast<size_t *>(qubit);
    return ActiveBackend->measure(*id);
}

static size_t qubit_handle_id(void *qubit)
{
    return qubit ? *static_cast<size_t *>(qubit) : 0;
}

void __quantum__qis__h(void *qubit)
{
    if (ActiveBackend) ActiveBackend->apply_h(qubit_handle_id(qubit));
}

void __quantum__qis__x(void *qubit)
{
    if (ActiveBackend) ActiveBackend->apply_x(qubit_handle_id(qubit));
}

void __quantum__qis__rz(double angle, void *qubit)
{
    if (ActiveBackend) ActiveBackend->apply_rz(qubit_handle_id(qubit), angle);
}

void __quantum__qis__cnot(void *control, void *target)
{
    if (ActiveBackend) ActiveBackend->apply_cnot(qubit_handle_id(control), qubit_handle_id(target));
}

void __quantum__qis__toffoli(void *c1, void *c2, void *target)
{
    if (ActiveBackend) ActiveBackend->apply_toffoli(qubit_handle_id(c1), qubit_handle_id(c2), qubit_handle_id(target));
}

void __quantum__qis__swap(void *a, void *b)
{
    if (ActiveBackend) ActiveBackend->apply_swap(qubit_handle_id(a), qubit_handle_id(b));
}

void __quantum__qis__qft(int num_qubits)
{
    if (ActiveBackend && num_qubits > 0)
        ActiveBackend->apply_qft(0, static_cast<size_t>(num_qubits - 1));
}

void __quantum__qis__braid(void *a, void *b)
{
    if (ActiveBackend) ActiveBackend->apply_braid(qubit_handle_id(a), qubit_handle_id(b));
}

int __quantum__qis__measure_basis(void *qubit, char basis)
{
    if (!ActiveBackend)
        return 0;
    return ActiveBackend->measure_basis(qubit_handle_id(qubit), basis);
}
#endif

namespace qhal
{
    class QUARK_RT_API JIT
    {
    private:
        std::unique_ptr<llvm::orc::LLJIT> JIT_ptr;
        static void handle_llvm_error(llvm::Error Err)
        {
            llvm::handleAllErrors(std::move(Err), [](llvm::ErrorInfoBase &EIB)
                                  { std::cerr << "Quark JIT Error: " << EIB.message() << std::endl; });
        }

    public:
        JIT(qhal::IQuantumBackend *backend)
        {
            ActiveBackend = backend;
            llvm::InitializeNativeTarget();
            llvm::InitializeNativeTargetAsmPrinter();
            llvm::InitializeNativeTargetAsmParser();

            auto JITOrErr = llvm::orc::LLJITBuilder().create();
            if (!JITOrErr)
            {
                handle_llvm_error(JITOrErr.takeError());
                throw std::runtime_error("Failed to initialize Quark LLJIT.");
            }
            JIT_ptr = std::move(*JITOrErr);
            bind_hardware_api();
        }

        ~JIT()
        {
            ActiveBackend = nullptr;
        }

        void add_ir_module(std::unique_ptr<llvm::Module> M, std::unique_ptr<llvm::LLVMContext> Ctx)
        {
            llvm::orc::ThreadSafeModule TSM(std::move(M), std::move(Ctx));
            auto Err = JIT_ptr->addIRModule(std::move(TSM));
            if (Err)
            {
                handle_llvm_error(std::move(Err));
            }
        }

        template <typename Signature>
        std::function<Signature> get_function(const std::string &Name)
        {
            auto ExprSymbol = JIT_ptr->lookup(Name);
            if (!ExprSymbol)
            {
                handle_llvm_error(ExprSymbol.takeError());
                return nullptr;
            }

            auto *FnPtr = llvm::jitTargetAddressToPointer<Signature *>(ExprSymbol->getValue());
            return [FnPtr](auto &&...args)
            {
                return FnPtr(std::forward<decltype(args)>(args)...);
            };
        }

        // 动态绑定外部符号（供 .mmi 导出函数注入主 JIT，实现主程序 import .mmi）
        void bind_symbol(const std::string &Name, void *Addr)
        {
            auto &Dylib = JIT_ptr->getMainJITDylib();
            llvm::orc::MangleAndInterner Mangle(JIT_ptr->getExecutionSession(), JIT_ptr->getDataLayout());
            llvm::orc::SymbolMap Map;
            Map[Mangle(Name)] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(Addr),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            auto Err = Dylib.define(llvm::orc::absoluteSymbols(Map));
            if (Err)
                handle_llvm_error(std::move(Err));
        }

    private:
        void bind_hardware_api()
        {
            auto &MainDylib = JIT_ptr->getMainJITDylib();

            auto Generator = llvm::orc::DynamicLibrarySearchGenerator::GetForCurrentProcess(
                JIT_ptr->getDataLayout().getGlobalPrefix());
            if (Generator)
            {
                MainDylib.addGenerator(std::move(*Generator));
            }

            llvm::orc::MangleAndInterner Mangle(JIT_ptr->getExecutionSession(), JIT_ptr->getDataLayout());

            llvm::orc::SymbolMap HostApiMap;

            HostApiMap[Mangle("___chkstk_ms")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&quark_chkstk_stub),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_alloc")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_alloc),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_measure")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_measure),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_create_DiracState")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_create_DiracState),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_create_BellState")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_create_BellState),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_create_QuantumRegister")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_create_QuantumRegister),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_create_basis_state")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_create_basis_state),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_measure_object")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_measure_object),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_release_object")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_release_object),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_encode_text")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_encode_text),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_qlm_invoke")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qlm_invoke),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_qkm_export")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qkm_export),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_qlm_load")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qlm_load),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_encode_string")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_encode_string),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_qlm_forward")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qlm_forward),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_decode_string")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_decode_string),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_mind_read")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_mind_read),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_mind_train")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_mind_train),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_mind_feedback")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_mind_feedback),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_veda_qlm_train")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_veda_qlm_train),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            HostApiMap[Mangle("qk_surrogate")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_surrogate),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_tanh_quantize")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_tanh_quantize),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_lif_step")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_lif_step),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_mellowmax2")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_mellowmax2),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_logsumexp2")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_logsumexp2),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_boltzmann2")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_boltzmann2),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_tnorm_luk")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_tnorm_luk),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_tnorm_prod")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_tnorm_prod),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_tnorm_godel")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_tnorm_godel),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_polymer_weight")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_polymer_weight),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_polymer_mix_bound")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_polymer_mix_bound),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            // --- QCOS syscall ABI ---
            HostApiMap[Mangle("qk_sys_call")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_sys_call),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_sys_calld")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_sys_calld),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_sys_log")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_sys_log),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_sys_logi")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_sys_logi),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_sys_callp")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_sys_callp),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_gc_alloc")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_gc_alloc),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_gc_free")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_gc_free),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qms_gap")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qms_gap),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_mix_bound")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_mix_bound),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qms_conc")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qms_conc),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            // --- QChain ABI ---
            HostApiMap[Mangle("qk_qchain_wallet")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_wallet),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_balance")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_balance),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_mint")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_mint),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_transfer")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_transfer),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_mine")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_mine),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_height")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_height),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_verify")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_verify),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_qkd")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_qkd),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_qdba")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_qdba),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_coin_mint")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_coin_mint),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_coin_verify")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_coin_verify),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
                
            HostApiMap[Mangle("qk_qchain_sha3")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_sha3),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_hmac")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_hmac),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_hash_unicode")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_hash_unicode),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_sign")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_sign),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_sign_verify")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_sign_verify),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_sign_pubkey")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_sign_pubkey),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_mlkem_encaps")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_mlkem_encaps),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_mlkem_decaps")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_mlkem_decaps),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_causal_verify")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_causal_verify),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_cipher_encrypt")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_cipher_encrypt),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_qchain_cipher_decrypt")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_qchain_cipher_decrypt),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            // --- Lattice 晶格数组 ABI ---
            HostApiMap[Mangle("qk_lattice_new")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_lattice_new),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_lattice_free")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_lattice_free),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_lattice_ref")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_lattice_ref),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_lattice_set")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_lattice_set),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_lattice_rank")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_lattice_rank),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_lattice_size")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_lattice_size),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_lattice_boundary")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_lattice_boundary),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);

            // --- 经典 GUI / 图形引擎 ABI ---
            HostApiMap[Mangle("qk_cgui_init")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_init),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_should_close")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_should_close),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_begin_frame")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_begin_frame),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_end_frame")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_end_frame),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_button")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_button),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_text")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_text),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_text_int")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_text_int),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_beep")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_beep),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_width")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_width),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_height")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_height),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_panel")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_panel),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_panel_end")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_panel_end),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_row")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_row),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_mouse_x")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_mouse_x),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_mouse_y")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_mouse_y),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgui_mouse_left_clicked")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgui_mouse_left_clicked),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgfx_rect")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgfx_rect),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgfx_line")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgfx_line),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgfx_ellipse")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgfx_ellipse),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgfx_triangle")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgfx_triangle),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgfx_rect_a")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgfx_rect_a),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgfx_line_a")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgfx_line_a),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgfx_ellipse_a")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgfx_ellipse_a),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            HostApiMap[Mangle("qk_cgfx_triangle_a")] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(&qk_cgfx_triangle_a),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);


            auto Err = MainDylib.define(llvm::orc::absoluteSymbols(HostApiMap));
            if (Err)
            {
                handle_llvm_error(std::move(Err));
            }
        }
    };
}