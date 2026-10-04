# Changelog

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.9.3] (vsx 0.3.3)

### Added

- **`@[coherence]` 多通道退相干建模**：`computeNoise()` 原只能返回单一噪声通道，被迫把不同物理来源折叠成一个强度。现返回**通道列表**，由 `emitNoiseIfNeeded()` 依次注入：T1（能量弛豫）→ 振幅阻尼（channel 2），T2 中的纯退相部分 → 相位阻尼（channel 1），按严格分解 `1/T_φ = 1/T2 − 1/(2·T1)` 各自用自身时间常数定强度。实测 `@[coherence(100,50)]` 产出 `i32 2 / 0.010000` 与 `i32 1 / 0.015000`（= 1/50 − 1/200），与物理公式吻合。`@[noise]` 路径仍为单通道，行为不变。
- **morph 宏的编辑器支持**：`hover-docs.ts` 新增 `morph` 中英双语悬停文档（作用 / 语法 / 元变量七种类 / 三条硬约束 / 示例）；`syntaxes/quark.tmLanguage.json` 新增 `morph` 关键字高亮与宏元变量 `$name`、字符串化 `#$name` 的高亮规则；`server.ts` 关键字表补入 `morph`（补全与语义高亮）。
- **编辑器高亮细分（各有各的颜色）**：语义 token legend 由 7 类扩为 13 类（`keyword` / `type` / `class` / `function` / `macro` / `method` / `decorator` / `constant` / `enum` / `number` / `string` / `operator` / `variable`），并按类别着色：控制流与声明关键字、经典类型 vs 量子类型（`Qubit` 等走 `class`）、内建函数、量子门（`h`/`x`/`cnot`… 走 `method`）、`morph` 宏（`macro`）、注解标签 `@layer`/`@[gate]`（`decorator`）、`flavor`（`enum`）、`true`/`false`/`null`（`constant`）。量子门在词法层已不是关键字，故补按名称识别，使调用点也能正确着色。
- **智能感知补全（前缀过滤 + 相关度排序）**：补全此前一次性返回全部条目、无过滤，依赖客户端兜底。现按光标前标识符前缀（输入 `all` 即得 `alloc` 等）在服务端过滤，并按「精确匹配 > 前缀匹配 > 子串匹配」排序（同档按长度短者优先）；新增**量子门**类别补全，并为函数/门补 `insertText`（自动带 `(`），注解标签改用 `Property` 图标以便与关键字区分；无前缀时限量 200 条避免弹出卡顿。
- **Linux/WSL 侧交叉验证**：本轮 C++ 改动（qchain 密码学 KEM 工厂与开关、签名工厂去静默降级、时空加密改用 ML-KEM-768、区间约束的仿射与变量-变量传播、端点预测器告警、内核 idle 线程）已在 WSL (Ubuntu, clang++ 21) 下以 `-fsyntax-only` 全部通过。依赖 Kokkos 的部分（`utils/Ga.hpp` 等）未能在 Linux 侧验证——WSL 复用的是 Windows 版 Kokkos（其 `CUDAToolkit_ROOT` 为 Windows 路径），需在 WSL 内独立安装 Linux 版 Kokkos 后方可完整构建。
- **测试与文档回填**：新增 15 项测试——SSA 支配树（4 项，含「分支内定义、汇合块使用」这一文本顺序检查会漏报的用例，以及 entry 定义 / 循环回边 / 函数参数三类**不应误报**的用例）、`E-TOP007` 触发与「维度差为 1 仍属合法投影」（3 项）、QRC `qrc_new` 三参形态与 `qrc_train_ex` 签名/类型检查（8 项）。全量测试 255 → 270。语言手册 §12.10 补 `qrc_new(qubits, layers, out_dim)` 第三参与 `qrc_train_ex`（真实训练数据；`inputs`/`targets` 为扁平 `double` 缓冲，类型可用 `cap<double>` 或 `arr<double, N>`），并明确 `qrc_train` 跑合成正弦仅属自检、非通用训练入口；§19.2 错误表补 `E-TOP007`，并订正 `E-TOP002`（维度不一致检查此前已放宽为 no-op）。
- **morph 态射宏系统（全局 · 卫生即规范不变性 · 宏即用户定义的内建）**：新增元编程机制 `morph`，在编译期把「语法模式」变换为「代码」，是对 `#define` 文本宏的范式替代，三条硬约束：① **全局**——仅顶层声明，与内建函数同命名空间，不允许局部宏，展开不依赖局部作用域（与程序组合可交换）；② **卫生 = 规范不变性**——模板引入的绑定（`let` / `fn` 名 / 参数 / 类型声明）在每次展开时 α-重命名取新原子，杜绝 `#define SWAP` 式变量捕获；③ **不用 `#define`**——展开发生在词法层、parse 之前，产物重新进入类型 / 借用 / 拓扑检查。一期元变量：`expr` / `stmt` / `items` / `type` / `ident` / `literal` / `tt`；支持 `$(...)*` / `$(...)+` 重复生成、`#$name` 字符串化、限深递归（上限 64）；调用统一 `name!(...)`。实现落在 `server/src/morph.ts`（token 树构建 → 模式/模板解析 → 匹配/实例化 → 不动点展开），配合 `lexer.ts`（新增 `morph` 关键字、`$` / `#` token、`Lexer.fromTokens`）与 `parser.ts`（`parse()` 词法层接入，零侵入 AST）。`morph.test.ts` 覆盖卫生 / 全局 / 重复 / 种类报错 / 递归 / 字符串化共 12 项。

### Fixed

