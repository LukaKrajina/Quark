# Changelog

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.0]

### Fixed

- **QCOS 内核 shim 补充 QCOS syscall ABI**：qk 语言更新后 `server/src/ir.ts` 声明了完整 syscall ABI，但 `runtime/qcos/` 下 `qk_shim.cpp` / `qk_shim32.cpp` 仅实现 `qk_gc_alloc` 与 QMS 三函数，缺失 `qk_gc_free` / `qk_sys_call` / `qk_sys_calld` / `qk_sys_log` / `qk_sys_logi` / `qk_sys_callp`，使新语言内核链接失败。现补齐上述符号与闭包堆分配所需的 `malloc`，并新增 freestanding 辅助层 `runtime/qcos/qcos_syscall.hpp`（syscall 号 / 错误码 / x86 32·64 位串口 / TSC 单调时钟 / itoa，语义与 hosted `qhal/QcosSyscall.hpp` 一致）。

## [0.3.0]

### Added

- **QCOS 可启动内核（freestanding）**：`runtime/qcos/` 提供用 QK 编写的裸机内核引导源码树——Multiboot2 引导汇编（`boot_x86_32.S` / `boot_x86_64.S`，含长模式切换）、内核入口 `kernel_main.cpp`、`kernel_main` 桥接 `qk_shim.cpp` / `qk_shim32.cpp`、链接脚本 `linker_x86_64.ld` 与 GRUB 配置（`grub.cfg` / `grub_standalone.cfg`）。QCOS 内核隶属正式项目 [QuarkOS](https://github.com/LukaKrajina/QuarkOS)。
- **内核核心库 `qcos_core`**：新增 freestanding 静态库（`runtime/src/qcos_core.cpp`），无 LLVM / Kokkos / libstdc++ 依赖，仅靠编译器内置；新增宿主机冒烟测试 `qcos_smoke`（`runtime/src/qcos_smoke.cpp`），校验 Pmm / Sched / Spinlock / LibcSubset 逻辑。
- **纯 QK 内核构建链**：`scripts/build-qcos-kernel.ps1`（QK 源码 → LLVM IR → freestanding object → 链接引导 stub → 可启动 ELF）、`scripts/build-qcos-iso.ps1`（grub-mkrescue + xorriso → 可引导 ISO）、`scripts/build-grub-img.ps1`（grub-mkstandalone → QEMU `-kernel` 直启镜像，含 multiboot 头 VBE 标志修补）。
- **Windows 自动化构建脚本**：`scripts/build-runtime-windows.ps1`（自动定位 VS / CMake / Ninja / clang / CUDA / Kokkos / zlib / zstd / DIA SDK 并配置构建 quark_rt）、`scripts/build-kokkos-windows.ps1`（Kokkos 源码构建安装 + nvidia-smi 计算能力探测 + CUDA/OpenMP 后端）。
- **clang++ Windows 构建支持**：`runtime/CMakeLists.txt` 由 `if(MSVC)` 改为 `if(WIN32)` 平台判断；LLVM 组件改用 `LLVM_TARGETS_TO_BUILD`（覆盖 `InitializeAll*` 系列宏引用的全部后端入口）；统一依赖 CRT 运行时（Kokkos/GLFW 的 /MT 与 /MD 冲突）；`/ENTRY:mainCRTStartup` 经 `-Xlinker` 传递以兼容 clang++。
- **条件分支 `if / else if / else`**：新增 `IfStatement` AST 节点与 parser / IR / MIR lowering（`else if` 链统一表示为「else 分支只含一个 IfStatement」）。
- **新示例**：`qcos_hello.qk`（syscall ABI + QMS 数值内核）、`qcos_kernel.qk`（串口 + 位图分配器 + IDT 打包的内核镜像）、`qcos_quantum_service.qk`（量子服务下沉到裸机）、`qk_idt.qk` / `qk_idt2.qk`（IDT 条目打包）、`qk_bitmap.qk`（位图分配器）、`qk_bitwise.qk`（位运算）、`qk_buddy.qk`（伙伴系统）、`qk_basis_state.qk`（任意基构建）、`if_branching.qk`（条件分支）。

## [0.2.0]

### Added

- **工程地基**：单元测试框架（每用例异常隔离 + JUnit XML 报告）、CI 流水线（Linux 矩阵 + 覆盖率）、统一分级日志、ASan/UBSan 构建选项、`.clang-format` 代码规范。
- **核心仿真补充**：真实 IK 求解器（雅可比 DLS + 关节角提取）、量子电路仿真（拓扑感知 SWAP 路由 + 退相干误差）、VedaROS 桥真实数据流、物理阻尼系数。
- **质量门禁**：代码覆盖率选项（`QUARKRSP_COVERAGE`）、物理稳定性回归测试（能量守恒/穿透/堆叠）、性能基准 `quarkRSP_benchmark`。
- **Broadphase 接入**：BVH 宽相碰撞检测，`PhysicsKernel` 碰撞检测从 O(N²) 降到 O(N log N)（500 球体 step 提速约 7 倍）。
- **打包**：CPack 安装器（TGZ / DEB）+ 安装规则。
- **QCOS 驯龙系统 PMM**：物理内存管理器从 v1 位图分配器（`BitmapPmm`）升级为「驯龙系统」`DragonPmm`——伙伴系统 + 侵入式空闲链表 + TLSF order 位图索引 + per-CPU 页缓存，支持单核无锁快路径与多核公平票据锁（`TicketSpinlock`），并支持动态核心数（调用者提供 per-CPU 缓存数组）。
- **qk 语言新功能与新关键字**：系统级编程（`cap<T>` 能力指针 / `unsafe` / `native` 内联汇编 / `outb`·`inb` 端口 I/O / `sync_*` 原子操作 / `qk_gc_alloc`·`qk_gc_free` 内核堆 / `addr` 取地址 / `qk_sys_call` 等 syscall ABI）、量子化命名新范式（`route`/`path`/`fallback` 路由分支、`spin` 自旋循环、`fixed` 常量、`flavor` 枚举、`fuse` 模式匹配）、并发与纠缠（`spawn`/`entangle`）、QMS 数值内核（`qk_qms_gap`/`qk_mix_bound`/`qk_qms_conc`）、函数属性（`@[section]`/`@[naked]`）与堆分配构造 `make`；编译管线新增 MIR 中间表示、Polonius 风格借用检查（量子线性类型 QLT）、Q-Digest 静态竞争检测与 VCGen 最弱前置条件演算。
- **任意基构建量子态**：新增 `basis_state(theta, phi, value)` 内置函数与 `qk_create_basis_state` C ABI，用布洛赫方向 (θ, φ) 参数化任意基构建单比特量子态（与固定基的 `DiracState`/`BellState` 互补）；`IQuantumBackend` 新增 `apply_basis` 门（QVM 精确 2×2 酉矩阵 + Polyhedral_Graph 递归），并补全此前缺失的 `qk_create_DiracState` 实现。
- **国产化加速适配（龙芯 CPU + 摩尔线程 GPU）**：`qcos/Arch.hpp` 新增 LoongArch（LA64）架构检测、`idle 0` 停转与 `cpu_relax()` 放松原语（龙芯 `dbar 0`），`Spinlock.hpp` 改用 `cpu_relax()`；新增 `qhal/GpuBackend.hpp` 统一检测 CUDA / 摩尔线程 MUSA / HIP GPU 后端与 AVX / 龙芯 LSX / LASX 向量扩展；`CMakeLists.txt` 加入龙芯 CPU 识别与摩尔线程 MUSA（mcc）自动探测。

### Fixed

- 修复 `PhysicsKernel` 启用 Kokkos 并行积分时 `Kokkos::View` 在 `initialize()` 前构造导致的崩溃。
- 修复测试进程退出时 CUDA driver 卸载崩溃（`cudaErrorCudartUnloading`）。
- 修复球体/胶囊体与 AABB 碰撞法线方向不一致导致的穿透（tunneling）。

### Changed

- 物理阻尼从硬编码 `*0.999` 改为物理阻尼系数（`linear_damping`/`angular_damping`），与步长无关。
- 全模块日志从裸 `std::cout`/`std::cerr` 迁移到统一分级日志（`QUARKRSP_INFO` 等）。

## [0.1.0]

- 初始版本：量子机器人仿真平台，含物理引擎（qpc）、渲染（render）、量子电路（circuit/qpu）、遥操作（qcdrc）、强化学习（control）、硬件抽象（hardware）、VedaROS 桥（bridge）等子系统。
