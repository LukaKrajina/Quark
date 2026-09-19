// ============================================================================
// MirModuleBuilder
// 把 server 端序列化的 MIR（CFG）用 LLVM C++ API 构建为LLVM Module。
//
// 与字符串拼接（旧 ir.ts）不同：这里用 llvm::IRBuilder 构建SSA IR，
// 构建后经 llvm::verifyModule 校验，并可挂优化 pass（mem2reg / instcombine）。
//
// MIR 序列化格式见 server/src/mir-serialize.ts：
//   { version: 1, bodies: [ { owner, returnTy, params, locals, blocks } ] }
//
// 核心映射（MIR → LLVM）：
//   MirLocalDecl               → entry 块内 alloca（变量以 load/store 访问，mem2reg 可优化）
//   Assign(place = rvalue)     → 求值 rvalue 后 store 到 place 的 alloca
//   Use(Copy/Move/Ref place)   → load place 的 alloca
//   Const(Int/Float/Str/...)   → ConstantInt / ConstantFP / 全局字符串
//   Binary(op)                 → add/sub/mul/sdiv/fdiv/icmp 等
//   Call(target, args, retTy)  → declare + call
//   Goto(target)               → br label %target
//   SwitchInt(disc, targets)   → switch / br（条件二分支时）
//   Return(value)              → ret
//
// ============================================================================
#pragma once

#include <memory>
#include <string>
#include <vector>
#include <map>
#include <unordered_map>
#include <stdexcept>

#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/Verifier.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/BasicBlock.h"
#include "llvm/IR/Type.h"
#include "llvm/IR/DerivedTypes.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/Value.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/InlineAsm.h"
#include "llvm/Support/raw_ostream.h"

#include "json.hpp" // qhal::json（独立解析器，避免 MMI → JIT → vendor 依赖链）

namespace qhal
{

/** MIR 构建产物：Module 与其 LLVMContext 必须成对传给 JIT（ThreadSafeModule 需要）。
 *  注意：context 必须声明在 module 之前，使 module 先析构、context 后析构
 *  （Module 持有 LLVMContext& 引用，若 context 先析构会悬垂崩溃）。 */
struct BuiltMirModule
{
    std::unique_ptr<llvm::LLVMContext> context;
    std::unique_ptr<llvm::Module> module;
};

class MirModuleBuilder
{
public:
    BuiltMirModule build(const std::string &mir_json, const std::string &module_name = "mir_module")
    {
        ctx_ = std::make_unique<llvm::LLVMContext>();
        module_ = std::make_unique<llvm::Module>(module_name, *ctx_);
        builder_ = std::make_unique<llvm::IRBuilder<>>(*ctx_);

        json::Value doc = json::parse(mir_json);
        if (!doc.is_object() || !doc.has("bodies") || !doc.at("bodies").is_array())
            throw std::runtime_error("MIR: missing bodies array");

        // 解析 form 定义，建立结构类型 { i8* vtable, fields... }（字段索引从 1 开始）。
        form_types_.clear();
        if (doc.has("forms") && doc.at("forms").is_array())
        {
            for (const auto &fv : doc.at("forms").array())
            {
                const std::string fname = fv.at("name").string();
                std::vector<llvm::Type *> elems;
                elems.push_back(llvm::PointerType::get(*ctx_, 0)); // vtable 指针
                for (const auto &f : fv.at("fields").array())
                    elems.push_back(mapType(f.at("ty").string()));
                form_types_[fname] = llvm::StructType::create(*ctx_, elems, "form." + fname);
            }
        }

        // 第一遍：为每个 body 预声明函数（支持前向调用）。
        // 参数类型需从 locals 表取：先收集每个 body 的「param local id → 类型」映射。
        std::unordered_map<std::string, std::vector<llvm::Type *>> param_types_by_owner;
        for (const auto &bv : doc.at("bodies").array())
        {
            const std::string owner = bv.at("owner").string();
            // locals 表：id → ty
            std::unordered_map<int, std::string> local_ty;
            if (bv.has("locals"))
            {
                for (const auto &l : bv.at("locals").array())
                    local_ty[l.at("id").int_value()] = l.at("ty").string();
            }
            std::vector<llvm::Type *> param_types;
            if (bv.has("params"))
            {
                for (const auto &pid : bv.at("params").array())
                {
                    int id = pid.int_value();
                    auto it = local_ty.find(id);
                    param_types.push_back(it != local_ty.end() ? mapType(it->second) : llvm::Type::getInt32Ty(*ctx_));
                }
            }
            param_types_by_owner[owner] = param_types;
        }

        for (const auto &bv : doc.at("bodies").array())
        {
            const std::string owner = bv.at("owner").string();
            const std::string ret_ty = bv.has("returnTy") && !bv.at("returnTy").is_null()
                                           ? bv.at("returnTy").string()
                                           : std::string("void");
            llvm::FunctionType *ft = llvm::FunctionType::get(mapType(ret_ty), param_types_by_owner[owner], false);
            llvm::Function *fn = llvm::Function::Create(ft, llvm::Function::ExternalLinkage, owner, module_.get());
            funcs_[owner] = fn;
        }

        // 第二遍：逐个 body 填充函数体
        for (const auto &bv : doc.at("bodies").array())
        {
            buildBody(bv);
        }

        // 拓扑入口：从 @layer 标签聚合调度表，生成 qk_topology_entry
        emitTopologyEntry(doc);

        // 校验
        std::string err;
        llvm::raw_string_ostream os(err);
        if (llvm::verifyModule(*module_, &os))
            throw std::runtime_error("MIR: verifyModule failed:\n" + err);

        BuiltMirModule out;
        out.module = std::move(module_);
        builder_.reset();              // builder 持有 ctx_ 引用，先释放避免悬垂
        out.context = std::move(ctx_); // 再安全 move ctx_
        return out;
    }

private:
    std::unique_ptr<llvm::LLVMContext> ctx_;
    std::unique_ptr<llvm::Module> module_;
    std::unique_ptr<llvm::IRBuilder<>> builder_;
    std::unordered_map<std::string, llvm::Function *> funcs_;
    std::unordered_map<int, llvm::AllocaInst *> local_alloca_;  // local id -> alloca
    std::unordered_map<int, std::string> local_types_;          // local id -> qk 类型名（Drop/Consume 释放用）
    std::unordered_map<std::string, llvm::StructType *> form_types_; // form 名 -> 结构类型
    llvm::Function *current_fn_ = nullptr;
    std::unordered_map<int, llvm::BasicBlock *> blocks_;   // block id -> BasicBlock