- **少参调用 `qrc_train_ex` / `qrc_new` 导致 IR 生成崩溃**：新加的 codegen 直接索引 `arguments[3..7]`，实参不足时抛 `TypeError: Cannot read properties of undefined` 中断整个编译（语义层虽会另报 `Signature Error`，但 IR 层不应崩溃）。现对缺失实参填占位值继续生成，并补 `assert.doesNotThrow` 防回归测试。

## [0.9.2] (vsx 0.3.2)

### Added

- **侧边栏编译目标新增 `android`**：`client/src/quarkSidebar.ts` 的 `COMPILE_TARGETS` 增加 `android`（`aarch64-linux-android`，带 NDK 提示 tooltip、专用 `device-mobile` 图标，并标注各目标的 LLVM triple）；`extension.ts` 的 `quark.setCompileTarget` 增加目标合法性校验（避免命令面板调用把 `undefined` 写进 `workspaceState`）；选中 Android 执行 AOT 编译时，控制台会提示所需 NDK 交叉编译器与 `QUARK_ANDROID_CLANGXX` / `QUARK_ANDROID_SYSROOT` / `QUARK_ANDROID_RT_DIR` 环境变量，并指引用 `qk build apk` 打包 APK。
- **一键构建 Android APK（`quark.buildApk`）**：侧边栏「操作」新增 **Build APK (Android)**（单击直接出 debug 包；从命令面板调用时弹出 Debug/Release 选择），编辑器标题栏也加入该按钮。服务端按 `QUARK_ROOT` → 工作区根 → cwd/自身向上 定位 `scripts/build-apk.sh` 并 `spawn bash` 执行（与 CLI `qk build apk` 同一编排），stdout/stderr 实时回显到 Quark Console，耗时与结果写入性能面板。Windows 上优先使用 Git Bash（`%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe` 是 WSL 启动器，无法解析 `D:\...` 形式的脚本路径），可用 `QUARK_BASH` 覆盖；未找到脚本或缺少 bash 时给出明确指引。

### Fixed

- **AOT 编译目标不生效（侧边栏编译目标形同虚设）**：`server.ts` 发送的 `CMD_AOT_COMPILE` 载荷多写了一个 `compile` 前缀（`compile <arch> <name>`），而后端按 `<arch> <mode> <name>` 解析，于是 `arch` 被当成 `"compile"`、`mode` 被当成目标名——无论侧边栏选 x32/x64/arm64/android，实际都按宿主默认 triple 编译。现在按 `<arch> -e <name>` 发送。
- **Windows 宿主上的 Android 目标补齐**：`Compiler.hpp` 的 `_WIN32` 分支此前缺少 `aarch64-linux-android` triple 映射（会静默回退到宿主 triple），且输出后缀名硬套 `.dll`/`.exe`；现 Android 目标在 Windows 宿主上同样产出 ELF（`-m` → `.so`，`-e` 无后缀），并在找不到 NDK 链接器时给出可操作提示。
- **CUDA 设备通道下 `qk_qrc_*` 未声明（曾阻塞 Windows 运行时构建）**：`SandboxJIT.hpp` 无条件绑定 QRC 符号，但其声明只在 `qml/QrcAbi.hpp` 里、且依赖包含顺序（`runtime_api.cpp` 先包含 `MMI.hpp`）。现在 `SandboxJIT.hpp` 自行包含该 ABI 头，头文件自洽。
- **Windows 资源编译失败（`build.bat` 固定 RC 编译器）**：clang-cl 工具链下 CMake 会生成 `cmake_llvm_rc` 包装规则；若它自动探测到 Windows SDK 的 `rc.exe`，会把 clang 风格参数喂给 rc.exe 导致失败。`build.bat` 现显式指定 `-DCMAKE_RC_COMPILER=<LLVM>/llvm-rc.exe`。

## [0.9.1] (vsx 0.3.1)

### Added

