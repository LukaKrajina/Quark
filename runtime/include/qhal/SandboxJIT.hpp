#pragma once
#include "JIT.hpp"

#include <set>
#include <string>
#include <functional>
#include <stdexcept>
#include <iostream>
#include <memory>
#include <map>

#include "llvm/IRReader/IRReader.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/ExecutionEngine/Orc/EPCDynamicLibrarySearchGenerator.h"

namespace qhal
{
    // 原生扩展符号表（quark_runtime_register_native_symbol 登记，SandboxJIT 绑定）
    inline std::map<std::string, void *> &native_symbols()
    {
        static std::map<std::string, void *> s;
        return s;
    }
    inline void register_native_symbol(const std::string &name, void *addr)
    {
        native_symbols()[name] = addr;
    }

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
                                auto &ES = LJ.getExecutionSession();
                                // LLVM 23: createBareJITDylib 返回 JITDylib&，
                                // 且 JITDylib 的拷贝构造被删除，必须用引用接收。
                                auto &JD = ES.createBareJITDylib("<Sandbox Process Symbols>");
                                // 拒绝特权量子符号，允许 libc 等基础符号
                                auto AllowSymbol = [](const llvm::orc::SymbolStringPtr &Name) -> bool
                                {
                                    std::string n = (*Name).str();
                                    if (n.rfind("qk_", 0) == 0)
                                        return false;
                                    if (n.rfind("__quantum_", 0) == 0)
                                        return false;
                                    return true;
                                };
#if LLVM_VERSION_MAJOR >= 23
                                // LLVM 23: GetForTargetProcess 新增了 DylibManager& 参数。
                                auto G = llvm::orc::EPCDynamicLibrarySearchGenerator::GetForTargetProcess(
                                    ES, LJ.getDylibMgr(), AllowSymbol);
#else
                                // LLVM < 23: 仅 (ExecutionSession&, SymbolPredicate) 两参数。
                                auto G = llvm::orc::EPCDynamicLibrarySearchGenerator::GetForTargetProcess(
                                    ES, AllowSymbol);
#endif
                                 if (!G)
                                     return G.takeError();
                                 JD.addGenerator(std::move(*G));
                                 // JITDylib 继承 ThreadSafeRefCountedBase，可直接构造 JITDylibSP
                                 return llvm::orc::JITDylibSP(&JD);
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
                add("qk_create_DiracState", (void *)&qk_create_DiracState);
                add("qk_create_BellState", (void *)&qk_create_BellState);
                add("qk_create_QuantumRegister", (void *)&qk_create_QuantumRegister);
                add("qk_create_basis_state", (void *)&qk_create_basis_state);
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
                add("__quantum__qis__iqft", (void *)&__quantum__qis__iqft);
                add("__quantum__qis__cqft", (void *)&__quantum__qis__cqft);
                add("__quantum__qis__braid", (void *)&__quantum__qis__braid);
                add("__quantum__qis__cbraid", (void *)&__quantum__qis__cbraid);
                add("qk_spawn", (void *)&qk_spawn);
                // 受控门（可逆编织 @[steer]）
                add("__quantum__qis__cx", (void *)&__quantum__qis__cx);
                add("__quantum__qis__ch", (void *)&__quantum__qis__ch);
                add("__quantum__qis__crz", (void *)&__quantum__qis__crz);
                add("__quantum__qis__cswap", (void *)&__quantum__qis__cswap);
                add("__quantum__qis__c_toffoli", (void *)&__quantum__qis__c_toffoli);
                // 噪声通道注入（@[noise]/@[coherence]）
                add("__quantum__qis__apply_noise", (void *)&__quantum__qis__apply_noise);
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

