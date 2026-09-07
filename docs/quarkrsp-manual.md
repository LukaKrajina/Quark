# 量子机器人仿真平台手册（quarkRSP）

> `quarkRSP/` 是一个量子机器人仿真平台（C++20），复用运行时能力 `qhal`（QM/QVM 量子后端）、`vedaRos`（量子机器人 OS）与 `numqk`（张量库）。
> 统一入口：`#include "quarkRSP.hpp"`。
> 本手册覆盖各子系统的架构、关键类型、义肢/义眼专项、构建测试与安全合规。

---

## 目录

1. [架构总览](#1-架构总览)
2. [物理内核 qpc](#2-物理内核-qpc)
3. [渲染 render](#3-渲染-render)
4. [蓝图 blueprint](#4-蓝图-blueprint)
5. [量子处理器设计 qpu 与电路 circuit](#5-量子处理器设计-qpu-与电路-circuit)
6. [程序化内容生成 pcg](#6-程序化内容生成-pcg)
7. [控制与量子强化学习 control](#7-控制与量子强化学习-control)
8. [义肢 / 义眼（脑意识 + 量子 RL）](#8-义肢--义眼脑意识--量子-rl)
9. [硬件抽象 hardware](#9-硬件抽象-hardware)
10. [QCDRC 遥操作](#10-qcdrc-遥操作)
11. [桥接 bridge](#11-桥接-bridge)
12. [Qt 桌面仿真界面](#12-qt-桌面仿真界面)
13. [构建与测试](#13-构建与测试)
14. [安全与临床合规](#14-安全与临床合规)

---

## 1. 架构总览

```
quarkRSP/
├── include/
│   ├── core/        世界 / 骨架 / 机器人 / 混沌网格
│   ├── qpc/         物理内核（刚体 / 碰撞 / 约束 / 关节 / 凸包 / BVH 宽相）
│   ├── qpu/         量子处理器设计
│   ├── circuit/     机器人电路设计
│   ├── blueprint/   行为树 + 节点图蓝图
│   ├── pcg/         程序化内容生成
│   ├── render/      3D 渲染（Vulkan PBR + 网格/纹理加载）
│   ├── editor/      qk 编辑器
│   ├── control/     量子 RL + 意识控制 + 义肢/义眼 + 场意识
│   ├── hardware/    执行器 / 生物信号 / 安全 / 故障检测 / HIL
│   ├── bridge/      VedaROS 桥
│   └── qcdrc/       相机 / 动捕 / 遥操作 / 行为克隆
├── src/             入口、Vulkan 上下文、JIT host、RL demo
├── gui/             Qt 6 仿真界面
├── shaders/         PBR 着色器（GLSL）
└── tests/           单元测试
```

---

## 2. 物理内核 qpc

位置：`include/qpc/`。参考 AlphaPHY 的刚体动力学 + 碰撞检测 + 约束求解，量子接口委托给 QM/QVM。

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| 数学 | `math.hpp` | 向量 / 四元数等数学原语 |
| 刚体 | `rigid_body.hpp` | 刚体状态（位置 / 朝向 / 速度 / 阻尼） |
| 碰撞 | `collision.hpp` | 球体 / 胶囊体 / AABB 等形状碰撞 |
| 约束 | `constraint.hpp` | 约束求解 |
| 关节 | `joint.hpp` | 关节类型（Hinge / BallSocket 等） |
| 凸包 | `convex_hull.hpp` | 凸包生成 |
| 物理内核 | `physics_kernel.hpp` | 主物理步进（可选 Kokkos 并行积分） |
| 宽相 | `broadphase.hpp` | BVH 宽相碰撞（O(N²) → O(N log N)） |

> 物理阻尼使用与步长无关的阻尼系数（`linear_damping` / `angular_damping`），不再硬编码 `*0.999`。

---

## 3. 渲染 render

位置：`include/render/`。3D 渲染 + PBR（Cook-Torrance）+ 纹理采样 + OBJ/glTF/glb 加载 + 内置 PNG/JPEG 解码。

| 组件 | 说明 |
| --- | --- |
| `vulkan_context.hpp` / `renderer.hpp` / `pipeline3d.hpp` | Vulkan 渲染上下文与 3D 管线 |
| `scene.hpp` / `mesh.hpp` / `mesh_generator.hpp` / `sky.hpp` | 场景 / 网格 / 天空盒 |
| `obj_loader.hpp` / `gltf_loader.hpp` / `mesh_loader.hpp` | 模型加载 |
| `texture.hpp` / `texture_decoder.hpp` | 纹理与 PNG/JPEG 解码 |
| `mat4.hpp` / `json.hpp` | 数学与 JSON |

---

## 4. 蓝图 blueprint

位置：`include/blueprint/`。行为树 + Material/Substrate 节点图 + Nuklear 可视化编辑器。

| 组件 | 说明 |
| --- | --- |
| `graph.hpp` | 节点图 |
| `blueprint.hpp` | 蓝图定义 |
| `blueprint_editor.hpp` | Nuklear 可视化编辑器 |

---

## 5. 量子处理器设计 qpu 与电路 circuit

| 子系统 | 位置 | 说明 |
| --- | --- | --- |
| QPU/QPL 设计 | `include/qpu/qpu_design.hpp` | 量子处理器与量子编程层设计器 |
| 机器人电路 | `include/circuit/robot_circuit.hpp` | 机器人电路设计与连接 |

---

## 6. 程序化内容生成 pcg

位置：`include/pcg/pcg_framework.hpp`。种子驱动程序化内容生成（PCG）。

---

## 7. 控制与量子强化学习 control

位置：`include/control/`。这是平台最核心的子系统之一。

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| 控制入口 | `control.hpp` | 子系统的统一入口 |
| 量子 RL 智能体 | `rl_agent.hpp` | `QuantumRLAgent`：策略权重 + 量子探索（`act` / `act_quantum` / `store` / `train`） |
| RL 管线 | `rl_pipeline.hpp` | `RLPipeline::train`：端到端训练循环（`IEnvironment` + agent + config） |
| 物理环境 | `physics_environment.hpp` | 物理环境（接入 RL 的 `IEnvironment`） |
| 意识控制 | `consciousness_controller.hpp` | `ConsciousnessController`：脑量子波 bits → 兴奋度 → 增益/阻尼/目标偏移 |
| 场意识控制 | `field_consciousness.hpp` | `FieldConsciousnessController`：神经场序参量 → 意识调制 |
| 脑机桥 | `brain_bridge.hpp` | 脑机接口桥 |
| 脑机桥（QbNS） | `brain_bridge_qbns.hpp` | 桥接 QbNS 量子脑网络 |
| 义肢/义眼 | `prosthetic.hpp` / `prosthetic_driver.hpp` | 见 [第 8 节](#8-义肢--义眼脑意识--量子-rl) |
| 异步管线 | `async_pipeline.hpp` | 异步训练管线 |

### 7.1 量子强化学习

`QuantumRLAgent` 在经典线性策略之上引入量子探索：

- `act(obs)`：经典策略（`obs → action` 线性映射）。
- `act_quantum(obs)`：将观测编码进量子态（`H + Rz(atan(obs_i)·2)`），测量结果作为 ±探索扰动。
- `store(obs, action, reward)` / `train(epochs)`：经验回放 + 监督式策略修正。

```cpp
QuantumRLAgent agent(obs_dim, act_dim, 0.01);
agent.set_backend(kernel.backend());   // 注入量子后端
auto action = agent.act_quantum(obs);
```

### 7.2 意识控制

`ConsciousnessController::compute(brain_bits)` 将脑量子波测量结果（0/1 序列）映射为意识调制因子：

| 调制 | 范围 | 含义 |
| --- | --- | --- |
| `arousal` | [0,1] | 归一化兴奋度 |
| `gain_scale` | [0.7,1.3] | 兴奋度高 → 增益放大 |
| `damping_scale` | [0.7,1.3] | 兴奋度低 → 阻尼提高 |
| `target_offset_x/z` | — | 意识驱动的目标偏移 |

---

## 8. 义肢 / 义眼（脑意识 + 量子 RL）

位置：`include/control/prosthetic.hpp` / `prosthetic_driver.hpp`。
义肢由脑意识提供「意图」目标角，量子 RL 学习补偿动作；义眼由脑意识控制注视方向，量子 RL 学习追踪补偿。

### 8.1 核心组件

| 组件 | 说明 |
| --- | --- |
| `ProstheticLimb` | 义肢运动单元：`set_intent`（脑意识 bits → 目标角）、`step`（量子 RL 补偿）、`feedback` / `train` |
| `BionicEye` | 义眼：`set_intent`（兴奋度 → pan/tilt）、`step`（追踪补偿）、`gaze_direction()`（单位注视向量） |
| `BionicEyeCamera` | 义眼相机：实现 `ICamera`，针孔投影生成随注视方向变化的 RGB 帧 |
| `ProstheticRobotDriver` | 义肢 → Robot 刚体驱动（关节角 → 骨骼朝向） |
| `ProstheticEnvironment` | 义肢 RL 环境（`IEnvironment`） |
| `ProstheticPhysicsEnvironment` | 义肢 + 物理内核的端到端 RL 环境 |
| `make_prosthetic_arm_joints()` | 标准上肢关节工厂（肩/肘/腕/拇指/食指） |

### 8.2 示例：端到端训练

```cpp
#include "control/prosthetic_driver.hpp"
double reward = quarkrsp::control::train_prosthetic_physics(/* episodes= */ 50);
```

### 8.3 关键接口

```cpp
// 义肢
ProstheticLimb limb(make_prosthetic_arm_joints());
limb.set_backend(kernel.backend());
limb.set_intent(brain_bits);   // 脑意识意图
limb.step();                   // 量子 RL 补偿 + 关节推进
limb.feedback(reward);
limb.train(epochs);

// 义眼
BionicEye eye;
eye.set_intent(brain_bits);
eye.step();
qpc::Vec3 gaze = eye.gaze_direction();
```

---

## 9. 硬件抽象 hardware

位置：`include/hardware/`。

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| 执行器 | `actuator.hpp` | 统一电机接口（`IActuator`）+ 增量编码器采样 |
| 生物信号 | `bio_signal.hpp` | EMG/EEG 信号源（仿真 / 外部） |
| 安全控制器 | `safety_controller.hpp` | `SafetyController`：限位 / 急停 |
| 故障检测 | `fault_detection.hpp` | `Watchdog` / `HeartbeatMonitor` / `EncoderConsistencyCheck` / `DualChannelRedundancy` |
| 可观测性 | `observability.hpp` | `Logger` / `MetricsRegistry` / `HealthReporter` |
| HIL 在环 | `hil_harness.hpp` | 硬件在环测试 |

---

## 10. QCDRC 遥操作

位置：`include/qcdrc/`。

| 组件 | 文件 | 说明 |
| --- | --- | --- |
| 相机 | `camera.hpp` | RGB 相机（`ICamera` / `RgbFrame`） |
| 动捕 | `mocap.hpp` | 全身动捕 |
| 设备 | `device.hpp` | 真实设备接入 |
| 遥操作 | `teleop.hpp` / `teleop_driver.hpp` | 遥操作与驱动 |
| 行为克隆 | `cloning.hpp` | 行为克隆 |

---

## 11. 桥接 bridge

位置：`include/bridge/vedaros_bridge.hpp`。将 quarkRSP 与 VedaROS 量子机器人 OS 桥接（详见 [README](../README.md) 的 VedaROS 章节）。

---

## 12. Qt 桌面仿真界面

`quarkRSP_gui` 基于 Qt 6 Widgets + QVulkanWindow。

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 仿真内核 | `gui/src/simulation_host.hpp/.cpp` | `SimulationHost`：物理步进 / 遥操作 / RL / QVM / 意识 |
| 主窗口 | `gui/qt/main_window.cpp` | QTabWidget 面板布局 |
| Vulkan 视口 | `gui/qt/vulkan_viewport.cpp` | QVulkanWindow 真 3D 视口 |
| 面板 | `gui/qt/panels.cpp` | World Outliner / Details 面板 |

---

## 13. 构建与测试

```bash
cd runtime
cmake --build build --target quarkRSP          # 仿真平台主程序
cmake --build build --target quarkRSP_rl_demo  # 量子 RL 端到端 demo
cmake --build build --target quarkRSP_tests    # 单元测试
ctest -R quarkRSP_tests                        # 运行测试
```

> 构建前请先按 [README 构建前必读](../README.md) 配置依赖路径（LLVM / Kokkos / CUDA / Vulkan / Qt 6 等）。

---

## 14. 安全与临床合规

| 文档 | 说明 |
| --- | --- |
| [SAFETY.md](../quarkRSP/SAFETY.md) | ISO 14971 风险分析（H1-H7 危险源）+ FMEA + 安全用例（SC1-SC5） |
| [CLINICAL.md](../quarkRSP/CLINICAL.md) | FDA De Novo/510(k)、CE MDR 临床评估方案（有效性/安全性/可用性终点） |

关键安全组件（`SafetyController` / `Watchdog` / `EncoderConsistencyCheck` / `DualChannelRedundancy` / `HeartbeatMonitor`）见 [第 9 节](#9-硬件抽象-hardware)。

---

> 相关文档：[README](../README.md) · [qk 语言手册](./qk-language-manual.md) · [qk 量子学习手册](./qk-quantum-learning-manual.md)
