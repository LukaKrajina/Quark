#pragma once
#include <cstdint>
#if defined(_WIN32)
#if defined(QUARK_RT_BUILD)
#define QUARK_RT_API __declspec(dllexport)
#else
#define QUARK_RT_API __declspec(dllimport)
#endif
#else
#define QUARK_RT_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C"
{
#endif

  typedef struct quark_runtime quark_runtime;

  QUARK_RT_API quark_runtime *quark_runtime_create(void);
  QUARK_RT_API void quark_runtime_destroy(quark_runtime *rt);
  QUARK_RT_API void quark_runtime_viz_start(quark_runtime *rt);
  QUARK_RT_API void quark_runtime_viz_stop(quark_runtime *rt);
  QUARK_RT_API const char *quark_runtime_compile(quark_runtime *rt, const char *ir);
  QUARK_RT_API const char *quark_runtime_execute_int(quark_runtime *rt, const char *func_name);
  QUARK_RT_API const char *quark_runtime_execute_float(quark_runtime *rt, const char *func_name);
  QUARK_RT_API const char *quark_runtime_execute_void(quark_runtime *rt, const char *func_name);
  QUARK_RT_API const char *quark_runtime_aot_compile(quark_runtime *rt,
                                                     const char *arch,
                                                     const char *mode,
                                                     const char *output_name,
                                                     const char *ir);
  QUARK_RT_API const char *quark_runtime_snapshot(quark_runtime *rt);
  QUARK_RT_API const char *quark_runtime_verify(quark_runtime *rt, const char *vc_protocol);

  typedef struct quark_mmi quark_mmi;

  QUARK_RT_API const char *quark_runtime_export_mmi(quark_runtime *rt,
                                                    const char *header_json,
                                                    const char *ir,
                                                    const char *output_path);
  QUARK_RT_API quark_mmi *quark_runtime_load_mmi(quark_runtime *rt, const char *path);
  // 加载 .mmi 并绑定其导出到主 JIT（供主程序 import .mmi 时解析 declare 符号）
  QUARK_RT_API const char *quark_runtime_bind_mmi(quark_runtime *rt, const char *alias, const char *path);
  QUARK_RT_API const char *quark_runtime_mmi_invoke(quark_mmi *m,
                                                    const char *func_name,
                                                    const char *args_json);
  QUARK_RT_API void quark_runtime_mmi_unload(quark_mmi *m);

  // ─── QChain 量子区块链服务 ABI ─────────────────────────────────
  // 供外部进程（daemon socket 协议 / CLI / HTTP / AOT 产物）直接调用量子币种与
  // 量子区块链服务，无需经过 qk 源码。内部复用 global_qm 后端的 QChainService 单例。
  QUARK_RT_API const char *quark_runtime_qchain_wallet(quark_runtime *rt);
  QUARK_RT_API const char *quark_runtime_qchain_mint(quark_runtime *rt, const char *addr, uint64_t amount);
  QUARK_RT_API const char *quark_runtime_qchain_transfer(quark_runtime *rt, const char *from, const char *to, uint64_t amount);
  QUARK_RT_API const char *quark_runtime_qchain_balance(quark_runtime *rt, const char *addr);
  QUARK_RT_API const char *quark_runtime_qchain_mine(quark_runtime *rt);
  QUARK_RT_API const char *quark_runtime_qchain_height(quark_runtime *rt);
  QUARK_RT_API const char *quark_runtime_qchain_verify(quark_runtime *rt);
  QUARK_RT_API const char *quark_runtime_qchain_qkd(quark_runtime *rt, int32_t rounds);
  QUARK_RT_API const char *quark_runtime_qchain_qdba(quark_runtime *rt, int32_t parties);

  // ─── 原生扩展库加载（供 .mmi 调用外部 C/C++ 库符号）──────────────────
  // dlopen/LoadLibrary 一个动态库，使其符号进入进程，供 .mmi 的 JIT 解析
  // （SandboxJIT 的进程符号生成器允许非 qk_ 前缀符号，如 steam_*）。
  QUARK_RT_API int32_t quark_runtime_load_native(quark_runtime *rt, const char *path);
  // 登记原生符号（供 SandboxJIT 绑定动态库符号）
  QUARK_RT_API void quark_runtime_register_native_symbol(quark_runtime *rt, const char *name, void *addr);

#ifdef __cplusplus
}
#endif