- **量子非欧几里德曲面体几何原语**：语言层新增 `geodesic_distance(QObject, QObject)` / `inversion(double)` / `hyperbolic_metric(double)` / `hyperbolic_distance(double, double)` 四个内建；新增 C ABI `runtime/include/qml/GeodesicAbi.hpp`——`qk_geodesic_distance` 用 SWAP-test 重叠给出 Fubini-Study 测地线距离 `arccos|⟨a|b⟩|`（复用 `qk_qattention`），`qk_inversion` 实现 T-对偶反转 `R → 1/R`，`qk_hyperbolic_metric` / `qk_hyperbolic_distance` 给出 Poincaré 球度规 `4/(1-|x|²)²` 与双曲距离。`server/src/mir.ts` 把 `geodesic_distance` 纳入 `QOBJ_BORROW_FNS`（借用 QObject 而非消费，避免 QLT 误报 E-Q001）。
- **量子通道逆因果容量（回程能力）**：语言层新增 7 个内建——`retrocausal_imax(kind, p)` / `retrocausal_idoe(kind, p)` / `retrocausal_q_capacity(kind, p)` / `retrocausal_c_capacity(kind, p)` / `retrocausal_q_one_shot(kind, p, eps)` / `retrocausal_gain(kind, p)` / `retrocausal_deformed(kind, p, x)`；新增 C ABI `qml/RetrocausalAbi.hpp` 与内核 `runtime/include/spacetime/RetrocausalCapacity.hpp`：Choi 矩阵 `choi_matrix`、max-information / Doeblin information（`retrocausal_info`）、正则化 Doeblin `idoe_regularized`、前向 Holevo 基准 `forward_classical_capacity`、渐近与单次 q/c 容量、q-变形容量 `q_retrocausal_capacity`、后选择放大协议 `amplified_teleportation`、容量流 `retrocausal_flow` / `retrocausal_flow_perturbed`。预置信道 `kind`：`0`=去极化、`1`=退相、`2`=比特翻转、`3`=振幅阻尼、`4`=幺正 Hadamard、`5`=比特-相位翻转。
- **快子 KK 双空间嘈杂 CTC 通信（n 个 DD 维度）**：语言层新增 `retrocausal_ctc_q_capacity(n, theta, mu2, lambda)` / `retrocausal_ctc_c_capacity(...)` / `retrocausal_ctc_gain(...)` / `retrocausal_ctc_dephasing(theta)`；新增 C ABI `qml/RetrocausalCTCAbi.hpp` 与内核 `spacetime/RetrocausalCTC.hpp`——`KaluzaKleinND`（n 个额外维 S¹ 的 KK 动量、模式质量平方、快子质量平方与模式不对称）、`TachyonCTCNoise`（几何 → 噪声映射：退相 `asym/(1+asym)`、去极化 `n/(n+1)`、振幅阻尼 `μ²/(μ²+λ)`）、Kraus 串行组合 `tachyon_ctc_channel` 与 `MultiTopologyRetrocausal`（逐维度容量与容量-维度曲线）。`@layer(coord=(c₀,…,c_{n−1}))` 的 coord 维度即额外维数 n。
- **`@layer(..., dual=1)` 对偶标记与三类新拓扑边**：`dual` 标记 T-对偶反转空间；拓扑推导新增 `projection`（coord 维度不同 → 曲面体投影）、`inversion`（同 coord + `dual=1`）、`crossing`（同 coord 异 thread）三类边（`ast.ts` 的 `TopologyEdge`）。
- **拓扑调度入口（编译期 → 运行时）**：含 `@layer` 的模块额外生成调度表常量 `@qk_topology_json` 与入口 `define i32 @qk_topology_entry()`，后者调用新运行时接口 `quark_runtime_run_topology(i8*)`——按 `time` 分层，同层按 coord 的 L1 码距并行调度（虚拟线程 → 残差并发 → 码距逻辑 qubit 布局），阈值由环境变量 `QUARK_TOPOLOGY_MIN_DISTANCE` 调整。
- **新拓扑诊断**：`E-TOP005`（叠加链坐标空槽 gap）、`E-TOP006`（调用传播延迟超出 `deadline`）；新增调用传播边 `TopologyCallEdge`（`startAt` / `deltaT`），子函数锚点 = 父锚点 + 累计延迟（`cost` 之和）。
- **SoftLogic / 神经 / QMS 原语 ABI 化**：新增 `runtime/include/qml/SoftLogicAbi.hpp`，把 `qk_surrogate` / `qk_tanh_quantize` / `qk_lif_step` / `qk_mellowmax2` / `qk_logsumexp2` / `qk_boltzmann2` / `qk_tnorm_luk|prod|godel` / `qk_polymer_weight` / `qk_polymer_mix_bound` / `qk_qms_gap` / `qk_mix_bound` / `qk_qms_conc` 统一为 `extern "C"` 导出。
- **SandboxJIT 无条件符号绑定扩展**：geodesic / retrocausal / CTC / 软逻辑 / QMS 原语全部无条件绑定，`.mmi` 沙箱内可直接执行这些推理原语。
- **文档补齐**：语言手册新增 §12.12（量子通道逆因果容量）、§12.13（快子 KK 双空间嘈杂 CTC 通信）、§12.14（非欧几里德曲面体几何），§8.1 补充 `dual` 与三类新拓扑边、拓扑调度说明，§19.1 关键字表补入全部 `retrocausal_*` / `retrocausal_ctc_*`；悬停文档 `hover-docs.ts` 补入 `retrocausal_*` / `retrocausal_ctc_*` 中英双语说明。

### Changed

- **`E-TOP002` 放宽**：坐标维度一致性检查改为 no-op——曲面体允许不同块使用不同 coord 维度，改为推导 `projection` 边（`validateCoordDims` 不再报错）。
- **SoftLogic / QMS 原语定义位置迁移**：由 `qhal/JIT.hpp` 内的 inline 定义迁移到 `qml/SoftLogicAbi.hpp` 的「`extern "C"` 声明 + `#if QUARK_RT_BUILD` 单点定义」，并由 `runtime/src/runtime_api.cpp` 统一 include。
- **MIR body 增加调度元数据**：`MirBody` 新增 `layer?: {time?, thread, coord}`，随 body JSON 序列化下发（供 MIR 下沉器与沙箱使用）。
- **VSIX 单包双平台 + 双平台开箱即用**：`bin/` 按平台分子目录（`win32-x64/`、`linux-x64/`），一个 vsix 同时携带 Windows 与 Linux 运行时，安装后按 `process.platform` 自动选择（`server.ts` 的 `resolveRuntime()`，并在 Linux/macOS 上按需 `chmod 0755`，因 zip 不保留可执行位）。两条运行时链路都做到**自包含**：
  - **Windows**：随包携带 `libomp.dll`、`vulkan-1.dll` 与 MSVC 运行库（`msvcp140`/`vcruntime140*`，app-local 部署），不再要求用户安装 VC++ 运行库或 Vulkan 运行时。
  - **Linux**：LLVM 改为**静态链接**（自建精简静态 LLVM，仅 X86/NVPTX/AArch64 后端），Kokkos 亦静态（PIC）并入 `libquark_rt.so`；随包携带 `libvulkan.so.1` / `libglfw.so.3` / `libomp.so.5`。不再要求目标机安装 LLVM / Vulkan SDK / GLFW / OpenMP 运行时。