    // ---- 类型映射 -----------------------------------------------------------
    llvm::Type *mapType(const std::string &ty)
    {
        auto &c = *ctx_;
        if (ty == "int8" || ty == "uint8" || ty == "char" || ty == "bool") return llvm::Type::getInt8Ty(c);
        if (ty == "int16" || ty == "uint16") return llvm::Type::getInt16Ty(c);
        if (ty == "int" || ty == "int32" || ty == "uint32") return llvm::Type::getInt32Ty(c);
        if (ty == "int64" || ty == "uint64") return llvm::Type::getInt64Ty(c);
        if (ty == "float") return llvm::Type::getFloatTy(c);
        if (ty == "double") return llvm::Type::getDoubleTy(c);
        if (ty == "void") return llvm::Type::getVoidTy(c);
        if (ty == "string" || ty == "i8*") return llvm::PointerType::get(c, 0);
        if (ty == "Qubit" || ty == "QObject" || ty == "QModel" || ty == "QReservoir" || ty == "Lattice")
            return llvm::PointerType::get(c, 0); // opaque 指针
        if (ty.rfind("cap<", 0) == 0)
            return llvm::PointerType::get(c, 0); // 能力指针 → 裸指针
        if (ty.rfind("lattice<", 0) == 0)
            return llvm::PointerType::get(c, 0);
        // 未知类型按 i32 兜底（骨架阶段；随迁移逐步精确化）
        return llvm::Type::getInt32Ty(c);
    }

    // ---- LLVM 文本类型 → Type（内建函数签名表用）------------------------------
    llvm::Type *mapLLVMType(const std::string &t)
    {
        auto &c = *ctx_;
        if (t == "i1") return llvm::Type::getInt1Ty(c);
        if (t == "i8") return llvm::Type::getInt8Ty(c);
        if (t == "i16") return llvm::Type::getInt16Ty(c);
        if (t == "i32") return llvm::Type::getInt32Ty(c);
        if (t == "i64") return llvm::Type::getInt64Ty(c);
        if (t == "float") return llvm::Type::getFloatTy(c);
        if (t == "double") return llvm::Type::getDoubleTy(c);
        if (t == "void") return llvm::Type::getVoidTy(c);
        if (t == "ptr" || t == "i8*") return llvm::PointerType::get(c, 0);
        return llvm::PointerType::get(c, 0); // 默认 opaque 指针
    }

    /** 值 → 目标类型（i32→i64 zext、i32→double/float sitofp、i32→i16/i8 trunc） */
    llvm::Value *coerceTo(llvm::Value *v, llvm::Type *target)
    {
        if (v->getType() == target) return v;
        if (v->getType()->isIntegerTy(32) && target->isIntegerTy(64))
            return builder_->CreateZExt(v, target, "zext");
        if (v->getType()->isIntegerTy(32) && target->isIntegerTy(16))
            return builder_->CreateTrunc(v, target, "trunc");
        if (v->getType()->isIntegerTy(32) && target->isIntegerTy(8))
            return builder_->CreateTrunc(v, target, "trunc");
        if (v->getType()->isIntegerTy(32) && target->isDoubleTy())
            return builder_->CreateSIToFP(v, target, "sitofp");
        if (v->getType()->isIntegerTy(32) && target->isFloatTy())
            return builder_->CreateSIToFP(v, target, "sitofp");
        return v; // 兜底：交给 verifyModule 报类型不匹配
    }