            if (has("sys.log"))
            {
                add("qk_sys_log", (void *)&qk_sys_log);
                add("qk_sys_logi", (void *)&qk_sys_logi);
            }
            if (has("sys.call"))
            {
                add("qk_sys_call", (void *)&qk_sys_call);
                add("qk_sys_calld", (void *)&qk_sys_calld);
                add("qk_sys_callp", (void *)&qk_sys_callp);
            }
            if (has("sys.mem"))
            {
                add("qk_gc_alloc", (void *)&qk_gc_alloc);
                add("qk_gc_free", (void *)&qk_gc_free);
            }
            
            if (has("math.qms"))
            {
                add("qk_qms_gap", (void *)&qk_qms_gap);
                add("qk_mix_bound", (void *)&qk_mix_bound);
                add("qk_qms_conc", (void *)&qk_qms_conc);
            }

            // Lattice 晶格数组（基础能力，无条件绑定，供 .mmi 内 lattice 操作解析）
            add("qk_lattice_new", (void *)&qk_lattice_new);
            add("qk_lattice_free", (void *)&qk_lattice_free);
            add("qk_lattice_ref", (void *)&qk_lattice_ref);
            add("qk_lattice_set", (void *)&qk_lattice_set);
            add("qk_lattice_rank", (void *)&qk_lattice_rank);
            add("qk_lattice_size", (void *)&qk_lattice_size);
            add("qk_lattice_boundary", (void *)&qk_lattice_boundary);

            // 经典图形引擎 / GUI（无条件绑定，供 .mmi 内 cgfx/cgui 调用解析）
            add("qk_cgfx_rect", (void *)&qk_cgfx_rect);
            add("qk_cgfx_line", (void *)&qk_cgfx_line);
            add("qk_cgfx_ellipse", (void *)&qk_cgfx_ellipse);
            add("qk_cgfx_triangle", (void *)&qk_cgfx_triangle);
            add("qk_cgfx_rect_a", (void *)&qk_cgfx_rect_a);
            add("qk_cgfx_line_a", (void *)&qk_cgfx_line_a);
            add("qk_cgfx_ellipse_a", (void *)&qk_cgfx_ellipse_a);
            add("qk_cgfx_triangle_a", (void *)&qk_cgfx_triangle_a);
            add("qk_cgui_init", (void *)&qk_cgui_init);
            add("qk_cgui_should_close", (void *)&qk_cgui_should_close);
            add("qk_cgui_begin_frame", (void *)&qk_cgui_begin_frame);
            add("qk_cgui_end_frame", (void *)&qk_cgui_end_frame);
            add("qk_cgui_button", (void *)&qk_cgui_button);
            add("qk_cgui_text", (void *)&qk_cgui_text);
            add("qk_cgui_text_int", (void *)&qk_cgui_text_int);
            add("qk_cgui_beep", (void *)&qk_cgui_beep);
            add("qk_cgui_width", (void *)&qk_cgui_width);
            add("qk_cgui_height", (void *)&qk_cgui_height);
            add("qk_cgui_panel", (void *)&qk_cgui_panel);
            add("qk_cgui_panel_end", (void *)&qk_cgui_panel_end);
            add("qk_cgui_row", (void *)&qk_cgui_row);
            add("qk_cgui_mouse_x", (void *)&qk_cgui_mouse_x);
            add("qk_cgui_mouse_y", (void *)&qk_cgui_mouse_y);
            add("qk_cgui_mouse_left_clicked", (void *)&qk_cgui_mouse_left_clicked);

            // 原生扩展符号（LoadLibrary 加载的动态库符号，经 register_native_symbol 登记）
            for (const auto &[name, addr] : native_symbols())
            {
                add(name.c_str(), addr);
            }

            // 多维标签函数执行拓扑（@layer）调度入口（供 .mmi 的 qk_topology_entry 调用）
            add("quark_runtime_run_topology", (void *)&quark_runtime_run_topology);

            add("___chkstk_ms", (void *)&quark_chkstk_stub);

            auto E = Dylib.define(llvm::orc::absoluteSymbols(Map));
            if (E)
                handle_llvm_error(std::move(E));
        }
    };
}