- **Linux 旧发行版兼容（新增 `runtime/src/glibc_compat.cpp`）**：在新发行版（如 Ubuntu 26.04 / glibc 2.43）上链接会把 `fmod`/`fmodf`/`acosf`/`sqrtf`/`__isoc23_strto*` 绑定到 `GLIBC_2.38/2.43` 的新符号版本，导致旧发行版报 `version 'GLIBC_2.38' not found` 而**无法加载**。新增垫片在本 DSO 内就地定义这些新名字（内部经 `.symver` 转调 `@GLIBC_2.2.5` 旧实现；`arc4random` 家族用 `getrandom(2)`/`/dev/urandom` 自行实现），使 `libquark_rt.so` / `runtime` 的符号需求上限从 `GLIBC_2.43` 降到 `GLIBC_2.34`；同时以 `-static-libstdc++` 消除 `GLIBCXX_3.4.3x` 依赖（libgcc 保持动态，避免静态展开器引入 `_dl_find_object`）。

### Fixed

- **LLVM ORC JIT 符号解析失败**：`qk_surrogate` / `qk_polymer_*` / `qk_qms_*` 等原语此前以非 inline 定义散落在被多处 include 的 `JIT.hpp` 中，导致 JIT 报 `Symbols not found`；改为单点定义后修复。
## [0.9.0] (vsx 0.3.0)

### Added

- **Android 平台支持**：新增 `qk compile android`（等价 `arm64-android`）AOT 编译目标——`Compiler.hpp` 增加 `aarch64-linux-android` target triple，链接阶段优先用 NDK 交叉编译器（`aarch64-linux-android21/24/26-clang++`，经 `QUARK_ANDROID_CLANGXX` 环境变量或 PATH 定位）；新增 `qk build apk <file.qk> [--release]` 命令（`cli.ts` 定位 `scripts/build-apk.sh` 并 `spawnSync` 一键构建）。
- **轻量 Android 运行时**：新增 `runtime/android/`——`runtime_android.cpp`（QVM 核心 + JNI 桥 `com.quark.QuarkRuntime`，无 LLVM JIT，Qubit 层 / QObject 层 / 对象创建 / JNI 自检 `nativeBellMeasure`）、`CMakeLists.txt`（aarch64 交叉编译）、`apk/`（Gradle 工程）；`.qk` 在桌面端 `qk compile android` 预编译为 `libquark_main.so`（aarch64-linux-android），与轻量运行时 `libquark_rt.so` 一并打入 APK，由 Java JNI 壳加载调用 `quark_main`；`scripts/build-apk.sh` 一键编排「交叉编译运行时 → AOT 编译 → 收集 .so → Gradle 打包」。
- **Android bionic 适配**：`Ga.hpp` 的线程亲和性设置跳过 Android（bionic 无 `pthread_setaffinity_np`，glibc 特有）。
- **SandboxJIT TQNF 符号无条件绑定**：`qk_qgate_*` / `qk_qexpect_z` / `qk_qmeasure` / `qk_qobj_num_qubits` / `qk_qattention` / `qk_qstate_*` / `qk_dla_dim` / `qk_shannon*` / `qk_encode_*` 无条件绑定，使 `.mmi` 的 export 函数可在 MMI 沙箱内执行量子推理（与 lattice / cgfx 同等对待）。

### Fixed

- **QVM 后端 qubit 回收深层 bug**：修复 qubit id 分配 / 复用与 `num_qubits` 收缩的深层缺陷——全局分配器 `next_available_qubit` 由「纯单调计数 + `qk_release_object` 盲目 `fetch_sub`」改为「单调高水位 + 空闲 id 复用栈」（`quark_alloc_qubit_id` / `quark_free_qubit_id`，互斥保护 + 去重）；`release_qubit` 在回收前复位到 |0⟩（测量坍缩 + 条件翻转）、置 `is_qubit_allocated` 后剥离尾部已释放 qubit 收缩 `num_qubits`（Dense `resize(2^n)` / MPS `drop_qubits` / Polyhedral 逐层剥离 `root->left`）；`IQuantumBackend` 新增 `allocate_qubit(id)` 接口；`qk_release_object` 消除对 `QOBJ_DATA_SHARED` 对象的双重 release（先销毁 `shared_ptr` 由其析构统一 release，再回收 id）。
- **daemon 多连接与帧解析修复**：`runtime/src/main.cpp` 的 socket 守护进程从单连接改为 `select` 多连接调度，帧头 / payload 分段读取（处理 TCP 粘包 / 半包），新增单帧 64MB 防御上限。
- **`QUARK_NO_GPU` 环境变量**：`QUARK_NO_GPU=1/true/yes` 强制禁用 GPU 探测（诊断 / 无 GPU 环境 / 规避驱动问题），`0/false/no/off` 或未设置时正常探测。
- **IR 全局变量对齐修复**：`server/src/ir.ts` 全局变量的 `align` 由硬编码 `4` 改为 `typeAlign(llvmType)`，修复非 4 字节对齐类型（如 `double` / `uint64`）的 ABI 对齐错误。
- **拓扑收集修复**：`server/src/topology.ts` 对含 `export` 函数的 MMI 模块跳过拓扑收集与 coord 占用检查，避免组件函数之间 coord 相同的「假冲突」（如 `perceive` 与 `chaos_drift` 均 coord=0）。

## [0.8.0] (vsx 0.2.2)