    struct BuiltinSig { const char *symbol; const char *ret; std::vector<const char *> params; };
    static const std::map<std::string, BuiltinSig> &builtinSigs()
    {
        static const std::map<std::string, BuiltinSig> m = {
            // 量子核心 / QLM
            {"encode_text", {"qk_encode_text", "ptr", {"ptr"}}},
            {"encode_image", {"qk_encode_text", "ptr", {"ptr"}}},
            {"qlm_invoke", {"qk_qlm_invoke", "ptr", {"ptr", "i32", "double"}}},
            {"qlm_load", {"qk_qlm_load", "ptr", {"ptr"}}},
            {"qlm_forward", {"qk_qlm_forward", "void", {"ptr", "ptr"}}},
            {"qk_encode_string", {"qk_encode_string", "ptr", {"ptr"}}},
            {"qk_decode_string", {"qk_decode_string", "ptr", {"ptr"}}},
            // 脑机接口
            {"mind_read", {"qk_mind_read", "ptr", {"ptr"}}},
            {"mind_train", {"qk_mind_train", "void", {"ptr", "i32", "double"}}},
            {"mind_feedback", {"qk_mind_feedback", "void", {"ptr"}}},
            {"veda_qlm_train", {"qk_veda_qlm_train", "void", {"ptr", "i32", "double"}}},
            // QRC 量子储备池
            {"qrc_new", {"qk_qrc_new", "ptr", {"i32", "i32"}}},
            {"qrc_train", {"qk_qrc_train", "void", {"ptr", "i32", "double"}}},
            {"qrc_probe", {"qk_qrc_probe", "ptr", {"ptr", "ptr"}}},
            {"qrc_predict", {"qk_qrc_predict", "ptr", {"ptr", "ptr"}}},
            {"qrc_release", {"qk_qrc_release", "void", {"ptr"}}},
            // 神经 / 软逻辑原语
            {"surrogate", {"qk_surrogate", "double", {"double", "double", "double"}}},
            {"tanh_quantize", {"qk_tanh_quantize", "double", {"double", "double", "i32"}}},
            {"lif_step", {"qk_lif_step", "double", {"double", "double", "double", "double"}}},
            {"mellowmax2", {"qk_mellowmax2", "double", {"double", "double", "double"}}},
            {"logsumexp2", {"qk_logsumexp2", "double", {"double", "double", "double"}}},
            {"boltzmann2", {"qk_boltzmann2", "double", {"double", "double", "double"}}},
            {"tnorm_luk", {"qk_tnorm_luk", "double", {"double", "double"}}},
            {"tnorm_prod", {"qk_tnorm_prod", "double", {"double", "double"}}},
            {"tnorm_godel", {"qk_tnorm_godel", "double", {"double", "double"}}},
            {"polymer_weight", {"qk_polymer_weight", "double", {"double", "double", "double"}}},
            {"polymer_mix_bound", {"qk_polymer_mix_bound", "double", {"double", "double"}}},
            // QCOS syscall
            {"qk_sys_call", {"qk_sys_call", "i32", {"i32", "i32", "i32", "i32"}}},
            {"qk_sys_calld", {"qk_sys_calld", "double", {"i32", "double", "double"}}},
            {"qk_sys_log", {"qk_sys_log", "void", {"i32", "ptr"}}},
            {"qk_sys_logi", {"qk_sys_logi", "i32", {"i32", "i32"}}},
            {"qk_sys_callp", {"qk_sys_callp", "ptr", {"i32", "i64", "i64", "i64"}}},
            {"qk_gc_alloc", {"qk_gc_alloc", "ptr", {"i64"}}},
            {"qk_gc_free", {"qk_gc_free", "void", {"ptr"}}},
            // QMS 数值内核
            {"qk_qms_gap", {"qk_qms_gap", "double", {"i32", "double", "double"}}},
            {"qk_mix_bound", {"qk_mix_bound", "double", {"double", "double", "double"}}},
            {"qk_qms_conc", {"qk_qms_conc", "double", {"double", "double"}}},
            // QChain 量子区块链
            {"qchain_wallet", {"qk_qchain_wallet", "ptr", {}}},
            {"qchain_balance", {"qk_qchain_balance", "i64", {"ptr"}}},
            {"qchain_mint", {"qk_qchain_mint", "void", {"ptr", "i64"}}},
            {"qchain_transfer", {"qk_qchain_transfer", "i32", {"ptr", "ptr", "i64"}}},
            {"qchain_mine", {"qk_qchain_mine", "i32", {}}},
            {"qchain_height", {"qk_qchain_height", "i32", {}}},
            {"qchain_verify", {"qk_qchain_verify", "i32", {}}},
            {"qchain_qkd", {"qk_qchain_qkd", "ptr", {"i32"}}},
            {"qchain_qdba", {"qk_qchain_qdba", "i32", {"i32"}}},
            {"qchain_coin_mint", {"qk_qchain_coin_mint", "ptr", {"i32"}}},
            {"qchain_coin_verify", {"qk_qchain_coin_verify", "i32", {"ptr"}}},
            {"qchain_sha3", {"qk_qchain_sha3", "ptr", {"ptr"}}},
            {"qchain_hmac", {"qk_qchain_hmac", "ptr", {"ptr", "ptr"}}},
            {"qchain_hash_unicode", {"qk_qchain_hash_unicode", "ptr", {"ptr"}}},
            {"qchain_sign", {"qk_qchain_sign", "ptr", {"ptr"}}},
            {"qchain_sign_verify", {"qk_qchain_sign_verify", "i32", {"ptr", "ptr"}}},
            {"qchain_sign_pubkey", {"qk_qchain_sign_pubkey", "ptr", {}}},
            {"qchain_mlkem_encaps", {"qk_qchain_mlkem_encaps", "ptr", {"ptr"}}},
            {"qchain_mlkem_decaps", {"qk_qchain_mlkem_decaps", "ptr", {"ptr", "ptr"}}},
            {"qchain_causal_verify", {"qk_qchain_causal_verify", "i32", {}}},
            {"qchain_cipher_encrypt", {"qk_qchain_cipher_encrypt", "ptr", {"i64", "ptr"}}},
            {"qchain_cipher_decrypt", {"qk_qchain_cipher_decrypt", "ptr", {"i64", "ptr"}}},
            // 晶格内省 + 访问
            {"lattice_rank", {"qk_lattice_rank", "i32", {"ptr"}}},
            {"lattice_size", {"qk_lattice_size", "i32", {"ptr", "i32"}}},
            {"lattice_boundary", {"qk_lattice_boundary", "i32", {"ptr"}}},
            {"qk_lattice_ref", {"qk_lattice_ref", "i32", {"ptr", "i32", "i32"}}},
            {"qk_lattice_new", {"qk_lattice_new", "ptr", {"i32", "i32", "i32", "i32"}}},
            {"qk_lattice_free", {"qk_lattice_free", "void", {"ptr"}}},
            {"qk_lattice_set", {"qk_lattice_set", "void", {"ptr", "i32", "i32", "i32"}}},
            // 量子对象构造 / 测量 / 释放（普通 declare+call）
            {"qk_create_DiracState", {"qk_create_DiracState", "ptr", {"i32"}}},
            {"qk_create_BellState", {"qk_create_BellState", "ptr", {}}},
            {"qk_create_QuantumRegister", {"qk_create_QuantumRegister", "ptr", {"i32"}}},
            {"qk_create_basis_state", {"qk_create_basis_state", "ptr", {"double", "double", "i32"}}},
            {"qk_measure_object", {"qk_measure_object", "i32", {"ptr"}}},
            {"qk_extract_qubit", {"qk_extract_qubit", "ptr", {"ptr", "i32"}}},
            {"qk_release_object", {"qk_release_object", "void", {"ptr"}}},
            {"qk_qkm_export", {"qk_qkm_export", "void", {"ptr", "ptr"}}},
            // 经典 GUI（cgui_*）—— qk_cgui_* ABI
            {"cgui_init", {"qk_cgui_init", "i32", {"i32", "i32", "ptr"}}},
            {"cgui_should_close", {"qk_cgui_should_close", "i32", {}}},
            {"cgui_begin_frame", {"qk_cgui_begin_frame", "void", {}}},
            {"cgui_end_frame", {"qk_cgui_end_frame", "void", {}}},
            {"cgui_button", {"qk_cgui_button", "i32", {"ptr"}}},
            {"cgui_text", {"qk_cgui_text", "void", {"ptr"}}},
            {"cgui_text_int", {"qk_cgui_text_int", "void", {"i32"}}},
            {"cgui_beep", {"qk_cgui_beep", "void", {"i32", "i32"}}},
            {"cgui_width", {"qk_cgui_width", "i32", {}}},
            {"cgui_height", {"qk_cgui_height", "i32", {}}},
            {"cgui_panel", {"qk_cgui_panel", "void", {"i32", "i32", "i32", "i32", "ptr"}}},
            {"cgui_panel_end", {"qk_cgui_panel_end", "void", {}}},
            {"cgui_row", {"qk_cgui_row", "void", {"i32", "i32"}}},
            {"cgui_mouse_x", {"qk_cgui_mouse_x", "i32", {}}},
            {"cgui_mouse_y", {"qk_cgui_mouse_y", "i32", {}}},
            {"cgui_mouse_left_clicked", {"qk_cgui_mouse_left_clicked", "i32", {}}},
            // 经典图形引擎（cgfx_*）—— qk_cgfx_* ABI
            {"cgfx_rect", {"qk_cgfx_rect", "void", {"i32", "i32", "i32", "i32", "i32"}}},
            {"cgfx_line", {"qk_cgfx_line", "void", {"i32", "i32", "i32", "i32", "i32", "i32"}}},
            {"cgfx_ellipse", {"qk_cgfx_ellipse", "void", {"i32", "i32", "i32", "i32", "i32"}}},
            {"cgfx_triangle", {"qk_cgfx_triangle", "void", {"i32", "i32", "i32", "i32", "i32", "i32", "i32"}}},
            {"cgfx_rect_a", {"qk_cgfx_rect_a", "void", {"i32", "i32", "i32", "i32", "i32", "i32"}}},
            {"cgfx_line_a", {"qk_cgfx_line_a", "void", {"i32", "i32", "i32", "i32", "i32", "i32", "i32"}}},
            {"cgfx_ellipse_a", {"qk_cgfx_ellipse_a", "void", {"i32", "i32", "i32", "i32", "i32", "i32"}}},
            {"cgfx_triangle_a", {"qk_cgfx_triangle_a", "void", {"i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32"}}},
        };
        return m;
    }

