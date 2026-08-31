# qk 量子学习手册

> 本手册覆盖 Quark 的量子机器学习栈：**QLM**（量子语言模型）、**QML**（量子机器学习原语）、**Numqk**（数值张量库）、**QbNS**（量子脑网络 / 脑机接口）与 **VedaROS QLM** 集成。
> 相关代码位于 `runtime/include/qlm/`、`runtime/include/qml/`、`runtime/include/numqk/`、`runtime/include/qbNs/` 与 `runtime/include/vedaRos/quantum/`。
> 语言层面的内置函数语法见 [qk 语言手册](./qk-language-manual.md)。

---

## 目录

1. [总览](#1-总览)
2. [Numqk 张量库](#2-numqk-张量库)
3. [QML 量子机器学习原语](#3-qml-量子机器学习原语)
4. [QLM 量子语言模型](#4-qlm-量子语言模型)
5. [QbNS 脑机接口与量子脑网络](#5-qbns-脑机接口与量子脑网络)
6. [VedaROS QLM 集成](#6-vedaros-qlm-集成)
7. [qk 语言层的量子学习](#7-qk-语言层的量子学习)
8. [推理 API（qk serve）](#8-推理-apinqk-serve)
9. [完整示例](#9-完整示例)

---

## 1. 总览

```
┌────────────────────────────────────────────────────────────┐
│  qk 语言层（encode_text / qlm_invoke / mind_read / ...）      │
├────────────────────────────────────────────────────────────┤
│  QLM（变分量子电路训练）      QML（Layer / QKMFormat / 推理） │
│  Numqk（Tensor / Autograd）  QbNS（Transducer / Rmx / qbw） │
├────────────────────────────────────────────────────────────┤
│  qhal（QM 真实量子机 / QVM 本地模拟器）                       │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Numqk 张量库

位置：`runtime/include/numqk/Numqk.hpp`（另有 `SoftLogic.hpp`）。

### 2.1 Tensor

```cpp
numqk::Tensor<double> t({2, 3}, /*requires_grad=*/true);
t.data()[0] = 1.0;                 // 行优先数据访问
size_t n = t.size();               // 元素总数
auto shape = t.get_shape();        // {2, 3}
```

### 2.2 自动微分（Autograd）

```cpp
numqk::Tensor<double> a({2, 2}, true);
numqk::Tensor<double> b({2, 2}, true);
numqk::Tensor<double> c = a.matmul(b);   // 矩阵乘，记录反向节点
numqk::Tensor<double> s = c.sigmoid();   // 逐元素 sigmoid
s.backward();                            // 反向传播
auto grad_a = a.get_grad();
```

内置反向节点：`MatmulBackward`、`SigmoidBackward`，以及 qml 层的 `ParameterShiftBackward`。

---

## 3. QML 量子机器学习原语

位置：`runtime/include/qml/`。

### 3.1 QuantumLayer（标量输出）

`QuantumLayer` 把变分量子电路的输出包装成可微分张量，反向用 **parameter-shift 规则**：

```cpp
qml::QuantumLayer<double> layer(backend, circuit_fn);
numqk::Tensor<double> out = layer.forward(input_data, params);  // shape {1}
out.backward();
```

参数移位规则：

```
∂f/∂θ_i = 0.5 · [ f(θ_i + π/2) - f(θ_i - π/2) ]
```

### 3.2 VectorQuantumLayer（向量输出）

`VectorQuantumLayer` 输出 D 维连续期望向量（如 8 个 qubit 的 ⟨Z⟩），反向为向量化 parameter-shift（内积回传）：

```
∂f_j/∂θ_i = 0.5 · [ f_j(θ_i + π/2) - f_j(θ_i - π/2) ]
∂L/∂θ_i   = 0.5 · ⟨ Δf(θ_i), g_out ⟩
```

```cpp
qml::VectorQuantumLayer<double> layer(backend, circuit_fn, /*dim=*/8);
numqk::Tensor<double> out = layer.forward(input_data, params);  // shape {8}
```

### 3.3 QKM 模型格式（`.qkm`）

`QKMFormat.hpp` 定义 `.qkm` 二进制格式（魔数 `QKM1`，版本 2）：

| 字段 | 说明 |
| --- | --- |
| header | 魔数 / 版本 / 元素数 / 形状维数 / 元数据数 |
| shape | 各维度大小 |
| metadata | 键值对（架构 / 拓扑 / 隐私 / 度量等） |
| payload | 原始张量数据 |

```cpp
qml::QKMModel<double> model(theta, meta);
qml::ModelExporter<double>::save("model.qkm", model);
auto loaded = qml::ModelExporter<double>::load("model.qkm");
```

### 3.4 推理（QQNT）

`Inference.hpp` 实现量子原生分词器（QQNT）与 ABI 入口：

- `qk_qlm_load(path)`：反序列化 `.qkm`
- `qk_encode_string(prompt)`：文本 → 16 qubit 量子对象
- `qk_qlm_forward(model, input)`：16-qubit 量子注意力生成
- `qk_decode_string(output)`：量子态 → 文本

分词器内置 128 个 ASCII token + 混沌/量子/时空等语义子词（`subwords`）。

---

## 4. QLM 量子语言模型

位置：`runtime/include/qlm/QLM.hpp`（另有 `MeanFlow.hpp` / `IFP.hpp`）。

`qlm::QLM` 实现变分量子电路训练：

### 4.1 电路 ansatz

```
每层：Rz(params)·N_t（全 qubit）→ CNOT(i, i+8) + Rz（dropout）
N_t = exp(-0.1·t)（lapse 衰减函数）
```

### 4.2 自然梯度（QNG）

使用对角 **Fubini-Study 度量**（`fs_metric_diagonal`）：

```
g_ii = 0.25 · N_t²        （单 qubit RZ 门无纠缠段为 1/4）
natural_grad_i = grad_i / g_ii
θ_i -= lr · natural_grad_i
```

### 4.3 差分隐私（QDP）

`apply_qdp_noise` 在训练后对参数施加亚高斯噪声扰动（ITA 隐私扰动）。

### 4.4 流匹配损失（新公式）

`flow_match_loss` / `train_flow` 实现态空间流匹配：

```
L_fm = (1/8) Σ_j (x̂_1[j] - x_1[j])² ,  x_1 = 2·target - 1 ∈ {±1}
```

用 `VectorQuantumLayer` 输出 8 维 ⟨Z⟩，梯度经向量化 parameter-shift 内积回传，绕过 `Tensor::backward()` 的 `grad=1` 硬编码。

### 4.5 训练与导出

```cpp
qlm::QLM qlm(backend, qubits, layers);
auto model = qlm.train_and_export(epochs, lr, "model.qkm", dataset);
```

---

## 5. QbNS 脑机接口与量子脑网络

位置：`runtime/include/qbNs/`。

### 5.1 神经信号类型

| 类型 | 说明 |
| --- | --- |
| `NeuralStream` | 多通道连续信号（ECoG/EEG），张量 `[通道, 时间步]` |
| `SpikeTrain` | 离散尖峰序列（侵入式单神经元动作电位） |
| `LocalFieldPotential` | 局部场电位（低频连续） |
| `EEGSpectrum` | EEG 频段功率谱（δ/θ/α/β/γ） |
| `QuantumSensorReading` | 量子传感器读数（NV 中心 / SQUID / 原子钟） |

### 5.2 Transducer 编码

| 编码方法 | 信号 → 量子编码 |
| --- | --- |
| `amplitude_encode` | 各通道均值 → Rz 旋转角 |
| `spike_to_basis` | 尖峰存在 → 计算基态 `\|0⟩/\|1⟩`（X 门） |
| `lfp_to_phase` | LFP → 相位（H + Rz） |
| `eeg_to_entangled` | 5 频段功率 → Rz + H + CNOT 链纠缠态 |
| `sensor_to_state` | 传感器读数 → 叠加态（H + Rz） |

### 5.3 顶层接口

`qbns::QbNS` 提供统一混合架构（`create_with_qm` / `create_with_qvm`）：

```cpp
auto qbns = qbns::QbNS::create_with_qvm(BMIModality::NonInvasive);
auto encoded = qbns->acquire_and_encode(eeg_signal);
auto feedback = qbns->execute_neural_computation(encoded);
```

`Rmx`（`rmx.hpp`）实现分布式混合网络（脑节点 / QC 节点注册 + 自适应路由 + 实时控制回路）；`qbw`（`qbw.hpp`）实现脑量子波。

---

## 6. VedaROS QLM 集成

位置：`runtime/include/vedaRos/quantum/qlm.hpp`。VedaROS QLM 封装 + `qk_veda_qlm_train` ABI，对应语言层 `veda_qlm_train(state, epochs, lr)`。

---

## 7. qk 语言层的量子学习

### 7.1 文本 → 量子态 → 训练 → 导出

```qk
int32 quark_main() {
    int32 epochs = 10;
    double lr = 0.1;
    auto encoded = encode_text("chaos fluid dynamics");
    auto model = qlm_invoke(encoded, epochs, lr);
    model.export("predictor.qkm");
    return encoded.measure();
}
```

### 7.2 加载与推理

```qk
let model = qlm_load("predictor.qkm");
let input = qk_encode_string("predict the next state");
qlm_forward(model, input);
let result = qk_decode_string(input);
```

### 7.3 脑机训练与神经反馈

```qk
let brain_state = mind_read("eeg");   // 脑电 → 量子态
mind_train(brain_state, 200, 0.01);   // 训练 QLM
mind_feedback(brain_state);           // 神经反馈闭环
```

### 7.4 VedaROS QLM 训练

```qk
let brain = mind_read("eeg");
let model = qlm_invoke(brain, 10, 0.01);
model.export("brain_model.qkm");
veda_qlm_train(brain, 200, 0.01);
```

### 7.5 标量数学 / 神经原语

```qk
let a = mellowmax2(1.0, 3.0, 2.0);
let b = logsumexp2(0.5, 1.5, 1.0);
let c = boltzmann2(0.2, 0.8, 1.0);
let d = tnorm_luk(0.7, 0.6);
let g = surrogate(0.2, 0.0, 1.0);
let q = tanh_quantize(1.3, 0.5, 4);
let v = lif_step(0.0, 1.2, 0.9, 1.0);
let w = polymer_weight(0.1, 0.5, 3.0);
let t = polymer_mix_bound(1024.0, 0.01);
```

---

## 8. 推理 API（qk serve）

```bash
qk serve model.qkm [--port 9080]
```

提供 OpenAI 兼容接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/v1/models` | 模型列表 |
| `POST` | `/v1/chat/completions` | 对话补全（`stream: true` SSE） |
| `POST` | `/v1/embeddings` | 文本嵌入 |

---

## 9. 完整示例

### 9.1 训练 + 推理全流程

```qk
int32 quark_main() {
    int32 epochs = 20;
    double lr = 0.05;

    // 1. 编码自然语言为量子态
    auto data = encode_text("quantum chaos");

    // 2. 训练变分量子电路
    auto model = qlm_invoke(data, epochs, lr);

    // 3. 导出模型
    model.export("chaos.qkm");

    // 4. 加载并推理
    auto m2 = qlm_load("chaos.qkm");
    auto prompt = qk_encode_string("predict chaos");
    qlm_forward(m2, prompt);
    let text = qk_decode_string(prompt);

    return data.measure();
}
```

### 9.2 脑机接口闭环

```qk
let brain = mind_read("eeg");
mind_train(brain, 200, 0.01);
mind_feedback(brain);
```

---

> 相关文档：[README](../README.md) · [qk 语言手册](./qk-language-manual.md) · [量子机器人仿真平台手册](./quarkrsp-manual.md)
