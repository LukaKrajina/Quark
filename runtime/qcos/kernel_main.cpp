// ============================================================================
//  最小内核入口（x86_64，中断驱动抢占式调度演示）
//
//  由 boot_x86_64.S 的 _start 调用（已切换长模式并建立前 1GB 身份映射）。
//  入口打通「PIT 中断 → 中断 stub → 调度器 → 抢占式切换」的完整闭环：
//    1. 设置 IDT（256 向量 → interrupt.S 的 stub）
//    2. PIC 8259 重映射 + 只开 IRQ0、PIT 8253 产生周期 tick
//    3. 创建两个线程，DragonSched（E²VDF）按虚拟截止时间抢占调度
//    4. qcos_start_scheduler 经 iretq 进入首个线程，此后由 PIT 中断驱动切换
//
//  两个线程分别向串口打印 'A' / 'B'，串口应观察到 A、B 交替（抢占生效）。
// ============================================================================

#include "qcos/Serial.hpp"
#include "qcos/Arch.hpp"
#include "qcos/Idt.hpp"
#include "qcos/Irq.hpp"
#include "qcos/Timer.hpp"
#include "qcos/PreemptSched.hpp"

// ---------------------------------------------------------------------------
//  freestanding C++ runtime 支持（裸机无 libc / libstdc++）
// ---------------------------------------------------------------------------
extern "C" void* memset(void* dst, int c, size_t n)
{
    auto* d = static_cast<unsigned char*>(dst);
    for (size_t i = 0; i < n; ++i) d[i] = static_cast<unsigned char>(c);
    return dst;
}

void operator delete(void*) noexcept { /* 内核无堆释放 */ }
void operator delete(void*, size_t) noexcept { /* 内核无堆释放 */ }

extern "C" void __cxa_pure_virtual()
{
    qcos::halt();
}

// ---- 中断 stub 地址表（interrupt.S 定义）----
extern "C" const qcos::u64 isr_table[256];
extern "C" void qcos_start_scheduler(qcos::u64 first_rsp);

// ---- 全局调度器与 IDT ----
static qcos::Idt         g_idt;
static qcos::DragonSched g_sched;

// ---- 线程栈与线程 ----
alignas(16) static unsigned char g_stack_a[4096];
alignas(16) static unsigned char g_stack_b[4096];
static qcos::Thread g_thread_a;
static qcos::Thread g_thread_b;

// ---------------------------------------------------------------------------
//  中断分派：保存当前线程上下文 → 处理中断 → 选新线程 → 返回新栈指针
// ---------------------------------------------------------------------------
extern "C" qcos::u64 qcos_interrupt_dispatch(qcos::InterruptFrame* frame)
{
    using namespace qcos;

    // 保存当前线程的内核栈指针（即其中断帧）
    Thread* cur = g_sched.current();
    if (cur) cur->kernel_rsp = reinterpret_cast<u64>(frame);

    // 处理中断
    const u8 vector = static_cast<u8>(frame->vector);
    if (vector >= 0x20 && vector < 0x30)
    {
        const u8 irq = vector - 0x20;
        if (irq == 0)          // IRQ0 = PIT 定时器
            g_sched.tick();    // 时间片递减，耗尽则抢占
        pic_eoi(irq);
    }
    else
    {
        // CPU 异常：打印向量号并停机
        Serial::puts("QCOS: exception!\n");
        halt();
    }

    // 选新线程（调度器 current 已更新；首次/无任务则选最早截止）
    Thread* next = g_sched.current();
    if (!next) next = g_sched.pick_next();
    if (!next) halt();                      // 无就绪线程：停机（简化，真实应为 idle）
    next->state = ThreadState::RUNNING;

    // 返回新线程栈指针，stub 据此切换 rsp 并 iretq
    return next->kernel_rsp;
}

// ---- 演示线程：打印 'A' / 'B' 并忙等 ----
static void spin_wait()
{
    for (volatile int i = 0; i < 200000; ++i) {}
}

static void task_a(void*)
{
    while (true)
    {
        qcos::Serial::putc('A');
        spin_wait();
    }
}

static void task_b(void*)
{
    while (true)
    {
        qcos::Serial::putc('B');
        spin_wait();
    }
}

extern "C" void kernel_main()
{
    using namespace qcos;

    Serial::init();
    Serial::puts("QCOS: hello from kernel!\n");

    // ---- 中断体系：IDT + PIC + PIT ----
    // 为 256 个向量安装 interrupt.S 的中断门（interrupt gate：进门自动关中断）
    for (int i = 0; i < 256; ++i)
        g_idt.set_gate(static_cast<u8>(i), isr_table[i], GateType::INTERRUPT, 0);

    pic_remap();                 // IRQ 0-7 -> 0x20-0x27, IRQ 8-15 -> 0x28-0x2F
    pic_set_mask(0xFFFE);        // 仅开 IRQ0（PIT 定时器）
    pit_init(1000);              // PIT 1000 Hz（1ms tick）
    g_idt.load();                // lidt

    Serial::puts("QCOS: idt+pic+pit ready\n");

    // ---- 创建线程并注册到 E²VDF 调度器 ----
    thread_init(&g_thread_a, task_a, nullptr, g_stack_a + sizeof(g_stack_a));
    thread_init(&g_thread_b, task_b, nullptr, g_stack_b + sizeof(g_stack_b));
    g_thread_a.id = 1; g_thread_a.weight = 100; g_thread_a.slice = 5;
    g_thread_b.id = 2; g_thread_b.weight = 100; g_thread_b.slice = 5;
    g_sched.add(&g_thread_a);
    g_sched.add(&g_thread_b);

    // ---- 首次调度并进入首个线程（noreturn，此后由 PIT 中断驱动抢占）----
    g_sched.tick();                                     // 选首个线程（最早截止）
    Thread* first = g_sched.current();
    qcos_start_scheduler(first->kernel_rsp);            // iretq 进入线程

    // 不会到达这里
    halt();
}