    struct GateSig { const char *symbol; const char *ret; std::vector<const char *> params; };
    /** QIR 量子门映射（QGate 的 gate 名 → QIR 符号 + 签名） */
    static const std::map<std::string, GateSig> &gateSigs()
    {
        static const std::map<std::string, GateSig> m = {
            {"h", {"__quantum__qis__h", "void", {"ptr"}}},
            {"x", {"__quantum__qis__x", "void", {"ptr"}}},
            {"rz", {"__quantum__qis__rz", "void", {"double", "ptr"}}},
            {"cnot", {"__quantum__qis__cnot", "void", {"ptr", "ptr"}}},
            {"toffoli", {"__quantum__qis__toffoli", "void", {"ptr", "ptr", "ptr"}}},
            {"swap", {"__quantum__qis__swap", "void", {"ptr", "ptr"}}},
            {"qft", {"__quantum__qis__qft", "void", {"i32"}}},
            {"iqft", {"__quantum__qis__iqft", "void", {"i32"}}},
            {"cqft", {"__quantum__qis__cqft", "void", {"ptr", "i32"}}},
            {"braid", {"__quantum__qis__braid", "void", {"ptr", "ptr"}}},
            {"cbraid", {"__quantum__qis__cbraid", "void", {"ptr", "ptr", "ptr"}}},
            {"measure_basis", {"__quantum__qis__measure_basis", "i32", {"ptr", "i8"}}},
            // 受控门（可逆编织 @[steer]）
            {"cx", {"__quantum__qis__cx", "void", {"ptr", "ptr"}}},
            {"ch", {"__quantum__qis__ch", "void", {"ptr", "ptr"}}},
            {"crz", {"__quantum__qis__crz", "void", {"ptr", "ptr", "double"}}},
            {"cswap", {"__quantum__qis__cswap", "void", {"ptr", "ptr", "ptr"}}},
            {"c_toffoli", {"__quantum__qis__c_toffoli", "void", {"ptr", "ptr", "ptr", "ptr"}}},
        };
        return m;
    }

    /** 特殊内建：原子 / 端口 I/O / 地址（非 declare+call，生成 LLVM 特殊指令） */
    llvm::Value *buildSpecialCall(const json::Value &call, const std::string &target)
    {
        const auto &args = call.at("args").array();
        if (target == "sync_load")
        {
            llvm::Value *p = buildOperand(args[0]);
            llvm::LoadInst *li = builder_->CreateLoad(llvm::Type::getInt32Ty(*ctx_), p, "atomicload");
            li->setAtomic(llvm::AtomicOrdering::SequentiallyConsistent);
            return li;
        }
        if (target == "sync_store")
        {
            llvm::Value *p = buildOperand(args[0]);
            llvm::Value *v = buildOperand(args[1]);
            llvm::StoreInst *si = builder_->CreateStore(v, p);
            si->setAtomic(llvm::AtomicOrdering::SequentiallyConsistent);
            return si;
        }
        if (target == "sync_add")
        {
            llvm::Value *p = buildOperand(args[0]);
            llvm::Value *v = buildOperand(args[1]);
            return builder_->CreateAtomicRMW(llvm::AtomicRMWInst::Add, p, v, llvm::MaybeAlign(4),
                                             llvm::AtomicOrdering::SequentiallyConsistent);
        }
        if (target == "sync_cas")
        {
            llvm::Value *p = buildOperand(args[0]);
            llvm::Value *oldV = buildOperand(args[1]);
            llvm::Value *newV = buildOperand(args[2]);
            llvm::AtomicCmpXchgInst *cx = builder_->CreateAtomicCmpXchg(
                p, oldV, newV, llvm::MaybeAlign(4),
                llvm::AtomicOrdering::SequentiallyConsistent, llvm::AtomicOrdering::SequentiallyConsistent);
            return builder_->CreateExtractValue(cx, 0, "casval");
        }
        if (target == "addr")
        {
            llvm::Value *p = buildOperand(args[0]);
            return builder_->CreatePtrToInt(p, llvm::Type::getInt32Ty(*ctx_), "addr");
        }
        if (target == "outb")
        {
            // outb(port, value)：port=i16(dx)、value=i8(ax)
            llvm::Value *port = coerceTo(buildOperand(args[0]), llvm::Type::getInt16Ty(*ctx_));
            llvm::Value *value = coerceTo(buildOperand(args[1]), llvm::Type::getInt8Ty(*ctx_));
            llvm::FunctionType *ft = llvm::FunctionType::get(llvm::Type::getVoidTy(*ctx_),
                {llvm::Type::getInt8Ty(*ctx_), llvm::Type::getInt16Ty(*ctx_)}, false);
            llvm::InlineAsm *ia = llvm::InlineAsm::get(ft, "outb ${0:b}, ${1:w}",
                "{ax},{dx},~{dirflag},~{fpsr},~{flags}", true);
            return builder_->CreateCall(ia, {value, port});
        }
        if (target == "inb")
        {
            // inb(port)：port=i16(dx)，返回 i8(al) 后 zext 到 i32
            llvm::Value *port = coerceTo(buildOperand(args[0]), llvm::Type::getInt16Ty(*ctx_));
            llvm::FunctionType *ft = llvm::FunctionType::get(llvm::Type::getInt8Ty(*ctx_),
                {llvm::Type::getInt16Ty(*ctx_)}, false);
            llvm::InlineAsm *ia = llvm::InlineAsm::get(ft, "inb ${1:w}, ${0:b}",
                "={ax},{dx},~{dirflag},~{fpsr},~{flags}", true);
            llvm::Value *res = builder_->CreateCall(ia, {port}, "inb");
            return builder_->CreateZExt(res, llvm::Type::getInt32Ty(*ctx_), "inbzext");
        }
        return nullptr;
    }