### Added

- **量子语言迁移框架（`qk migrate`）**：新增 `server/src/migrate/` 目录——统一电路中间表示 `circuit-ir.ts`、门归一/分解 `gates.ts`（qelib1 标准门库 → qk 原生门）、`.qk` 发射器 `emitter.ts`，以及五个源语言前端：`qasm2.ts`（OpenQASM 2.0）、`qasm3.ts`（OpenQASM 3.0，含 `qubit[N]`/`for` 循环展开/自定义 gate）、`qsharp.ts`（Q#，含 `use`/`using`/`M`/`Reset`）、`quil.ts`（Rigetti Quil）、`silq.ts`（ETH Silq）；CLI 新增 `qk migrate <file> --from <lang> [-o out.qk]` 命令（支持按内容自动探测源语言）。迁移产物为可读、可编辑、可编译的 `.qk` 源码，且通过现有编译管线端到端校验。
- **Qubit 层原生门补充**：新增 `y` / `z` / `s` / `t` / `rx` / `ry` 六个原生门（对齐 OpenQASM `qelib1.inc`），贯穿 lexer/semantic/ir/gate-synth/mir/hover-docs 与 C++ 运行时（`IQuantumBackend` 默认实现 + `JIT`/`SandboxJIT`/`MirModuleBuilder` 的 QIR 内建导出）；`y`/`z` 自逆、`rx`/`ry`/`rz` 取负角、`s`/`t` 展开为 `rz` 取负角，纳入可逆编织（`@[undo]`/`@[steer]`）取逆规则。
- **迁移手册**：`docs/qk-migration-manual.md`（门映射表、`qk migrate` 用法、各语言迁移示例、限制与降级说明）。
- **`reset` 测后条件翻转语义**：含「中间 reset」（测后复用 qubit）的电路自动切换到 QObject 层——`QuantumRegister` + `qgate_h/x/rz/cnot` + `qmeasure`（部分坍缩）+ 条件翻转（`int32 _r = qmeasure(q, i); if (_r == 1) { qgate_x(q, i); }`），与 Born 规则坍缩语义一致；新增 `gates.ts` 的 `lowerToBasic`（完整门集 → h/x/rz/cnot 四门分解，覆盖 y/z/s/t/rx/ry/swap/cz/cy/crz）。
- **经典控制流符号化**：OpenQASM 3 经典变量（`int[32]`→`int32`、`bool`→`int32`、`float[64]`→`double`）、经典赋值、`while` 循环、复杂布尔 `if` 条件（`&&`/`||`/`!`/比较/else）符号化转译为 qk 对应结构（`CircuitIR` 扩展 `ClassicalVar` / `while` / `classicalAssign` / 复杂条件 `IfOp`）。
- **VS Code 右键菜单迁移**：`package.json` 注册 `quark.migrateScript` 命令 + `editor/context`/`explorer/context` 右键菜单（`.qasm`/`.qs`/`.quil`/`.slq`）；`extension.ts` 命令转发、`server.ts` 新增 `quark/migrateCode` 通知（读文件 → 自动探测 → 迁移 → 写同名 `.qk`，结果回显 Quark Console）。
- **VS Code 侧边栏（仿 Flutter DevTools）**：新增 `client/src/quarkSidebar.ts` 与 Activity Bar 容器 `quark-sidebar`，四个视图——**编译目标**（TreeView，x32/x64/arm64 切换，workspaceState 持久化 + 编译透传）、**操作**（TreeView，运行/编译/构建/迁移快捷按钮）、**性能监测**（WebviewView，编译/执行耗时历史折线图，`globalState` 跨会话持久化 + `view/title` 清空按钮）、**量子对象与比特**（WebviewView，daemon `GET_SNAPSHOT` 实时快照：多 qubit **约化密度矩阵 Bloch 球** 3D 鼠标旋转 + 态矢量概率柱状图 + 量子对象 + 测量历史）。
- **执行改走 daemon 模式**：`server.ts` 执行由前台 `spawn` 改为连接 `localhost:50052` 发 `COMPILE`/`EXECUTE`/`AOT_COMPILE` 帧（新增 `pingDaemon`/`ensureDaemon`/`daemonRequest`，未运行则自动 `spawn runtime --daemon`）；用户代码量子操作作用在 daemon 共享 QVM，侧边栏与执行共享快照，并回传 `quark/performance` 性能通知。

## [0.7.0] (vsx 0.2.1)

### Added

