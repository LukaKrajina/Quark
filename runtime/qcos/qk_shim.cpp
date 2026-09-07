// ============================================================================
//  C++ 引导 stub 与 QK 内核入口之间的桥接
//
//  boot_x86_64.S 的 32→64 位引导完成后会调用 kernel_main()。该 shim：
//   1. 提供 qk_gc_alloc / qk_gc_free 的 freestanding 实现（早期内核的简单 bump 分配器）
//   2. 提供 QCOS syscall ABI（qk_sys_call / qk_sys_calld / qk_sys_log /
//      qk_sys_logi / qk_sys_callp），串口为唯一输出通道
//   3. 转调 QK 编译出的 quark_main()，结束后停机
// ============================================================================

#include "qcos/Qms.hpp"
#include "qcos_syscall.hpp"

extern "C" int quark_main();

// ---- 早期内核 bump 分配器（后续由 QK 自己的位图分配器接管）----
static unsigned char      qcos_heap[65536];
static unsigned long long qcos_heap_cursor = 0;

extern "C" void* qk_gc_alloc(long long n)
{
    // 16 字节对齐
    qcos_heap_cursor = (qcos_heap_cursor + 15) & ~15ull;
    void* p = qcos_heap + qcos_heap_cursor;
    qcos_heap_cursor += (unsigned long long)n;
    return p;
}

// bump 分配器不支持释放；保留符号以匹配 qk 语言 ABI（后续由位图分配器接管）。
extern "C" void qk_gc_free(void* p)
{
    (void)p;
}

// 闭包（lambda）的堆分配由 IR 生成器 emit 为 @malloc；映射到同一 bump 分配器。
extern "C" void* malloc(long long n)
{
    return qk_gc_alloc(n);
}

// ---------------------------------------------------------------------------
// qk 语言（server/src/ir.ts）声明的内核侧入口。
// 语义与 runtime/include/qhal/QcosSyscall.hpp（hosted）一致，但为 freestanding：
// 串口是唯一输出通道，SYS_TIME 用 TSC 单调时钟，SYS_EXIT 停转核心。
// ---------------------------------------------------------------------------
extern "C" int32_t qk_sys_call(int32_t no, int32_t a0, int32_t a1, int32_t a2)
{
    return qcos::sys::call(no, a0, a1, a2);
}

extern "C" double qk_sys_calld(int32_t no, double a0, double a1)
{
    return qcos::sys::calld(no, a0, a1);
}

extern "C" void qk_sys_log(int32_t level, const char* msg)
{
    qcos::sys::emit_log(level, msg);
}

extern "C" int32_t qk_sys_logi(int32_t level, int32_t value)
{
    return qcos::sys::logi(level, value);
}

extern "C" void* qk_sys_callp(int32_t no, int64_t a0, int64_t a1, int64_t a2)
{
    return qcos::sys::callp(no, a0, a1, a2);
}

// ---------------------------------------------------------------------------
// 量子服务下沉（QMS）：把谱隙 / 混合界 / 方差收缩时间下沉到裸机内核，
// 供纯 QK 内核经 qk_qms_gap / qk_mix_bound / qk_qms_conc 直接调用。
// ---------------------------------------------------------------------------
extern "C" double qk_qms_gap(int32_t model, double p, double q)
{
    return qcos::qms::spectral_gap(model, p, q);
}

extern "C" double qk_mix_bound(double gap, double n, double eps)
{
    return qcos::qms::mixing_bound(gap, n, eps);
}

extern "C" double qk_qms_conc(double gap, double eps)
{
    return qcos::qms::variance_contraction_time(gap, eps);
}

extern "C" void kernel_main()
{
    qcos::sys::com1_init();
    quark_main();
    // quark_main 返回后停机
    while (true)
    {
        __asm__ volatile("hlt");
    }
}