    // ---- 拓扑入口（@layer 多维标签函数调度）--------------------------------
    // 从 MIR 的 layer 标签聚合调度表（shape + blocks），生成 @qk_topology_json
    // 常量与 @qk_topology_entry 函数（调用 quark_runtime_run_topology）。
    void emitTopologyEntry(const json::Value &doc)
    {
        struct LayerInfo { std::string name; int time; int thread; };
        std::vector<LayerInfo> layers;
        int maxTime = 0, maxThread = 0;
        for (const auto &bv : doc.at("bodies").array())
        {
            if (!bv.has("layer") || bv.at("layer").is_null())
                continue;
            const auto &ly = bv.at("layer");
            LayerInfo li;
            li.name = bv.at("owner").string();
            li.time = ly.has("time") && !ly.at("time").is_null() ? ly.at("time").int_value() : 0;
            li.thread = ly.has("thread") ? ly.at("thread").int_value() : 0;
            if (li.time > maxTime) maxTime = li.time;
            if (li.thread > maxThread) maxThread = li.thread;
            layers.push_back(std::move(li));
        }
        if (layers.empty())
            return;

        std::string json = "{\"shape\":{\"time\":" + std::to_string(maxTime + 1) +
                           ",\"thread\":" + std::to_string(maxThread + 1) +
                           ",\"coord\":[1]},\"blocks\":[";
        for (size_t i = 0; i < layers.size(); ++i)
        {
            if (i) json += ",";
            json += "{\"name\":\"" + layers[i].name + "\",\"time\":" + std::to_string(layers[i].time) +
                    ",\"thread\":" + std::to_string(layers[i].thread) + "}";
        }
        json += "]}";

        llvm::Constant *str = llvm::ConstantDataArray::getString(*ctx_, json, true);
        auto *gv = new llvm::GlobalVariable(*module_, str->getType(), true,
                                            llvm::GlobalValue::PrivateLinkage, str, "qk_topology_json");

        llvm::Function *entry = llvm::Function::Create(
            llvm::FunctionType::get(llvm::Type::getInt32Ty(*ctx_), false),
            llvm::Function::ExternalLinkage, "qk_topology_entry", module_.get());
        llvm::BasicBlock *bb = llvm::BasicBlock::Create(*ctx_, "entry", entry);
        builder_->SetInsertPoint(bb);

        llvm::Function *run = declareFn("quark_runtime_run_topology",
                                        llvm::Type::getInt32Ty(*ctx_), {llvm::PointerType::get(*ctx_, 0)});
        llvm::Value *ptr = builder_->CreatePointerCast(gv, llvm::PointerType::get(*ctx_, 0), "jsonptr");
        llvm::Value *ret = builder_->CreateCall(run, {ptr}, "ret");
        builder_->CreateRet(ret);
    }

    // ---- 函数体构建 ---------------------------------------------------------
    void buildBody(const json::Value &bv)
    {
        const std::string owner = bv.at("owner").string();
        llvm::Function *fn = funcs_.at(owner);
        current_fn_ = fn;
        local_alloca_.clear();
        blocks_.clear();

        // 先创建所有基本块
        for (const auto &bb : bv.at("blocks").array())
        {
            int id = bb.at("id").int_value();
            blocks_[id] = llvm::BasicBlock::Create(*ctx_, "bb" + std::to_string(id), fn);
        }

        // entry：alloca 所有 locals（参数对应的 local 由实参 store 进来）。
        // void 槽（QGate 等无返回值 rvalue 的落点）不分配存储——alloca void 非法。
        builder_->SetInsertPoint(blocks_[0]);
        for (const auto &l : bv.at("locals").array())
        {
            int id = l.at("id").int_value();
            std::string ty = l.at("ty").string();
            llvm::Type *t = mapType(ty);
            local_types_[id] = ty;
            if (t->isVoidTy())
                continue;
            local_alloca_[id] = builder_->CreateAlloca(t, nullptr, "v" + std::to_string(id));
        }

        // 逐块逐语句填充
        for (const auto &bb : bv.at("blocks").array())
        {
            int id = bb.at("id").int_value();
            builder_->SetInsertPoint(blocks_[id]);
            for (const auto &stmt : bb.at("statements").array())
            {
                buildStatement(stmt);
            }
            if (bb.has("terminator") && !bb.at("terminator").is_null())
            {
                buildTerminator(bb.at("terminator"));
            }
        }
    }

