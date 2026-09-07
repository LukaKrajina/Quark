// ============================================================================
//  32 位引导桥接（QEMU Multiboot1 直启演示用）
//
//  与 qk_shim.cpp 同理：提供 qk_gc_alloc / qk_gc_free 的 freestanding 实现、
//  QCOS syscall ABI，并转调 QK 的 quark_main()。
//  32 位版本用 32 位指针与32 位 bump 游标。
// ============================================================================

#include "qcos_syscall.hpp"

extern "C" int quark_main();

static unsigned char qcos_heap[65536];
static unsigned int  qcos_heap_cursor = 0;

extern "C" void* qk_gc_alloc(long long n)
{
    qcos_heap_cursor = (qcos_heap_cursor + 15) & ~15u;
    void* p = qcos_heap + qcos_heap_cursor;
    qcos_heap_cursor += (unsigned int)n;
    return p;
}

// bump 分配器不支持释放；保留符号以匹配 qk 语言 ABI。
extern "C" void qk_gc_free(void* p)
{
    (void)p;
}

// 闭包（lambda）的堆分配由 IR 生成器 emit 为 @malloc；映射到同一 bump 分配器。
extern "C" void* malloc(long long n)
{
    return qk_gc_alloc(n);
}

// ---- QCOS syscall ABI（与 qk_shim.cpp 一致，实现见 qcos_syscall.hpp）----
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

extern "C" void kernel_main()
{
    qcos::sys::com1_init();
    quark_main();
    while (true)
    {
        __asm__ volatile("hlt");
    }
}