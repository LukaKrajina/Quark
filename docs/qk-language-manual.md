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
15. [系统级编程（cap / unsafe / native）](#15-系统级编程cap--unsafe--native)
16. [并发与纠缠（spawn / entangle）](#16-并发与纠缠spawn--entangle)
17. [借用检查与线性类型](#17-借用检查与线性类型)
18. [编译管线与运行](#18-编译管线与运行)
19. [附录：关键字与错误类型](#19-附录关键字与错误类型)

---

## 1. 概述

qk 的编译管线为：

```
Lexer（词法）→ Parser（语法）→ SemanticAnalyzer（语义）→ MIR lowering（中间表示）
    → BorrowChecker（借用检查 + 量子线性类型 QLT）→ Q-Digest（静态竞争检测）
    → IRGenerator（LLVM IR）→ TCP Daemon（:50052）→ LLVM ORC JIT → 硬件探测
    → QM（真实量子机）/ QVM（本地模拟器）
```

- 源文件扩展名：`.qk`
- 入口函数：`quark_main`（无显式函数时，顶层语句会隐式包裹进 `quark_main`）
- 类型系统：静态类型 + `let`/`auto` 局部类型推导
- 量子语义：静态强制「不可克隆定理」「测量后坍缩」等量子约束（量子线性类型 QLT）
- 所有权：借用检查，杜绝借用冲突与悬垂借用
- 系统级：`cap` 能力指针 / `unsafe` / 内联汇编，支持裸机与内核编程

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

### 4.4 能力指针（cap）

`cap<T>` 是 CHERI 式「能力」指针——地址 + 边界 + 权限 + 有效性的统一封装，用于系统级
编程（裸机 / 内核）。它在 LLVM 层降为普通指针 `T*`，语义层受借用检查与 `unsafe` 约束：

```qk
cap<int32> p = null;       // 等价于 int32*，初始为空
*p = 5;                    // 解引用写入
int32 x = *p;              // 解引用读取
```

> 裸指针解引用必须在 `unsafe { ... }` 块内（见 [第 15 节](#15-系统级编程cap--unsafe--native)）。

### 4.5 编译期常量（fixed）

`fixed` 声明编译期常量（`const` 的量子化命名，确定型范式）：

```qk
fixed int32 MAX = 100;
int32 x = MAX;             // 编译期求值
```

### 4.6 空值（null）

`null` 表示空指针 / 空能力，用于初始化 `cap<T>`，或作为 `fuse` 的通配模式（`_`）。

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

### 7.5 route（路由分支）

`route` 是 `switch` 的量子化命名，把判别值路由到若干路径之一；`path` 列出取值分支，
`fallback` 提供兜底分支：

```qk
route (code) {
    path 0: {
        // code == 0
    }
    path 1: {
        // code == 1
    }
    fallback: {
        // 其余情况
    }
}
```

### 7.6 spin（自旋循环）

`spin` 是 `do-while` 的量子化命名，先执行循环体再判断条件，至少执行一次：

```qk
spin {
    // 循环体（至少执行一次）
} while (cond);
```

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

### 8.5 函数属性

函数可携带系统级属性，形如 `@[name]` 或 `@[name("value")]`，作用于其后的函数声明：

```qk
@[section(".text.boot")] @[naked] @[no_gc]
int32 quark_main() {
    return 0;
}
```

常用属性：`section`/`place`（段放置）、`naked`/`raw`（裸函数，无栈帧）、`no_gc`（禁用 GC）。

### 8.6 堆分配构造（make）

`new` 与 `make` 都用于构造对象，区别在于分配位置——`new` 栈分配、`make` 堆分配（经 GC 堆）：

```qk
auto a = new BellState();   // 栈分配
auto b = make BellState();  // 堆分配
```

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

### 10.4 任意基构建

`basis_state` 用布洛赫方向 (θ, φ) 构建任意基下的量子态，与固定基的 `DiracState`、
`BellState` 形成互补：

```qk
auto zplus  = basis_state(0.0, 0.0, 0);              // Z 基 |0⟩
auto zminus = basis_state(0.0, 0.0, 1);              // Z 基 |1⟩
auto xplus  = basis_state(1.5707963, 0.0, 0);        // X 基 |+⟩（θ=π/2）
auto yplus  = basis_state(1.5707963, 1.5707963, 0);  // Y 基 |+i⟩（θ=π/2, φ=π/2）
auto arbitrary = basis_state(0.8, 2.1, 0);           // 任意方向的 + 本征态
```

其中 `|n̂₊⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩`，`|n̂₋⟩` 为其正交的 - 本征态。

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
| `basis_state` | `(double theta, double phi, int32 value)` | `QObject` |

`basis_state` 在**任意基**下构建单比特量子态：`(θ, φ)` 参数化布洛赫球方向 n̂，
返回该基的 + 本征态（`value=0`）或 - 本征态（`value=1`）：
`|n̂₊⟩ = cos(θ/2)|0⟩ + e^{iφ} sin(θ/2)|1⟩`。标准基特例：Z 基 `(0,0)`、X 基
`(π/2,0)`、Y 基 `(π/2,π/2)`。

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

### 12.7 QCOS 系统调用（syscall ABI）

| 函数 | 签名 | 返回 |
| --- | --- | --- |
| `qk_sys_call` | `(int32 no, int32 a, int32 b, int32 c)` | `int32` |
| `qk_sys_calld` | `(int32 no, ...)` | `double` |
| `qk_sys_log` | `(int32 level, string)` | `void` |
| `qk_sys_logi` | `(int32 level, int32)` | `void` |
| `qk_sys_callp` | 指针型入口 | —（待 P1 `ptr<T>` 开放） |

常用系统调用号：`SYS_LOG = 1`、`SYS_YIELD = 2`、`SYS_EXIT = 3`、`SYS_TIME = 10`。

### 12.8 QMS 数值内核（算法 4）

量子 Markov 半群数值服务下沉到裸机内核，提供谱隙 / 混合界 / 方差收缩时间：

| 函数 | 签名 | 返回 |
| --- | --- | --- |
| `qk_qms_gap` | `(int32 model, double p, double q)` | `double`（谱隙） |
| `qk_mix_bound` | `(double gap, double n, double eps)` | `double`（混合界） |
| `qk_qms_conc` | `(double gap, double eps)` | `double`（方差收缩时间） |

噪声信道模型：`0` 去极化、`1` 去相位、`2` 振幅阻尼、`3` Pauli。

### 12.9 系统级内建

| 类别 | 函数 | 说明 |
| --- | --- | --- |
| 原子操作 | `sync_load` / `sync_store` / `sync_add` / `sync_cas` | 映射到 LLVM 原子指令（load/store atomic、atomicrmw、cmpxchg） |
| 端口 I/O | `outb(port, val)` / `inb(port)` | x86 端口读写（16550 UART 等） |
| 堆分配 | `qk_gc_alloc(n)` / `qk_gc_free(p)` | 内核堆分配 / 释放 |
| 取地址 | `addr(&fn)` | 取函数地址（低 32 位） |
| 内联汇编 | `native("hlt")` | 内联汇编模板（`asm sideeffect`） |

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

### 14.5 flavor（味 / 枚举）

`flavor` 是 `enum` 的量子化命名，声明具名常量，按声明顺序自动赋值 `0,1,2,...`：

```qk
flavor Channel {
    DEPOLARIZING,
    DEPHASING,
    AMPLITUDE_DAMPING,
    PAULI
}

int32 m = Channel.PAULI;    // 3
```

### 14.6 fuse（融合 / 模式匹配）

`fuse` 是 `match` 模式匹配的量子化命名（Hopf 余乘解构），对判别值做多分支解构；`_` 为通配模式：

```qk
int32 label = fuse (m) {
    0: 10,
    1: 20,
    2: 30,
    _: 0
};
```

---

## 15. 系统级编程（cap / unsafe / native）

qk 面向「量子机器人 + 裸机内核」，提供系统级构造：能力指针、危险操作块、内联汇编、
端口 I/O、原子操作与内核堆分配。这些操作必须显式置于 `unsafe { ... }` 块内，作为
「写内核」的明确危险边界。

### 15.1 unsafe 块

```qk
int32 quark_main() {
    unsafe {
        // 危险操作：裸指针解引用 / MMIO / 内联汇编
    }
    return 0;
}
```

### 15.2 能力指针（cap）与解引用

```qk
unsafe {
    cap<int32> p = null;   // 能力指针，等价于 int32*
    *p = 5;                // 解引用写入（store）
    int32 x = *p;          // 解引用读取（load）
}
```

`cap<T>` 是 CHERI 式能力（地址 + 边界 + 权限 + 有效性），在 LLVM 层降为 `T*`。

### 15.3 内联汇编（native）

```qk
unsafe {
    native("hlt");         // 生成 call void asm sideeffect "hlt"
    native("cli");         // 关中断
}
```

### 15.4 原子操作（sync_*）

```qk
unsafe {
    cap<int32> p = null;
    sync_store(p, 1);       // store atomic
    int32 x = sync_load(p); // load atomic
    int32 y = sync_add(p, 1);// atomicrmw add
    int32 z = sync_cas(p, 1, 2); // cmpxchg
}
```

### 15.5 端口 I/O（outb / inb）

```qk
unsafe {
    outb(1016, 81);         // 16550 UART：写 'Q'
    int32 st = inb(1021);   // 读 LSR 状态
}
```

### 15.6 内核堆分配与取地址

```qk
unsafe {
    cap<int32> buf = qk_gc_alloc(16);   // 分配 16 字节
    qk_gc_free(buf);                    // 释放
    int32 h = addr(&quark_main);        // 取函数地址低 32 位
}
```

### 15.7 函数属性

```qk
@[section(".text.boot")] @[naked]
int32 quark_main() {
    return 0;
}
```

### 15.8 QCOS 可启动内核

qk 的系统级构造可直接用于编写裸机内核：`runtime/qcos/` 提供 Multiboot2 引导汇编
（`boot_x86_32.S` / `boot_x86_64.S`）、`kernel_main.cpp` 入口、`qk_shim.cpp` /
`qk_shim32.cpp` 桥接与 `linker_x86_64.ld` 链接脚本；`qcos_core` 是 freestanding
内核核心库（DragonPmm / Vmm / Spinlock / Sched / Serial / Qms，无 LLVM / Kokkos /
libstdc++ 依赖）。

`qk_shim.cpp` / `qk_shim32.cpp` 同时桥接完整的 QCOS syscall ABI（`qk_sys_call` /
`qk_sys_calld` / `qk_sys_log` / `qk_sys_logi` / `qk_sys_callp` / `qk_gc_alloc` /
`qk_gc_free`，见 12.7 节），串口为唯一输出通道；其 freestanding 实现集中在
`runtime/qcos/qcos_syscall.hpp`，语义与 hosted `qhal/QcosSyscall.hpp` 一致。

> QCOS 内核隶属正式项目 [QuarkOS](https://github.com/LukaKrajina/QuarkOS)。

构建链（QK 源码 → LLVM IR → freestanding object → 链接引导 stub → 可启动 ELF / ISO）：

```bash
.\scripts\build-qcos-kernel.ps1 -Source examples\qcos_kernel.qk   # QK → 可启动 ELF
.\scripts\build-qcos-iso.ps1                                       # → 可启动 ISO
qemu-system-x86_64 -cdrom runtime/build/qcos.iso -display none -serial stdio
```

示例：`examples/qcos_kernel.qk`（串口 + 位图分配器 + IDT 打包）、
`examples/qcos_quantum_service.qk`（QMS 量子服务下沉到裸机）、
`examples/qk_idt.qk` / `examples/qk_idt2.qk`（IDT 条目打包）、
`examples/qk_bitmap.qk`（位图分配器）、`examples/qk_buddy.qk`（伙伴系统）。

---

## 16. 并发与纠缠（spawn / entangle）

qk 用 `spawn` 派生并发线程、`entangle` 声明量子纠缠，二者为 Q-Digest 静态竞争检测
（digest 框架）提供「线程」与「纠缠闭包」的构造原语。

### 16.1 spawn

```qk
spawn {
    // 并发执行体，闭包继承外层作用域
    // 是竞争检测的"线程"单元
}
```

### 16.2 entangle

```qk
entangle(q1, q2);   // 声明 q1 与 q2 纠缠
```

纠缠具有传递性：对 `q1` 的破坏性操作（测量/释放）会影响与 `q1` 纠缠的 `q3`。竞争检测
据此构建纠缠闭包，跨线程触及同一闭包且无共同锁时报告量子竞争。

---

## 17. 借用检查与线性类型

qk 引入 Polonius 风格的借用检查器（`borrow.ts`，刻意比 rustc 保守）与量子线性类型
（QLT），在 MIR 上静态保证内存与量子资源安全。

### 17.1 量子线性类型（QLT）

`Qubit` / `QObject` 受 no-cloning 约束，每个线性变量必须在每条执行路径上**恰好**被消费
一次（消费 = `measure` / `release` / 按值 move）：

```qk
Qubit q = alloc();      // 线性变量
// let q2 = q;          // E-Q001：不可克隆
int32 r = measure(q);   // 消费 q（之后不可再用）
// 若 q 从未被消费     // E-Q002：线性泄漏
```

### 17.2 借用冲突

| 错误码 | 含义 |
| --- | --- |
| `E-Q001` | 量子不可克隆（重复消费同一线性变量） |
| `E-Q002` | 线性泄漏（线性变量未被消费） |
| `E0499` | 同一 place 同时存在两个可变借用 / 可变与共享借用并存 |
| `E0506` | 共享借用活跃时对该 place 写入 |

借用检查以「生命周期 = 程序点集合」的子集式（subset）思想实现，不采用 NLL 的约束求解，
以规避如 rustc 在该区域的可靠性缺陷。

---

## 18. 编译管线与运行

| 命令 | 说明 |
| --- | --- |
| `qk run <file.qk>` | 编译并运行 |
| `qk ir <file.qk>` | 输出 LLVM IR |
| `qk compile <x32\|x64\|arm64> <-e\|-m> <file.qk>` | AOT 编译为原生二进制 |
| `qk verify <file.qk> [--smt [out]]` | 静态验证契约 |
| `qk serve <model.qkm> [--port p]` | 启动推理服务 |

运行依赖 daemon（`./runtime --daemon`，监听 `localhost:50052`）。

---

## 19. 附录：关键字与错误类型

### 19.1 关键字

```text
// 基础与控制流
let auto int new return if else while for break continue fn
int8 int16 int32 int64 uint8 uint16 uint32 uint64
float double string char
// 量子类型与门
Qubit QObject QModel DiracState BellState QuantumRegister
alloc measure encode_text encode_image qlm_invoke qlm_load
qk_encode_string qlm_forward qk_decode_string
mind_read mind_train mind_feedback veda_qlm_train
// 类型系统与模块
mod use pub form impl trait template rank self flavor fuse
export import requires ensures invariant result from
// 神经/软逻辑原语
surrogate tanh_quantize lif_step mellowmax2 logsumexp2 boltzmann2
tnorm_luk tnorm_prod tnorm_godel polymer_weight polymer_mix_bound
// 系统级（裸机 / 内核）
make cap unsafe null native fixed
sync_load sync_store sync_add sync_cas
outb inb qk_gc_alloc qk_gc_free addr
qk_sys_call qk_sys_calld qk_sys_log qk_sys_logi qk_sys_callp
qk_qms_gap qk_mix_bound qk_qms_conc
// 量子化命名范式与并发
route path fallback spin spawn entangle
```

### 19.2 常见错误类型

| 类别 | 示例 |
| --- | --- |
| `Type Error` | 类型不匹配 |
| `Quantum Violation` | 克隆 qubit / 测量后使用 qubit |
| `Borrow Error` | `E-Q001` 不可克隆 / `E-Q002` 线性泄漏 / `E0499` 借用冲突 / `E0506` 共享借用写入 |
| `Race Error` | Q-Digest 检测到的数据竞争 / 量子竞争（纠缠闭包） |
| `Reference Error` | 未定义变量 / `break` 在循环外 |
| `Signature Error` | 参数数量不符 |
| `Inheritance Error` | 重复继承 / 父类型不存在 |
| `Impl Error` | 未实现 trait 方法 / trait 不存在 |
| `Contract Error` | `requires` / `ensures` / `invariant` 类型非布尔 |
| `Ambiguity Warning` | 门名与变量名冲突 |

---

> 相关文档：[README](../README.md) · [量子机器人仿真平台手册](./quarkrsp-manual.md) · [qk 量子学习手册](./qk-quantum-learning-manual.md)