    // ---- 语句 -----------------------------------------------------------------
    void buildStatement(const json::Value &stmt)
    {
        const std::string kind = stmt.at("kind").string();
        if (kind == "Assign")
        {
            int local = stmt.at("place").at("local").int_value();
            llvm::Value *val = buildRvalue(stmt.at("rvalue"));
            // void 型 rvalue（如 QGate 门调用）仅执行副作用，不产生值，跳过 store
            if (!val->getType()->isVoidTy())
                builder_->CreateStore(val, local_alloca_.at(local));
        }
        else if (kind == "Drop" || kind == "Consume")
        {
            // 线性类型的显式释放/消费：加载 place，按类型调用运行时释放内建。
            int local = stmt.at("place").at("local").int_value();
            auto it = local_alloca_.find(local);
            if (it == local_alloca_.end())
                return; // void 槽无存储
            llvm::Value *ptr = builder_->CreateLoad(it->second->getAllocatedType(), it->second, "dropval");
            const std::string ty = local_types_.count(local) ? local_types_.at(local) : "";
            if (ty == "Qubit")
            {
                llvm::Function *f = declareFn("__quantum__rt__qubit_release",
                                              llvm::Type::getVoidTy(*ctx_), {llvm::PointerType::get(*ctx_, 0)});
                builder_->CreateCall(f, {ptr});
            }
            else if (ty == "QObject" || ty.rfind("QModel", 0) == 0 || ty.rfind("QReservoir", 0) == 0)
            {
                llvm::Function *f = declareFn("qk_release_object",
                                              llvm::Type::getVoidTy(*ctx_), {llvm::PointerType::get(*ctx_, 0)});
                builder_->CreateCall(f, {ptr});
            }
            // 其他类型（cap/int 等）：Drop 无副作用（内存由 GC 管理）
        }
        else
        {
            throw std::runtime_error("MIR: unsupported statement kind '" + kind + "'");
        }
    }

