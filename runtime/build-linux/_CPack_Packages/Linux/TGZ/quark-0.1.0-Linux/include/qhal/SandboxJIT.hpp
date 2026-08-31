#pragma once
#include "JIT.hpp"

#include <set>
#include <string>
#include <functional>
#include <stdexcept>
#include <iostream>
#include <memory>

#include "llvm/IRReader/IRReader.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/ExecutionEngine/Orc/EPCDynamicLibrarySearchGenerator.h"

namespace qhal
{
    class QUARK_RT_API SandboxJIT
    {
    private:
        std::unique_ptr<llvm::orc::LLJIT> JIT_ptr;
        std::set<std::string> permissions_;

        static void handle_llvm_error(llvm::Error E)
        {
            llvm::handleAllErrors(std::move(E), [](llvm::ErrorInfoBase &EIB)
                                  { std::cerr << "Sandbox JIT Error: " << EIB.message() << std::endl; });
        }

    public:
        explicit SandboxJIT(const std::set<std::string> &permissions) : permissions_(permissions)
        {
            llvm::InitializeNativeTarget();
            llvm::InitializeNativeTargetAsmPrinter();
            llvm::InitializeNativeTargetAsmParser();
            auto J = llvm::orc::LLJITBuilder()
                         .setLinkProcessSymbolsByDefault(false)
                         .setProcessSymbolsJITDylibSetup(
                             [](llvm::orc::LLJIT &LJ) -> llvm::Expected<llvm::orc::JITDylibSP>
                             {
                                 auto &JD = LJ.getExecutionSession().createBareJITDylib("<Sandbox Process Symbols>");
                                 auto G = llvm::orc::EPCDynamicLibrarySearchGenerator::GetForTargetProcess(
                                     LJ.getExecutionSession(),
                                     [](const llvm::orc::SymbolStringPtr &Name) -> bool
                                     {
                                         std::string n = (*Name).str();
                                         // 拒绝特权量子符号，允许 libc 等基础符号
                                         if (n.rfind("qk_", 0) == 0)
                                             return false;
                                         if (n.rfind("__quantum_", 0) == 0)
                                             return false;
                                         return true;
                                     });
                                 if (!G)
                                     return G.takeError();
                                 JD.addGenerator(std::move(*G));
                                 return &JD;
                             })
                         .create();
            if (!J)
            {
                handle_llvm_error(J.takeError());
                throw std::runtime_error("Sandbox LLJIT initialization failed");
            }
            JIT_ptr = std::move(*J);
            bind_whitelist();
        }

        void add_ir(const std::string &ir)
        {
            llvm::SMDiagnostic err;
            auto ctx = std::make_unique<llvm::LLVMContext>();
            auto mb = llvm::MemoryBuffer::getMemBuffer(ir);
            auto M = llvm::parseIR(*mb, err, *ctx);
            if (!M)
            {
                std::string err_str;
                llvm::raw_string_ostream os(err_str);
                err.print("SandboxJIT", os);
                throw std::runtime_error("Sandbox: invalid IR payload\n" + os.str());
            }

            auto E = JIT_ptr->addIRModule(llvm::orc::ThreadSafeModule(std::move(M), std::move(ctx)));
            if (E)
                handle_llvm_error(std::move(E));
        }

        template <typename Signature>
        std::function<Signature> get_function(const std::string &Name)
        {
            auto Sym = JIT_ptr->lookup(Name);
            if (!Sym)
                return nullptr;
            auto *FnPtr = llvm::jitTargetAddressToPointer<Signature *>(Sym->getValue());
            return [FnPtr](auto &&...args)
            {
                return FnPtr(std::forward<decltype(args)>(args)...);
            };
        }

        void *lookup_address(const std::string &Name)
        {
            auto Sym = JIT_ptr->lookup(Name);
            if (!Sym)
                return nullptr;
            return reinterpret_cast<void *>(Sym->getValue());
        }

        void bind_symbol(const std::string &Name, void *Addr)
        {
            auto &Dylib = JIT_ptr->getMainJITDylib();
            llvm::orc::MangleAndInterner M(JIT_ptr->getExecutionSession(), JIT_ptr->getDataLayout());
            llvm::orc::SymbolMap Map;
            Map[M(Name)] = llvm::orc::ExecutorSymbolDef(
                llvm::orc::ExecutorAddr::fromPtr(Addr),
                llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            auto E = Dylib.define(llvm::orc::absoluteSymbols(Map));
            if (E)
                handle_llvm_error(std::move(E));
        }

    private:
        bool has(const std::string &p) const { return permissions_.count(p) != 0; }

        void bind_whitelist()
        {
            auto &Dylib = JIT_ptr->getMainJITDylib();
            llvm::orc::MangleAndInterner M(JIT_ptr->getExecutionSession(), JIT_ptr->getDataLayout());
            llvm::orc::SymbolMap Map;

            auto add = [&](const char *name, void *fn)
            {
                Map[M(name)] = llvm::orc::ExecutorSymbolDef(
                    llvm::orc::ExecutorAddr::fromPtr(fn),
                    llvm::JITSymbolFlags::Exported | llvm::JITSymbolFlags::Callable);
            };

            if (has("quantum.allocate"))
            {
                add("qk_alloc", (void *)&qk_alloc);
                add("qk_create_BellState", (void *)&qk_create_BellState);
                add("qk_create_QuantumRegister", (void *)&qk_create_QuantumRegister);
                add("__quantum__rt__qubit_allocate", (void *)&__quantum__rt__qubit_allocate);
            }
            if (has("quantum.measure"))
            {
                add("qk_measure", (void *)&qk_measure);
                add("qk_measure_object", (void *)&qk_measure_object);
                add("__quantum__qis__measure_int", (void *)&__quantum__qis__measure_int);
            }
            if (has("quantum.gate"))
            {
                add("__quantum__qis__h", (void *)&__quantum__qis__h);
                add("__quantum__qis__x", (void *)&__quantum__qis__x);
                add("__quantum__qis__rz", (void *)&__quantum__qis__rz);
                add("__quantum__qis__cnot", (void *)&__quantum__qis__cnot);
                add("__quantum__qis__toffoli", (void *)&__quantum__qis__toffoli);
                add("__quantum__qis__swap", (void *)&__quantum__qis__swap);
                add("__quantum__qis__qft", (void *)&__quantum__qis__qft);
                add("__quantum__qis__braid", (void *)&__quantum__qis__braid);
                add("__quantum__qis__measure_basis", (void *)&__quantum__qis__measure_basis);
            }
            if (has("quantum.release"))
            {
                add("qk_release_object", (void *)&qk_release_object);
                add("__quantum__rt__qubit_release", (void *)&__quantum__rt__qubit_release);
            }
            if (has("qlm.encode"))
            {
                add("qk_encode_text", (void *)&qk_encode_text);
                add("qk_encode_string", (void *)&qk_encode_string);
            }
            if (has("qlm.train"))
            {
                add("qk_qlm_invoke", (void *)&qk_qlm_invoke);
                add("qk_mind_train", (void *)&qk_mind_train);
                add("qk_veda_qlm_train", (void *)&qk_veda_qlm_train);
            }
            if (has("qlm.infer"))
            {
                add("qk_qlm_load", (void *)&qk_qlm_load);
                add("qk_qlm_forward", (void *)&qk_qlm_forward);
                add("qk_decode_string", (void *)&qk_decode_string);
            }

            add("___chkstk_ms", (void *)&quark_chkstk_stub);

            auto E = Dylib.define(llvm::orc::absoluteSymbols(Map));
            if (E)
                handle_llvm_error(std::move(E));
        }
    };
}