- **QRC 量子储备池**：`qrc_new(qubits, layers)` / `qrc_train(res, epochs, lr)` / `qrc_probe(res, data)` / `qrc_predict(res, data)` / `qrc_release(res)` 五个语言层内置函数 + `QReservoir` 类型，对应 C ABI `qml/QrcAbi.hpp`；合成正弦时序训练线性读出，验证「无贫瘠高原」的量子储备计算（`qrc_probe` 测态编码输入 → 返回 ⟨Z⟩ 特征、`qrc_predict` 返回读出预测）。
- **TQNF 拓扑量子神经场（语言层）**：QObject 层量子门 `qgate_h` / `qgate_x` / `qgate_rz` / `qgate_cnot`（直接作用于 QObject 内部 qubit，借用不消费）、跨对象受控门 `qgate_cnot_pair(a, ia, b, ib)`（供 POVM 弱测量）、非破坏期望读取 `qexpect_z`、部分坍缩测量 `qmeasure(qobj, index)`、qubit 数查询 `qobj_num_qubits`；量子态量度 `qstate_entropy`（von Neumann 熵）/ `qstate_fidelity`（保真度）、SWAP test 量子注意力 `qattention`（态重叠度 |⟨ψ_q|ψ_k⟩|²）、测量熵 `shannon4` / `shannon8`、可训练性诊断 `dla_dim`（动力学李代数维数）。
- **POVM 正定算子值测量**：`qgate_cnot_pair` 跨对象受控门（主 qubit 控制辅助 qubit）实现弱测量，主态不被完全坍缩。
- **多 qubit 变分 ansatz**：`qobj_num_qubits` 查询 QObject 的 qubit 数，供 ansatz 判定态维度对齐（感知态维度）。
- **真坍缩语义**：`qmeasure(qobj, i)` / `QObject.measure()` 实现**部分坍缩**（测第 i 个 qubit，其余 qubit 仍存活），与 C++ 侧 `qk_qmeasure` 对齐；`QOBJ_MEASURE_FNS` 用 Ref 借用（不消费整个 QObject），修复同一 QObject 测多个 qubit / 测后 move 返回被误判 E-Q001。
- **量子线性类型（QLT）补全 + 隐式 Drop**：`QuantumRegister` / `DiracState` / `BellState` 纳入 `LINEAR_TYPES`（此前遗漏了，重复 move 现在报 E-Q001）；具体量子类型在函数末尾**隐式 Drop**（C++ 侧析构自动 measure+release_qubit，IR 层 `emitScopeCleanup` 生成 `qk_release_object`），不再报 E-Q002 泄漏，仅 `Qubit` / `QObject` 裸类型强制显式消费。
- **可选 GPU（CUDA dlopen 延迟加载）**：运行时不再硬链 `libcuda.so.1` / `libcudart.so.*`，启动时 `dlopen`/`LoadLibrary` 探测 NVIDIA 驱动（`cuInit` + `cuDeviceGetCount`），有 GPU 走 Kokkos CUDA 后端、无 GPU 回退 CPU（OpenMP/Serial）；`Ga.hpp` 按 `quark::gpu_backend_available()` 运行时派发，Kokkos 以 `--allow-shlib-undefined` + 去掉 cuda_driver/cudart 硬链重编，lazy Kokkos（`libkokkoscore.so` / `libkokkoscontainers.so`）随 VSIX / 发行包分发。
- **`QObject.measure()` 消费语义修复**：`MemberExpression` 的 `measure()` 方法调用显式 `Consume` object，修复 QObject 裸类型 `.measure()` 被误判未消费（E-Q002）。

### Changed

- `.vscodeignore` 移除 `vendor/**`：VSIX 打包不再过滤 `vendor/`（GLFW / Nuklear / pinyin / stb 第三方库随包分发）；`.gitignore` 追加 `!vendor/**/*.{dll,lib,a}` 例外，避免预编译库被通配符忽略。
- 量子线性类型检查：具体量子类型（`QuantumRegister`/`DiracState`/`BellState`）函数末尾由「报 E-Q002 泄漏」改为「隐式 Drop」，`Qubit`/`QObject` 裸类型保持严格 no-cloning 约束。

## [0.6.6] (vsx 0.2.0)

### Added

- **一行多变量定义**：`int32 a = 1, b = 2, c = 3;` 单行声明多个同类型变量（新增 `VariableDeclarationList` AST 节点）；顶层显式类型多定义降为多个全局变量（`@a`/`@b`/`@c`）、`let`/`auto` 多定义作为脚本模式局部变量；语义 / IR / MIR / VCGen / 拓扑 / 文档大纲 / 定义跳转全链路支持，后声明的变量可引用先声明的变量（`int32 a = 1, b = a + 1;`）。
- **悬停提示详细文档（中英双语）**：新增 `server/src/hover-docs.ts`，为全部关键字、类型、内置函数、注解标签（`@layer` / `@[gate]` / `@[coherence]` 等）编写「作用 / 语法 / 参数 / 返回值 / 示例」说明；根据开发者系统语言（LSP Initialize 的 `locale`）自动切换中文 / 英文，类似 C++ 悬停 `std::cout` 的详细信息。

### Changed

- 悬停提示从泛化的「关键字 `x` / 标识符 `x`」升级为按「类型 → 内置函数 → 关键字」优先级查询的详细 Markdown 文档；门函数（`h`/`x`/`rz`/`cnot` 等词法上属标识符）与 `void` 等类型名也能正确展示说明。

## [0.6.5] (vsx 0.1.8)

### Added