    // ---- 右值 -----------------------------------------------------------------
    llvm::Value *buildRvalue(const json::Value &rv)
    {
        const std::string kind = rv.at("kind").string();
        if (kind == "Use")
        {
            return buildOperand(rv.at("operand"));
        }
        if (kind == "Binary")
        {
            llvm::Value *lhs = buildOperand(rv.at("lhs"));
            llvm::Value *rhs = buildOperand(rv.at("rhs"));
            const std::string op = rv.at("op").string();
            if (op == "+") return builder_->CreateAdd(lhs, rhs, "addtmp");
            if (op == "-") return builder_->CreateSub(lhs, rhs, "subtmp");
            if (op == "*") return builder_->CreateMul(lhs, rhs, "multmp");
            if (op == "/")
            {
                // 整数除法 sdiv / 浮点 fdiv 由类型决定；骨架按 lhs 类型粗判
                return lhs->getType()->isFloatingPointTy()
                           ? builder_->CreateFDiv(lhs, rhs, "divtmp")
                           : builder_->CreateSDiv(lhs, rhs, "divtmp");
            }
            if (op == "%") return builder_->CreateSRem(lhs, rhs, "remtmp");
            if (op == "==") return builder_->CreateICmpEQ(lhs, rhs, "eqtmp");
            if (op == "!=") return builder_->CreateICmpNE(lhs, rhs, "netmp");
            if (op == "<") return builder_->CreateICmpSLT(lhs, rhs, "lttmp");
            if (op == "<=") return builder_->CreateICmpSLE(lhs, rhs, "letmp");
            if (op == ">") return builder_->CreateICmpSGT(lhs, rhs, "gttmp");
            if (op == ">=") return builder_->CreateICmpSGE(lhs, rhs, "getmp");
            if (op == "|") return builder_->CreateOr(lhs, rhs, "ortmp");
            if (op == "&") return builder_->CreateAnd(lhs, rhs, "andtmp");
            if (op == "^") return builder_->CreateXor(lhs, rhs, "xortmp");
            if (op == "<<") return builder_->CreateShl(lhs, rhs, "shltmp");
            if (op == ">>") return builder_->CreateAShr(lhs, rhs, "ashrtmp");
            throw std::runtime_error("MIR: unsupported binary op '" + op + "'");
        }
        if (kind == "Unary")
        {
            llvm::Value *arg = buildOperand(rv.at("arg"));
            const std::string op = rv.at("op").string();
            if (op == "-") return builder_->CreateNeg(arg, "negtmp");
            if (op == "!") return builder_->CreateICmpEQ(arg, llvm::ConstantInt::get(arg->getType(), 0), "nottmp");
            throw std::runtime_error("MIR: unsupported unary op '" + op + "'");
        }
        if (kind == "Call")
        {
            return buildCall(rv);
        }
        if (kind == "QAlloc")
        {
            // alloc() → __quantum__rt__qubit_allocate()
            llvm::Function *f = declareFn("__quantum__rt__qubit_allocate", llvm::PointerType::get(*ctx_, 0), {});
            return builder_->CreateCall(f, {}, "qubit");
        }
        if (kind == "QMeasure")
        {
            // measure(q) → __quantum__qis__measure_int(q) : i32
            llvm::Value *arg = buildOperand(rv.at("arg"));
            llvm::Function *f = declareFn("__quantum__qis__measure_int", llvm::Type::getInt32Ty(*ctx_),
                                          {llvm::PointerType::get(*ctx_, 0)});
            return builder_->CreateCall(f, {arg}, "measure");
        }
        if (kind == "QGate")
        {
            const std::string gate = rv.at("gate").string();
            std::vector<llvm::Value *> arg_vals;
            for (const auto &a : rv.at("args").array())
                arg_vals.push_back(buildOperand(a));

            // 内建门 → QIR 内建（__quantum__qis__<gate>）
            const auto &gs = gateSigs();
            auto it = gs.find(gate);
            if (it != gs.end())
            {
                const GateSig &sig = it->second;
                std::vector<llvm::Type *> ptypes;
                for (const char *p : sig.params) ptypes.push_back(mapLLVMType(p));
                for (size_t i = 0; i < arg_vals.size() && i < ptypes.size(); ++i)
                    arg_vals[i] = coerceTo(arg_vals[i], ptypes[i]);
                llvm::Function *f = declareFn(sig.symbol, mapLLVMType(sig.ret), ptypes);
                llvm::CallInst *call = builder_->CreateCall(f, arg_vals);
                if (!call->getType()->isVoidTy())
                    call->setName("gate"); // void 指令不能有名字
                return call;
            }

            // 用户自定义门（@[gate] 函数）→ call @<gate>（借用 Qubit 参数）
            if (funcs_.count(gate))
            {
                llvm::Function *f = funcs_.at(gate);
                for (size_t i = 0; i < arg_vals.size() && i < f->arg_size(); ++i)
                    arg_vals[i] = coerceTo(arg_vals[i], f->getArg(i)->getType());
                llvm::CallInst *call = builder_->CreateCall(f, arg_vals);
                if (!call->getType()->isVoidTy())
                    call->setName("gate");
                return call;
            }

            throw std::runtime_error("MIR: unknown quantum gate '" + gate + "'");
        }
        if (kind == "NewObject")
        {
            const std::string className = rv.at("className").string();
            std::vector<llvm::Value *> arg_vals;
            for (const auto &a : rv.at("args").array())
                arg_vals.push_back(buildOperand(a));

            // 内建量子对象构造 → qk_create_* 内建（与 ir.ts 对齐）
            if (className == "BellState")
                return callObjectCtor("qk_create_BellState", {}, arg_vals);
            if (className == "DiracState")
                return callObjectCtor("qk_create_DiracState", {"i32"}, arg_vals);
            if (className == "QuantumRegister")
                return callObjectCtor("qk_create_QuantumRegister", {"i32"}, arg_vals);

            // lattice<T, B> 构造 → qk_lattice_new(rank, dim0, dim1, boundary)
            if (className.rfind("lattice<", 0) == 0)
            {
                std::vector<llvm::Value *> ctor;
                ctor.push_back(llvm::ConstantInt::get(llvm::Type::getInt32Ty(*ctx_), (int)arg_vals.size()));
                for (size_t i = 0; i < arg_vals.size() && i < 2; ++i)
                    ctor.push_back(coerceTo(arg_vals[i], llvm::Type::getInt32Ty(*ctx_)));
                while (ctor.size() < 3)
                    ctor.push_back(llvm::ConstantInt::get(llvm::Type::getInt32Ty(*ctx_), 1));
                ctor.push_back(llvm::ConstantInt::get(llvm::Type::getInt32Ty(*ctx_), 0)); // boundary=open
                return callObjectCtor("qk_lattice_new", {"i32", "i32", "i32", "i32"}, ctor);
            }

            // form 类型等结构化构造：首版仍占位（结构化类型 gep 后续补全）
            return llvm::ConstantPointerNull::get(llvm::PointerType::get(*ctx_, 0));
        }
        if (kind == "Member")
        {
            // form 字段访问：用 fieldIndex + fieldType 生成精确 getelementptr + load。
            llvm::Value *obj = buildOperand(rv.at("object"));
            if (rv.has("fieldIndex") && rv.has("fieldType"))
            {
                int fieldIndex = rv.at("fieldIndex").int_value();
                llvm::Type *fieldTy = mapType(rv.at("fieldType").string());
                // 从 object 的 local 类型查 form 结构类型，生成精确 getelementptr
                llvm::StructType *st = nullptr;
                const auto &objOp = rv.at("object");
                if (objOp.has("place") && objOp.at("place").has("local"))
                {
                    int local = objOp.at("place").at("local").int_value();
                    auto lt = local_types_.find(local);
                    if (lt != local_types_.end())
                    {
                        auto ft = form_types_.find(lt->second);
                        if (ft != form_types_.end()) st = ft->second;
                    }
                }
                if (st)
                {
                    llvm::Value *gep = builder_->CreateStructGEP(st, obj, fieldIndex, "fieldptr");
                    return builder_->CreateLoad(fieldTy, gep, "field");
                }
                // 无结构类型（object 非局部变量）：按 i8 偏移近似（首字段）
                llvm::Value *gep = builder_->CreateConstInBoundsGEP1_64(llvm::Type::getInt8Ty(*ctx_), obj, 8, "memptr");
                return builder_->CreateLoad(fieldTy, gep, "field");
            }
            // 无字段信息的 Member（如 QObject 属性）：占位空指针
            return llvm::ConstantPointerNull::get(llvm::PointerType::get(*ctx_, 0));
        }
        if (kind == "Ref")
        {
            // &x → 取 place 的 alloca 地址
            int local = rv.at("place").at("local").int_value();
            return local_alloca_.at(local);
        }
        throw std::runtime_error("MIR: unsupported rvalue kind '" + kind + "'");
    }

    /** 对象构造调用：declare + call，返回 opaque 指针 */
    llvm::Value *callObjectCtor(const char *symbol, const std::vector<const char *> &params,
                                const std::vector<llvm::Value *> &args)
    {
        std::vector<llvm::Type *> ptypes;
        for (const char *p : params) ptypes.push_back(mapLLVMType(p));
        std::vector<llvm::Value *> coerced = args;
        for (size_t i = 0; i < coerced.size() && i < ptypes.size(); ++i)
            coerced[i] = coerceTo(coerced[i], ptypes[i]);
        llvm::Function *f = declareFn(symbol, llvm::PointerType::get(*ctx_, 0), ptypes);
        return builder_->CreateCall(f, coerced, "obj");
    }

