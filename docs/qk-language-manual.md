# qk 语言手册

> Quark（`.qk`）是一门面向「量子计算 + 神经接口 + 量子语言模型 + 量子机器人」的实验性编程语言。
> 本手册是 qk 语言的完整参考，覆盖词法、类型、控制流、函数与契约、量子操作、模块系统、类型定义与静态验证。
> 运行环境与工具链见 [README.md](../README.md)，量子学习见 [qk 量子学习手册](./qk-quantum-learning-manual.md)。

---

## 目录

1. [概述](#1-概述)
2. [快速上手](#2-快速上手)
3. [词法结构](#3-词法结构)
4. [类型系统](#4-类型系统)
5. [变量与赋值](#5-变量与赋值)
6. [运算符](#6-运算符)
7. [控制流](#7-控制流)
8. [函数](#8-函数)
9. [契约与静态验证](#9-契约与静态验证)
10. [量子类型与操作](#10-量子类型与操作)
11. [内置类](#11-内置类)
12. [内置函数](#12-内置函数)
13. [模块系统（`.mmi`）](#13-模块系统mmi)
14. [类型定义（form / trait / impl / template）](#14-类型定义form--trait--impl--template)
15. [编译管线与运行](#15-编译管线与运行)
16. [附录：关键字与错误类型](#16-附录关键字与错误类型)

---

## 1. 概述

qk 的编译管线为：

```
Lexer（词法）→ Parser（语法）→ SemanticAnalyzer（语义）→ IRGenerator（LLVM IR）
    → TCP Daemon（:50052）→ LLVM ORC JIT → 硬件探测 → QM（真实量子机）/ QVM（本地模拟器）
```

- 源文件扩展名：`.qk`
- 入口函数：`quark_main`（无显式函数时，顶层语句会隐式包裹进 `quark_main`）
- 类型系统：静态类型 + `let`/`auto` 局部类型推导
- 量子语义：静态强制「不可克隆定理」「测量后坍缩」等量子约束

---

## 2. 快速上手

```qk
// hello.qk
int32 quark_main() {
    int32 x = 42;
    int32 y = x + 8;
    return y;                     // 返回 50
}
```

```bash
qk run hello.qk        # 运行脚本
qk ir  hello.qk        # 仅输出 LLVM IR
```

任何没有显式函数定义的顶层脚本也可运行（隐式包裹为 `quark_main`）：

```qk
let q = alloc();
h(q);
int32 r = measure(q);
```

---

## 3. 词法结构

### 3.1 注释

仅支持行注释：

```qk
// 这是注释
int32 a = 1;   // 行尾注释
```

### 3.2 标识符

标识符以字母（含 Unicode 字母）或下划线 `_` 开头，后续可含字母、数字、下划线。

```qk
let foo = 1;
let _bar = 2;
let 变量 = 3;    // 支持 Unicode 字母
```

### 3.3 数字

- 整数：`0` `42` `50000`
- 浮点数：`0.1` `3.14` `1.0`

整数字面量在语义层推导为 `int32`，含小数点的推导为 `double`。

### 3.4 字符串与转义

字符串支持单引号 `'...'` 与双引号 `"..."`，并支持常见转义序列：

| 转义 | 含义 |
| --- | --- |
| `\n` | 换行 |
| `\t` | 制表符 |
| `\r` | 回车 |
| `\\` | 反斜杠 |
| `\"` `\'` | 引号 |
| `\0` | 空字符 |

---

## 4. 类型系统

### 4.1 标量类型

| 类型 | LLVM 映射 | 说明 |
| --- | --- | --- |
| `int8` / `uint8` | `i8` | 8 位整数 |
| `int16` / `uint16` | `i16` | 16 位整数 |
| `int` / `int32` / `uint32` | `i32` | 32 位整数（`int` 是 `int32` 别名） |
| `int64` / `uint64` | `i64` | 64 位整数 |
| `float` | `float` | 单精度浮点 |
| `double` | `double` | 双精度浮点 |
| `string` | `i8*` | 字符串 |
| `char` | `i8` | 字符 |

### 4.2 量子类型

| 类型 | LLVM 映射 | 说明 |
| --- | --- | --- |
| `Qubit` | `%Qubit*`（opaque） | 单个量子比特，不可克隆 |
| `QObject` | `%QObject*`（opaque） | 量子对象（可容纳多 qubit 状态） |
| `QModel` | `%QModel*`（opaque） | 量子语言模型 |

### 4.3 类型推导

`let` 与 `auto` 等价，均触发局部类型推导：

```qk
auto q = alloc();          // Qubit
let n = 42;                // int32
let f = 3.14;              // double
let s = "quark";           // string
let m = new BellState();   // QObject
```

---

## 5. 变量与赋值

```qk
// 变量声明（带显式类型）
int32 count = 0;
double lr = 0.01;
Qubit q = alloc();

// 类型推导
auto bell = new BellState();

// 重新赋值（类型必须一致）
count = count + 1;
```

类型不匹配会在语义分析阶段报错：

```qk
int32 a = "hello";   // Type Error: Cannot assign expression of type 'string' ...
```

---

## 6. 运算符

### 6.1 算术

`+` `-` `*` `/`（整数除法为 `sdiv`，浮点为 `fdiv`）

### 6.2 比较

`<` `<=` `>` `>=` `==` `!=`（返回 `bool`/`i1`）

### 6.3 逻辑

`&&`（短路与）、`||`（短路或）、`!`（非）

```qk
if (a > 0 && b < 10) { /* ... */ }
```

### 6.4 一元

`-`（取负）、`!`（逻辑非）

---

## 7. 控制流

### 7.1 if / else

```qk
if (cond) {
    // ...
} else {
    // ...
}
```

### 7.2 while（含不变量与 else）

`while` 支持可选的 `invariant`（循环不变量，用于静态验证）与 `else` 分支：

```qk
int32 i = 0;
while (i < 100) {
    invariant i >= 0;
    i = i + 1;
} else {
    // 循环体一次都未执行时进入
}
```

### 7.3 for

标准三段式 `for`：

```qk
for (int32 i = 0; i < 10; i = i + 1) {
    // ...
}
```

### 7.4 break / continue

```qk
while (true) {
    if (done) break;
    continue;
}
```

> 语义分析器会检查 `break` / `continue` 是否位于循环之外。

---

## 8. 函数

### 8.1 入口函数

每个显式定义函数的程序需要 `quark_main`：

```qk
int32 quark_main() {
    return 0;
}
```

### 8.2 函数声明

```qk
int32 add(int32 a, int32 b) {
    return a + b;
}

void do_nothing() {
    return;
}
```

### 8.3 匿名函数（lambda / 闭包）

`fn` 关键字定义匿名函数，支持闭包捕获与高阶调用：

```qk
let twice = fn(int32 x) -> int32 {
    return x * 2;
};
```

函数类型的返回类型签名形如 `(params)->ret`，可通过变量间接调用。

### 8.4 方法接收者

`form`/`impl` 的方法可通过 `self` 或 `&self` 作为接收者（见 [第 14 节](#14-类型定义form--trait--impl--template)）。

---

## 9. 契约与静态验证

函数与循环支持契约注解，用于静态验证（对应 `qk verify` 命令）：

| 关键字 | 位置 | 含义 |
| --- | --- | --- |
| `requires` | 函数签名后 | 前置条件 |
| `ensures` | 函数签名后 | 后置条件 |
| `invariant` | `while` 循环内 | 循环不变量 |

```qk
int32 square(int32 x)
    requires x >= 0;
    ensures result >= 0;
{
    return x * x;
}
```

- `result` 关键字在 `ensures` 中引用函数返回值。
- 验证器基于最弱前置条件（WP）演算，把契约翻译为证明义务（obligation），可导出 SMT-LIB 交由 Z3 / cvc5 判定：

```bash
qk verify prog.qk                 # 静态验证契约
qk verify prog.qk --smt out.smt2  # 导出 SMT-LIB
```

---

## 10. 量子类型与操作

### 10.1 分配与测量

```qk
Qubit q = alloc();      // 分配一个量子比特
int32 r = measure(q);   // 测量并坍缩，返回 0/1
```

> **不可克隆定理**：`Qubit` 不能被拷贝，`let q2 = q;` 会报 `Quantum Violation: Cannot copy Qubit`。
> **测量后坍缩**：已测量的 qubit 不能再被使用，会报 `Qubit used after measurement`。

### 10.2 量子门

| 门 | 签名 | 说明 |
| --- | --- | --- |
| `x` | `x(Qubit)` | Pauli-X |
| `h` | `h(Qubit)` | Hadamard |
| `rz` | `rz(Qubit, double)` | 绕 Z 轴旋转 |
| `cnot` | `cnot(Qubit, Qubit)` | 受控非（控制, 目标） |
| `toffoli` | `toffoli(Qubit, Qubit, Qubit)` | Toffoli（两控制一目标） |
| `swap` | `swap(Qubit, Qubit)` | 交换 |
| `qft` | `qft(int)` | 量子傅里叶变换（比特数） |
| `braid` | `braid(Qubit, Qubit)` | 编织（Yang-Baxter） |

> 门操作在语句位置被识别为函数调用；在表达式位置（如 `x * x`）则识别为普通标识符。

### 10.3 X / Y 基测量

```qk
int32 mx = measure_x(q);   // X 基测量
int32 my = measure_y(q);   // Y 基测量
```

---

## 11. 内置类

内置量子类通过 `new` 实例化，返回 `QObject`：

| 类 | 构造 | 说明 |
| --- | --- | --- |
| `DiracState` | `new DiracState(n)` | 狄拉克态（n 维） |
| `BellState` | `new BellState()` | Bell 态 |
| `QuantumRegister` | `new QuantumRegister(n)` | n 比特量子寄存器 |

支持成员访问：

```qk
auto bell = new BellState();
int32 m = bell.measure();     // QObject.measure() -> int32
auto reg = new QuantumRegister(15);
```

`QModel` 支持 `.export(path)` 导出 `.qkm` 模型：

```qk
auto model = qlm_invoke(data, 10, 0.01);
model.export("model.qkm");
```

---

## 12. 内置函数

### 12.1 量子核心

| 函数 | 签名 | 返回 |
| --- | --- | --- |
| `alloc` | `alloc()` | `Qubit` |
| `measure` | `measure(Qubit)` | `int32` |
| `measure_x` / `measure_y` | `(Qubit)` | `int32` |

### 12.2 文本 / 图像编码

| 函数 | 签名 | 返回 |
| --- | --- | --- |
| `encode_text` | `encode_text(string)` | `QObject` |
| `encode_image` | `encode_image(string)` | `QObject` |
| `qk_encode_string` | `qk_encode_string(string)` | `QObject` |
| `qk_decode_string` | `qk_decode_string(QObject)` | `string` |

### 12.3 量子语言模型（QLM）

| 函数 | 签名 | 返回 |
| --- | --- | --- |
| `qlm_load` | `qlm_load(string)` | `QModel` |
| `qlm_forward` | `qlm_forward(QModel, QObject)` | `void` |
| `qlm_invoke` | `qlm_invoke(QObject, int, double)` | `QModel` |

### 12.4 脑机接口（QbNS）

| 函数 | 签名 | 返回 |
| --- | --- | --- |
| `mind_read` | `mind_read(string)` | `QObject`（模态：`stream/spike/lfp/eeg/sensor`） |
| `mind_train` | `mind_train(QObject, int, double)` | `void` |
| `mind_feedback` | `mind_feedback(QObject)` | `void` |

### 12.5 VedaROS

| 函数 | 签名 | 返回 |
| --- | --- | --- |
| `veda_qlm_train` | `veda_qlm_train(QObject, int, double)` | `void` |

### 12.6 标量数学 / 神经原语

| 函数 | 签名 | 返回 |
| --- | --- | --- |
| `surrogate` | `(double, double, double)` | `double` |
| `tanh_quantize` | `(double, double, int)` | `double` |
| `lif_step` | `(double, double, double, double)` | `double` |
| `mellowmax2` | `(double, double, double)` | `double` |
| `logsumexp2` | `(double, double, double)` | `double` |
| `boltzmann2` | `(double, double, double)` | `double` |
| `tnorm_luk` / `tnorm_prod` / `tnorm_godel` | `(double, double)` | `double` |
| `polymer_weight` | `(double, double, double)` | `double` |
| `polymer_mix_bound` | `(double, double)` | `double` |

---

## 13. 模块系统（`.mmi`）

### 13.1 声明与导出

```qk
mod math {
    pub int32 add(int32 a, int32 b) {
        return a + b;
    }
    export int32 square(int32 x) {
        return x * x;
    }
}
```

### 13.2 导入与权限

```qk
import math from "./math.mmi";
requires io.network;          // 声明所需权限
let result = math.add(1, 2);
```

### 13.3 关键字

| 关键字 | 说明 |
| --- | --- |
| `mod` | 定义模块 |
| `use` | 路径导入 |
| `pub` | 公开成员 |
| `import` + `from` | 导入 `.mmi` |
| `export` | 导出 |
| `requires` | 权限声明 |

### 13.4 `.mmi` 格式（QKMM）

`.mmi` 文件头（`name` / `version` / `exports` / `permissions` / `imports`）由语言服务器打包，运行时通过 C ABI 的 `quark_runtime_*_mmi` 动态加载与调用。

---

## 14. 类型定义（form / trait / impl / template）

### 14.1 form

`form` 定义数据结构，支持继承（`inherits`，单继承）与 `rank` 秩：

```qk
form Point {
    double x;
    double y;
}
```

### 14.2 trait 与 impl

```qk
trait Shape {
    double area();
}

impl Shape for Circle {
    double area() {
        return 3.14;
    }
}
```

### 14.3 template

```qk
template<T> form Box {
    T value;
}

auto b = new Box<int32>();
```

### 14.4 关键字汇总

| 关键字 | 说明 |
| --- | --- |
| `form` | 定义数据结构（`inherits` / `rank`） |
| `trait` | 定义可共享的行为接口 |
| `impl` | 为类型实现 trait（`impl <trait> for <type>`） |
| `template` | 泛型声明 |
| `rank` | 秩块 |
| `self` | 方法接收者（`self` / `&self`） |

---

## 15. 编译管线与运行

| 命令 | 说明 |
| --- | --- |
| `qk run <file.qk>` | 编译并运行 |
| `qk ir <file.qk>` | 输出 LLVM IR |
| `qk compile <x32\|x64\|arm64> <-e\|-m> <file.qk>` | AOT 编译为原生二进制 |
| `qk verify <file.qk> [--smt [out]]` | 静态验证契约 |
| `qk serve <model.qkm> [--port p]` | 启动推理服务 |

运行依赖 daemon（`./runtime --daemon`，监听 `localhost:50052`）。

---

## 16. 附录：关键字与错误类型

### 16.1 关键字

```text
let auto int new return if else while for break continue fn
int8 int16 int32 int64 uint8 uint16 uint32 uint64
float double string char
Qubit QObject QModel
alloc measure encode_text encode_image qlm_invoke qlm_load
qk_encode_string qlm_forward qk_decode_string
DiracState BellState QuantumRegister
mind_read mind_train mind_feedback veda_qlm_train
mod use pub form impl trait template rank self
export import requires ensures invariant result from
surrogate tanh_quantize lif_step mellowmax2 logsumexp2 boltzmann2
tnorm_luk tnorm_prod tnorm_godel polymer_weight polymer_mix_bound
```

### 16.2 常见错误类型

| 类别 | 示例 |
| --- | --- |
| `Type Error` | 类型不匹配 |
| `Quantum Violation` | 克隆 qubit / 测量后使用 qubit |
| `Reference Error` | 未定义变量 / `break` 在循环外 |
| `Signature Error` | 参数数量不符 |
| `Inheritance Error` | 重复继承 / 父类型不存在 |
| `Impl Error` | 未实现 trait 方法 / trait 不存在 |
| `Contract Error` | `requires` / `ensures` / `invariant` 类型非布尔 |
| `Ambiguity Warning` | 门名与变量名冲突 |

---

> 相关文档：[README](../README.md) · [量子机器人仿真平台手册](./quarkrsp-manual.md) · [qk 量子学习手册](./qk-quantum-learning-manual.md)