- **读寄存器内建（x86 架构边界）**：`read_cr0`/`read_cr2`/`read_cr3`/`read_cr4`、`write_cr0`/`write_cr3`、`invlpg`、`rdmsr`、`wrmsr`、`cpuid`、`rdtsc`、`read_rflags`、`xgetbv`——把控制寄存器 / MSR / CPUID 叶读回 qk 变量（`uint64`），补齐此前 `native()` 是 void 副作用、只有输入操作数、读不回寄存器值的缺口。`rdmsr`/`rdtsc`/`xgetbv` 采用 `={eax},={edx}` 双输出再组合为 `uint64`（规避 x86-64 下 `=A` 约束已不表示 edx:eax 对的坑）；`cpuid` 用输出指针形态一次指令写回 4 个寄存器。
- **裸汇编块 `asm { }` + `@[naked]`**：多指令 / 多寄存器汇编序列（`asm { "..." "..." }`，不做 `${}` 占位符替换）；`@[naked]` 函数体只含 asm 块时发射为 `define ... naked { ... unreachable }` 无栈帧，覆盖中断存根「保存全部通用寄存器 + iretq」、调度器切栈、gdt 远返回改 CS 这类单条 side-effect 汇编表达不了的操作。
- **函数指针与间接调用**：`fn<ret(params)>` 类型（等价 `(params)->ret`，映射 `ret (params)*`），`&fn` 返回真函数指针类型、`cb(args)` 间接调用；支撑 blkdev 读写回调表 / irq 中断回调 / 线程入口 / QPU 后端虚表，取代「设备枚举 + route 静态分派」。`&fn` 仍可降为 `cap<uint8>`（bitcast）供 IDT / 中断表直接存函数地址。
- **`@[packed]` 精确字节布局**：无 vtable 指针、无填充、packed struct `<{ ... }>`、字段从偏移 0 起，精确映射 GPT 头 / 分区表项 / FAT32 BPB / ATA IDENTIFY 等磁盘硬件结构，取代「cap 指针 + 手动字节偏移」。
- **volatile 内存访问原语**：`volatile_load` / `volatile_store` → `load volatile` / `store volatile`，MMIO 轮询在 `-O2` 下不再被优化成死循环（此前只能借用语义不完全匹配的 `sync_load` 原子读）。
- **定长数组**：`arr<T, N>` 类型 + `[...]` 字面量 + `a[i]` 索引（`[N x T]` + GEP + load），全局常量表 `@X = constant [N x T]`；静态查找表（键盘扫描码表 / 异常名表）不再需要 route 几十条 path 模拟。
- **复数类型**：`complex64`（`{ float, float }`）/ `complex128`（`{ double, double }`）+ `+`/`-`/`*` 复数算术（`extractvalue` + 分量运算 + `insertvalue`）+ `complex`/`real`/`imag`/`cabs`/`conj` 内建，支撑量子态矢量运算。
- **位域**：`T field : N` 语法，连续同类位域打包进同一存储单元（LSB 优先、超宽自动开新单元），读 = `lshr` + `and` 掩码、写 = 读-改-写（load + 清位 + 移位 or + store），配合磁盘结构位标志。
- **完整 uint64 运算**：无符号整数走 `udiv`/`urem`/`ult`/`ugt`/`ule`/`uge`/`lshr`（符号性随 `LLVMValue.signed` 经符号表传播），整数提升按符号性用 `sext`/`zext`；64 位字面量保留原始文本（`> 2^53` 不丢精度），承载 48 位 LBA 与 GPT 64 位字段。
- **IR 校验器增强**：`irverify.ts` 先剥离双引号字符串内容再扫描 SSA 寄存器，避免内联汇编模板里的 `%cr3`/`%rsp` 被误判为未定义的 LLVM SSA 寄存器。

### Fixed

- 修复 `null` 被 `cap<T1> → cap<T2>` 指针重解释分支误 bitcast 的回归（`cap<int32> p = null` 恢复为 `store i32* null`）。

## [0.6.0] (vsx 0.1.6)

### Added

- **多维标签函数 `@layer`**：以注解式标签 `@layer(time, thread, coord[, cost, deadline])` 取代单一 `quark_main` 入口，把执行过程映射到「时间 × 线程 × 运行层坐标」的多维拓扑空间。编译期 `TopologyBuilder` 自动推导平行/叠加关系与调用传播延迟（子函数 = 父时钟 + Δt），运行时 `TopoScheduler` 按拓扑分层调度（同层并行、层间顺序）。
- **可逆编织门合成范式（Reversible Weaving）**：标签体系`@[gate]`（可组合门单元）、`@[undo]`（可逆对偶 U†：门序反转 + 逐门取逆、`@[steer]`（相干控制 Λ(U)：控制位导引目标门）、`@[unitary]`（酉性验证）、`@[measure]`（测量点标记）；`gate-synth.ts` 在 AST 层自动合成 `<name>_undo`/`<name>_steer`。
- **受控门运行时实现**：`cx`/`ch`/`crz`/`cswap`/`c_toffoli`/`cqft`/`cbraid` 受控门 QIR 内建 + `IQuantumBackend` 基础门分解（CRz/CH/Fredkin/C³X/受控 QFT/受控 braid，到全局相位）；`iqft` 逆 QFT 内建（`qft† = iqft`）。
- **量子物理特性标签**：`@[coherence(t1,t2)]`（相干时间）、`@[noise("model")]`（噪声模型）、`@[basis(X|Y|Z)]`（测量基）、`@[decoherence_free]`（无退相干子空间）、`@[error_correction("code")]`（纠错码）。
- **噪声注入通道**：`@[noise]`/`@[coherence]` 门后自动注入噪声，`IQuantumBackend::apply_noise` 分发到 QVM（dense_state Kraus 通道）与超导/离子阱/中性原子/光子各硬件后端（`IdealStateCore::apply_noise_channel` 统一分发）。
- **经典编译属性**：`@[inline]`/`@[noinline]`/`@[pure]`/`@[readonly]`/`@[cold]`/`@[hot]`/`@[noreturn]`/`@[export]`，映射到 LLVM 函数属性（`alwaysinline`/`readnone`/`cold`/`dllexport` 等）。
- **IR 下沉（MIR → LLVM C++ API）**：`MirModuleBuilder` 以 LLVM C++ API 从序列化 MIR 构建 Module，经 `verifyModule` 校验；内建符号表覆盖全部 `ir.ts` declare（80+ 符号）；`mir_module_test` 固化为 CMake target。下沉路径补全 `NewObject`（对象构造 → `qk_create_*`）、`Drop`/`Consume`（量子资源释放）、`@layer` 拓扑入口（`emitTopologyEntry` 生成调度表 + `qk_topology_entry`）、`Member` form 字段访问（MIR 携带 `forms` 定义 + `MirModuleBuilder` 结构类型 + 精确 `getelementptr`）；`cli.ts` 新增 `--mir` 开关走 `COMPILE_MIR` 下沉路径。
- **`spawn` 真实并发**：`spawn` 块编译为独立线程函数 `@qk_thread_N`，经 `qk_spawn` 内建以 `std::thread` 启动（detach），取代此前的串行内联降级；支持**闭包捕获**（`collectFreeVariables` + env 结构传递外层局部变量）；`mir.ts` 补上 `SpawnStatement` lowering 消除借用检查静默跳过。
- **lambda lowering**：`mir.ts` 补 `FunctionExpression`（lambda）lowering，lambda body 的量子操作纳入借用检查（消除「MIR lowering skipped」静默降级）；`irverify.ts` 识别 `%env`/`%closure.*` 闭包类型名与参数。
- **非破坏 `expectation_z`**：`IdealStateCore::expectation_z`（⟨Z⟩ = 1 - 2·P(1)，不坍缩态），超导/离子阱/中性原子三后端重写。
- **光子去极化**：`PhotonicBackend` 的 depolarizing 从「损耗+相位翻转」近似改为正确的 Pauli 通道（X/Y/Z 以 3p/4 概率）。
- **新示例**：`examples/reversible_weaving.qk`（可逆编织范式端到端 demo：`@[gate]`+`@[undo]`+`@[steer]`+`@[noise]`）。
- **VS Code 扩展打包（vsx 0.1.6）**：esbuild bundle client/server 单文件（vsix 从 487 文件 795 KB 降到 22 文件 212 KB）；runtime 产物（`runtime.exe` + `quark_rt.dll` + `libomp.dll` + `zlib.dll`）打包进 `bin/`，`resolveRuntime()` 优先探测扩展自带 runtime，**安装即运行/编译/构建 qk**（无需单独安装 runtime）。
- **运行/编译/构建命令**：`quark.runScript`（运行）、`quark.compileScript`（AOT 编译为原生二进制）、`quark.buildScript`（生成 LLVM IR 到 `.ll`），注册到编辑器标题栏 + 快捷键（`Ctrl+Alt+N/C/B`）。
- **语法高亮与语义感知补全**：补全注解标签（`@layer`/`@[gate]`/`@[undo]`/`@[steer]`/`@[coherence]` 等）与受控门（`cx`/`ch`/`crz`/`cswap`/`c_toffoli`/`cqft`/`cbraid`/`iqft`）的 TextMate 高亮 + LSP 补全。