    // ---- 操作数 ---------------------------------------------------------------
    llvm::Value *buildOperand(const json::Value &op)
    {
        const std::string kind = op.at("kind").string();
        if (kind == "Const")
        {
            const json::Value &c = op.at("value");
            const std::string ck = c.at("kind").string();
            if (ck == "Int") return llvm::ConstantInt::get(llvm::Type::getInt32Ty(*ctx_), c.at("value").int64_value());
            if (ck == "Float") return llvm::ConstantFP::get(llvm::Type::getDoubleTy(*ctx_), c.at("value").number());
            if (ck == "Bool") return llvm::ConstantInt::get(llvm::Type::getInt1Ty(*ctx_), c.at("value").bool_value() ? 1 : 0);
            if (ck == "Str" || ck == "Char")
            {
                // 全局字符串常量
                const std::string s = c.at("value").string();
                return builder_->CreateGlobalString(s, "str");
            }
            throw std::runtime_error("MIR: unsupported const kind '" + ck + "'");
        }
        if (kind == "Copy" || kind == "Move")
        {
            int local = op.at("place").at("local").int_value();
            return builder_->CreateLoad(local_alloca_.at(local)->getAllocatedType(), local_alloca_.at(local), "loadtmp");
        }
        if (kind == "Ref")
        {
            int local = op.at("place").at("local").int_value();
            return local_alloca_.at(local);
        }
        throw std::runtime_error("MIR: unsupported operand kind '" + kind + "'");
    }

    // ---- 函数调用 -------------------------------------------------------------
    /** 调用并命名（void 返回不命名，避免 verifier "void value" 错误） */
    llvm::CallInst *emitCall(llvm::Function *f, const std::vector<llvm::Value *> &args)
    {
        llvm::CallInst *call = builder_->CreateCall(f, args);
        if (!call->getType()->isVoidTy())
            call->setName("calltmp");
        return call;
    }

    llvm::Value *buildCall(const json::Value &call)
    {
        const std::string target = call.at("target").string();
        const std::string ret_ty = call.has("retTy") && !call.at("retTy").is_null()
                                       ? call.at("retTy").string()
                                       : std::string("int32");

        // 特殊内建：原子 / 端口 I/O / 地址（生成 LLVM 特殊指令，非 declare+call）
        if (target == "sync_load" || target == "sync_store" || target == "sync_add" ||
            target == "sync_cas" || target == "outb" || target == "inb" || target == "addr")
            return buildSpecialCall(call, target);

        std::vector<llvm::Value *> arg_vals;
        for (const auto &a : call.at("args").array())
            arg_vals.push_back(buildOperand(a));

        // 用户函数：符号名 = target，签名由 MIR 的 retTy + 实参类型决定
        if (funcs_.count(target))
        {
            std::vector<llvm::Type *> arg_types;
            for (auto *v : arg_vals) arg_types.push_back(v->getType());
            llvm::Function *f = declareFn(target, mapType(ret_ty), arg_types);
            return emitCall(f, arg_vals);
        }

        // 内建函数：查签名表（精确 LLVM 符号名 + 签名 + 实参类型对齐）
        const auto &sigs = builtinSigs();
        auto it = sigs.find(target);
        if (it != sigs.end())
        {
            const BuiltinSig &sig = it->second;
            std::vector<llvm::Type *> param_types;
            for (const char *p : sig.params) param_types.push_back(mapLLVMType(p));

            for (size_t i = 0; i < arg_vals.size() && i < param_types.size(); ++i)
                arg_vals[i] = coerceTo(arg_vals[i], param_types[i]);

            llvm::Function *f = declareFn(sig.symbol, mapLLVMType(sig.ret), param_types);
            return emitCall(f, arg_vals);
        }

        // 未知函数：兜底 declare（符号名 = target）
        std::vector<llvm::Type *> arg_types;
        for (auto *v : arg_vals) arg_types.push_back(v->getType());
        llvm::Function *f = declareFn(target, mapType(ret_ty), arg_types);
        return emitCall(f, arg_vals);
    }

    llvm::Function *declareFn(const std::string &name, llvm::Type *ret, const std::vector<llvm::Type *> &args)
    {
        if (funcs_.count(name))
            return funcs_.at(name); // 用户函数已预声明
        llvm::FunctionType *ft = llvm::FunctionType::get(ret, args, false);
        llvm::Function *f = module_->getFunction(name);
        if (!f)
            f = llvm::Function::Create(ft, llvm::Function::ExternalLinkage, name, module_.get());
        return f;
    }

    // ---- 终结符 ---------------------------------------------------------------
    void buildTerminator(const json::Value &term)
    {
        const std::string kind = term.at("kind").string();
        if (kind == "Goto")
        {
            builder_->CreateBr(blocks_.at(term.at("target").int_value()));
        }
        else if (kind == "Return")
        {
            if (term.has("value") && !term.at("value").is_null())
                builder_->CreateRet(buildOperand(term.at("value")));
            else
                builder_->CreateRetVoid();
        }
        else if (kind == "Unreachable")
        {
            builder_->CreateUnreachable();
        }
        else if (kind == "SwitchInt")
        {
            llvm::Value *disc = buildOperand(term.at("discriminant"));
            // 收集 target；value==null 者为 default
            llvm::BasicBlock *default_bb = nullptr;
            std::vector<std::pair<int, llvm::BasicBlock *>> cases;
            for (const auto &t : term.at("targets").array())
            {
                llvm::BasicBlock *bb = blocks_.at(t.at("target").int_value());
                if (t.has("value") && !t.at("value").is_null())
                    cases.emplace_back(t.at("value").int_value(), bb);
                else
                    default_bb = bb;
            }
            if (!default_bb)
                default_bb = &current_fn_->back(); // 兜底
            if (cases.size() == 1)
            {
                // 单分支（无 default 的典型 if）→ icmp + 条件 br
                llvm::Value *cmp = builder_->CreateICmpEQ(disc, llvm::ConstantInt::get(disc->getType(), cases[0].first), "swcmp");
                builder_->CreateCondBr(cmp, cases[0].second, default_bb);
            }
            else
            {
                llvm::SwitchInst *sw = builder_->CreateSwitch(disc, default_bb, cases.size());
                for (const auto &[v, bb] : cases)
                    sw->addCase(llvm::ConstantInt::get(llvm::cast<llvm::IntegerType>(disc->getType()), v), bb);
            }
        }
        else if (kind == "Call")
        {
            // Call 终结符（尾调用）：骨架阶段按 void 调用后 fallthrough 到 next
            buildCall(term);
            if (term.has("next"))
                builder_->CreateBr(blocks_.at(term.at("next").int_value()));
        }
        else
        {
            throw std::runtime_error("MIR: unsupported terminator kind '" + kind + "'");
        }
    }
};

} // namespace qhal