### Fixed

- 修复 `parseAttributes` 把连续 `@` 全当 `@[...]`，导致 `@[gate] @layer(...)` 混排崩溃。
- 修复 `irverify.ts` 函数参数（`%arg0`）未计入 `definedRegs`，导致带参函数误报 SSA violation。
- 修复 `rz` 签名检查（原误判为 1 参数，实际为 qubit + angle 2 参数）。
- 修复受控门不在 `GATE_FNS` 导致 MIR 层误判「消费」参数、`@[gate]` 函数误报 E-TOP001、顺序调用被 Q-Digest 误判为跨线程竞争。
- 修复 `section`/`naked` 与历史 `place`/`raw` 命名分裂（`@[section]` 现在正确生成 LLVM `section` 属性）。
- 修复 `ir.ts` 的 `declare i8* @malloc` 与 LLVM ORC JIT 内建 `malloc` 冲突（`invalid redefinition`），改用 `qk_gc_alloc`。
- 修复 `build.bat`：C/C++ 编译器统一 clang-cl（消除 MSVC 混合报错）、CRT 对齐 `/MD`（`LLVM_DIR` 指向 `/MD` 版 LLVM）、补 CUDA/zlib/zstd 路径与 `CMAKE_C_COMPILER`。
- 修复 `prepare-vsix-runtime.ps1` 的 `Join-Path` 三参数错误与中文注释编码问题（改纯 ASCII）。

### Changed

- 入口函数：`quark_main` 由 `@layer` 多维标签函数取代（无标签程序仍回退脚本模式）。

## [0.5.0] (vsx 0.1.1)

### Added

- **完整语法高亮**：重写 `quark.tmLanguage.json`，覆盖全部 100+ 个关键字、量子类型（`Qubit`/`QObject`/`QModel` 等）、内置函数（`qchain_*`/`qk_*`/`sync_*`/`cgui_*`/`cgfx_*`/`qrc_*`）、数字（十进制/浮点/十六进制）与单双引号字符串。
- **语义能力（Language Server）**：新增语义高亮（semanticTokens）、悬停提示（hover）、文档大纲（documentSymbol）、定义跳转（definition），补全从写死的 7 项升级为全量关键字 + 类型 + 内置函数。
- **扩展图标**：QK 语言图标（亮紫/紫双主题）、文件图标主题（file icon theme，左侧工作区 `.qk` 文件图标）、应用图标（runtime / quarkRSP，含多尺寸 `.ico` 与 512 PNG）。

### Fixed

- 修复语法高亮注释规则：由 SQL 风格 `--` 修正为 lexer 实际使用的 C 风格 `//`。
- 修复语言图标深/浅主题无区分的问题。

### Changed

- VS Code 扩展打包配置：补充 `publisher`/`icon`/`repository` 元数据与 `.vscodeignore` 精确控制打包内容，移除误装的 `sharp`/`png-to-ico` 依赖。

## [0.4.0] (vsx 0.1.0)

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
