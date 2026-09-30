// ============================================================================
// hover-docs.ts —— qk 关键字 / 类型 / 内置函数的悬停详细文档
//
// 为 VSCode 悬停提示提供「作用 / 语法 / 参数 / 返回值 / 示例」的 Markdown 说明，
// 内容与 docs/qk-language-manual.md保持一致，作为编辑器内的轻量参考。
//
// 同时提供中文（zh）与英文（en）双语说明：根据开发者系统语言（LSP Initialize
// 的 `locale` 字段）自动选择显示语言。
// ============================================================================

export type Lang = 'zh' | 'en';

export interface HoverDoc {
    /** 一句话作用描述（中文） */
    purpose: string;
    /** 一句话作用描述（English） */
    purposeEn: string;
    /** 语法（代码片段，双语共用） */
    syntax?: string;
    /** 参数说明（中文） */
    params?: string;
    /** 参数说明（English） */
    paramsEn?: string;
    /** 返回值说明（中文） */
    returns?: string;
    /** 返回值说明（English） */
    returnsEn?: string;
    /** 补充说明（中文） */
    detail?: string;
    /** 补充说明（English） */
    detailEn?: string;
    /** 示例代码（双语共用） */
    example?: string;
}

/** 分节标题的多语言映射 */
const HEADERS: Record<Lang, { syntax: string; params: string; returns: string; example: string }> = {
    zh: { syntax: '语法', params: '参数', returns: '返回', example: '示例' },
    en: { syntax: 'Syntax', params: 'Parameters', returns: 'Returns', example: 'Example' },
};

/** 渲染一段悬停 Markdown（VSCode 支持 fenced code block 语法高亮）。 */
export function renderHover(kind: string, name: string, doc: HoverDoc, lang: Lang = 'zh'): string {
    const h = HEADERS[lang];
    const purpose = lang === 'en' ? doc.purposeEn : doc.purpose;
    const detail = lang === 'en' ? (doc.detailEn ?? doc.detail) : doc.detail;
    const params = lang === 'en' ? (doc.paramsEn ?? doc.params) : doc.params;
    const returns = lang === 'en' ? (doc.returnsEn ?? doc.returns) : doc.returns;

    const lines: string[] = [];
    lines.push(`**\`${name}\`** — ${kind}`);
    lines.push('');
    lines.push(purpose);
    if (detail) {
        lines.push('');
        lines.push(detail);
    }
    if (doc.syntax) {
        lines.push('');
        lines.push(`**${h.syntax}**`);
        lines.push('```qk');
        lines.push(doc.syntax);
        lines.push('```');
    }
    if (params) {
        lines.push('');
        lines.push(`**${h.params}**`);
        lines.push(params);
    }
    if (returns) {
        lines.push('');
        lines.push(`**${h.returns}**`);
        lines.push(returns);
    }
    if (doc.example) {
        lines.push('');
        lines.push(`**${h.example}**`);
        lines.push('```qk');
        lines.push(doc.example);
        lines.push('```');
    }
    return lines.join('\n');
}

/** 控制流关键字 */
export const KEYWORD_DOCS: Record<string, HoverDoc> = {
    if: {
        purpose: '条件分支：当条件为真时执行 `then` 块，否则执行可选的 `else` 块。',
        purposeEn: 'Conditional branch: runs the `then` block when the condition is true, otherwise the optional `else` block.',
        syntax: 'if (cond) {\n    // 条件为真\n} else {\n    // 条件为假\n}',
        detail: '`else if` 解析为「else 分支只含一个 IfStatement」的链式结构。',
        detailEn: '`else if` is parsed as an `else` branch containing a single IfStatement.',
        example: 'if (a > 0 && b < 10) {\n    return 1;\n} else {\n    return 0;\n}',
    },
    else: {
        purpose: '配合 `if` 提供条件为假时的分支；也可作为 `while` 的「零次执行」分支。',
        purposeEn: 'Provides the false branch for `if`; also the "zero-iteration" branch of `while`.',
        syntax: 'if (cond) { ... } else { ... }',
    },
    while: {
        purpose: '前置条件循环：条件为真时重复执行循环体。',
        purposeEn: 'Pre-condition loop: repeats the body while the condition holds.',
        syntax: 'while (cond) {\n    invariant i >= 0;   // 可选循环不变量\n    // 循环体\n} else {\n    // 循环体一次都未执行时进入\n}',
        detail: '支持 `invariant`（循环不变量，用于静态验证）与 `else`（零次执行分支）。',
        detailEn: 'Supports `invariant` (loop invariant, for static verification) and `else` (zero-iteration branch).',
        example: 'while (i < 100) {\n    i = i + 1;\n}',
    },
    for: {
        purpose: '标准三段式 for 循环：初始化、条件、更新。',
        purposeEn: 'Standard three-clause for loop: init, condition, update.',
        syntax: 'for (int32 i = 0; i < 10; i = i + 1) {\n    // 循环体\n}',
        example: 'for (int32 i = 0; i < 10; i = i + 1) {\n    outl(0x3F8, i);\n}',
    },
    return: {
        purpose: '从函数返回；`return;` 表示 void 函数空返回。',
        purposeEn: 'Returns from a function; `return;` is an empty void return.',
        syntax: 'return expr;    // 有返回值\nreturn;         // void 空返回',
        example: 'int32 add(int32 a, int32 b) {\n    return a + b;\n}',
    },
    break: {
        purpose: '跳出当前循环（`while` / `for` / `spin`）。',
        purposeEn: 'Exits the current loop (`while` / `for` / `spin`).',
        syntax: 'break;',
        detail: '语义分析器会检查 `break` 是否位于循环之外，否则报 `Reference Error`。',
        detailEn: 'The analyzer flags `break` outside a loop as a `Reference Error`.',
    },
    continue: {
        purpose: '跳过当前迭代，进入下一次循环判断。',
        purposeEn: 'Skips the current iteration and continues with the next loop check.',
        syntax: 'continue;',
        detail: '语义分析器会检查 `continue` 是否位于循环之外。',
        detailEn: 'The analyzer checks that `continue` is inside a loop.',
    },
    spawn: {
        purpose: '派生并发线程（Q-Digest 的「线程」单元）。',
        purposeEn: 'Spawns a concurrent thread (the "thread" unit of Q-Digest).',
        syntax: 'spawn {\n    // 并发执行体\n}',
        detail: '块体闭包继承外层作用域，编译为独立线程函数 `@qk_thread_N`，经 `qk_spawn` 以 `std::thread` 启动（真实并发）。',
        detailEn: 'The block closure inherits the enclosing scope and compiles to a thread function `@qk_thread_N`, launched via `qk_spawn` with `std::thread` (real concurrency).',
        example: 'spawn {\n    Qubit q = alloc();\n    h(q);\n    int32 r = measure(q);\n}',
    },
    entangle: {
        purpose: '声明两个量子比特纠缠（Q-Digest 纠缠闭包原语）。',
        purposeEn: 'Declares entanglement between two qubits (Q-Digest entanglement closure primitive).',
        syntax: 'entangle(q1, q2);',
        detail: '纠缠具有传递性；竞争检测据此构建纠缠闭包，判定跨线程破坏性操作。',
        detailEn: 'Entanglement is transitive; race detection builds the closure to flag cross-thread destructive operations.',
        example: 'entangle(q1, q2);\nentangle(q2, q3);   // q1 ~ q3',
    },
    spin: {
        purpose: '自旋循环（do-while 的量子化命名）：先执行循环体，再判断条件，至少执行一次。',
        purposeEn: 'Spin loop (quantum naming of do-while): runs the body first, then checks the condition, executing at least once.',
        syntax: 'spin {\n    // 循环体（至少执行一次）\n} while (cond);',
        example: 'spin {\n    i = i + 1;\n} while (i < 10);',
    },
    route: {
        purpose: '路由分支（switch 的量子化命名）：把判别值路由到若干路径之一。',
        purposeEn: 'Route branch (quantum naming of switch): routes a discriminant value to one of several paths.',
        syntax: 'route (discriminant) {\n    path V1: { ... }\n    path V2: { ... }\n    fallback: { ... }\n}',
        example: 'route (code) {\n    path 0: { return 10; }\n    path 1: { return 20; }\n    fallback: { return 0; }\n}',
    },
    fuse: {
        purpose: '融合-模式匹配表达式（match 的量子化命名，Hopf 余乘解构）。',
        purposeEn: 'Fusion pattern-matching expression (quantum naming of match, Hopf comultiplication).',
        syntax: 'fuse (discriminant) {\n    pattern1: value1,\n    pattern2: value2,\n    _: default\n}',
        detail: '`_` 为通配模式。',
        detailEn: '`_` is the wildcard pattern.',
        example: 'int32 label = fuse (m) {\n    0: 10,\n    1: 20,\n    _: 0\n};',
    },
    fallback: {
        purpose: '`route` 中的兜底分支，等价于 `switch` 的 `default`。',
        purposeEn: 'The fallback branch of `route`, equivalent to `switch`\'s `default`.',
        syntax: 'route (d) {\n    path V: { ... }\n    fallback: { ... }\n}',
    },
    new: {
        purpose: '栈分配构造对象。',
        purposeEn: 'Stack-allocates and constructs an object.',
        syntax: 'auto obj = new TypeName(args);',
        detail: '`new` 栈分配、`make` 堆分配（经 GC 堆）。',
        detailEn: '`new` allocates on the stack; `make` allocates on the heap (via GC).',
        example: 'auto bell = new BellState();\nint32 m = bell.measure();',
    },
    make: {
        purpose: '堆分配构造对象（经 GC 堆）。',
        purposeEn: 'Heap-allocates and constructs an object (via the GC heap).',
        syntax: 'auto obj = make TypeName(args);',
        detail: '`make` 堆分配、`new` 栈分配。',
        detailEn: '`make` allocates on the heap; `new` on the stack.',
        example: 'auto b = make BellState();',
    },
    auto: {
        purpose: '类型推断声明（与 `let` 等价）：由初始值推导变量类型。',
        purposeEn: 'Type-inference declaration (equivalent to `let`): the type is derived from the initializer.',
        syntax: 'auto x = expr;',
        example: 'auto q = alloc();      // Qubit\nauto n = 42;          // int32\nauto s = "quark";     // string',
    },
    let: {
        purpose: '类型推断声明（与 `auto` 等价）：由初始值推导变量类型。',
        purposeEn: 'Type-inference declaration (equivalent to `auto`): the type is derived from the initializer.',
        syntax: 'let x = expr;',
        example: 'let f = 3.14;    // double',
    },
    fn: {
        purpose: '匿名函数（lambda / 闭包）与函数指针类型。',
        purposeEn: 'Anonymous function (lambda / closure) and function-pointer type.',
        syntax: 'let f = fn(int32 x) -> int32 {\n    return x * 2;\n};',
        detail: '函数指针类型写作 `fn<ret(params)>`（等价于 `(params)->ret`），取函数地址用 `&`。',
        detailEn: 'The function-pointer type is written `fn<ret(params)>` (equivalent to `(params)->ret`); take a function\'s address with `&`.',
        example: 'fn<int32(int32)> cb = &handler;\nint32 r = cb(41);',
    },
    result: {
        purpose: '在契约 `ensures` 中引用函数返回值。',
        purposeEn: 'References the function\'s return value inside an `ensures` contract.',
        syntax: 'ensures result >= 0;',
        example: 'int32 square(int32 x)\n    ensures result >= 0;\n{ return x * x; }',
    },
    unsafe: {
        purpose: '系统级危险操作块（裸指针解引用 / MMIO / 内联汇编）。',
        purposeEn: 'System-level unsafe block (raw pointer dereference / MMIO / inline assembly).',
        syntax: 'unsafe {\n    // 危险操作\n}',
        detail: '是「写内核」的显式危险边界；能力校验在语义层完成。',
        detailEn: 'An explicit danger boundary for "kernel writing"; capability checks happen in the semantic layer.',
        example: 'unsafe {\n    cap<int32> p = null;\n    *p = 5;\n}',
    },

    // ── 声明 / 模块 / 类型系统关键字 ──
    mod: {
        purpose: '定义模块。',
        purposeEn: 'Defines a module.',
        syntax: 'mod name {\n    // 成员\n}',
        example: 'mod math {\n    pub int32 add(int32 a, int32 b) { return a + b; }\n}',
    },
    use: {
        purpose: '路径导入。',
        purposeEn: 'Path import.',
        syntax: 'use path::to::item;',
    },
    pub: {
        purpose: '声明公开成员。',
        purposeEn: 'Declares a public member.',
        syntax: 'pub int32 f() { ... }',
    },
    form: {
        purpose: '定义数据结构（支持单继承 `inherits` 与 `rank` 秩）。',
        purposeEn: 'Defines a data structure (with single inheritance `inherits` and `rank` blocks).',
        syntax: 'form Name {\n    Type field;\n    // rank 秩块\n}',
        detail: '`@[packed] form` 定义精确字节布局结构（无 vtable、无填充）；字段支持位域 `T f : N`。',
        detailEn: '`@[packed] form` defines an exact byte layout (no vtable, no padding); fields support bitfields `T f : N`.',
        example: 'form Point {\n    double x;\n    double y;\n}',
    },
    impl: {
        purpose: '为类型实现 trait（`impl <trait> for <type>`）。',
        purposeEn: 'Implements a trait for a type (`impl <trait> for <type>`).',
        syntax: 'impl Trait for Type {\n    // 方法\n}',
        example: 'impl Shape for Circle {\n    double area() { return 3.14; }\n}',
    },
    trait: {
        purpose: '定义可共享的行为接口。',
        purposeEn: 'Defines a shareable behavior interface.',
        syntax: 'trait Name {\n    Ret method(Params);\n}',
        example: 'trait Shape {\n    double area();\n}',
    },
    template: {
        purpose: '泛型声明（作用于 `form` / `impl`）。',
        purposeEn: 'Generic declaration (applies to `form` / `impl`).',
        syntax: 'template<T> form Box {\n    T value;\n}',
        example: 'template<T> form Box { T value; }\nauto b = new Box<int32>();',
    },
    rank: {
        purpose: '在 `form` / `trait` 中声明秩块（将字段与方法分组成不同秩）。',
        purposeEn: 'Declares a rank block in `form` / `trait` (groups fields and methods into ranks).',
        syntax: 'form Name {\n    rank classical { ... }\n    rank quantum { ... }\n}',
    },
    self: {
        purpose: '方法接收者（`self` 按值 / `&self` 借用）。',
        purposeEn: 'Method receiver (`self` by value / `&self` by borrow).',
        syntax: 'Ret method(self, ...) { ... }\nRet method(&self, ...) { ... }',
    },
    lattice: {
        purpose: '晶格数组类型（`lattice<T, B>`），支持多维下标访问 `a[x, y]`。',
        purposeEn: 'Lattice array type (`lattice<T, B>`), supports multi-dimensional indexing `a[x, y]`.',
        syntax: 'lattice<int32, open> board = ...;\nint32 v = board[x, y];',
    },
    cap: {
        purpose: '能力指针类型（CHERI 式：地址 + 边界 + 权限 + 有效性）。',
        purposeEn: 'Capability pointer type (CHERI-style: address + bounds + permission + validity).',
        syntax: 'cap<int32> p = null;\n*p = 5;\nint32 x = *p;',
        detail: '在 LLVM 层降为普通指针 `T*`，语义层受借用检查与 `unsafe` 约束。',
        detailEn: 'Lowers to a plain pointer `T*` in LLVM, constrained by the borrow checker and `unsafe`.',
    },
    native: {
        purpose: '内联汇编（逃逸到目标机器原生指令集）。',
        purposeEn: 'Inline assembly (escapes to the target machine\'s native instruction set).',
        syntax: 'native("hlt");\nnative("lidt (${0})", &idtr);',
        detail: '模板用 `${0}`/`${1}` 占位引用操作数，操作数默认 `"r"` 约束。须在 `unsafe` 块内。',
        detailEn: 'Templates reference operands with `${0}`/`${1}`; operands default to the `"r"` constraint. Must be inside an `unsafe` block.',
    },
    fixed: {
        purpose: '编译期常量（`const` 的量子化命名，确定型范式）。',
        purposeEn: 'Compile-time constant (quantum naming of `const`, the definite paradigm).',
        syntax: 'fixed int32 MAX = 100;',
        example: 'fixed int32 MAX = 100;\nint32 x = MAX;',
    },
    flavor: {
        purpose: '味（`enum` 的量子化命名）：具名常量，按声明顺序自动赋值。',
        purposeEn: 'Flavor (quantum naming of `enum`): named constants auto-assigned in declaration order.',
        syntax: 'flavor Name {\n    A,\n    B = 5,\n    C       // C 自动 = 6\n}',
        example: 'flavor Channel { DEPOLARIZING, DEPHASING, AMPLITUDE_DAMPING, PAULI }\nint32 m = Channel.PAULI;   // 3',
    },
    addr: {
        purpose: '取函数地址（返回低 32 位整数地址）。',
        purposeEn: 'Takes a function\'s address (returns the low 32 bits).',
        syntax: 'int32 h = addr(&fn);',
    },
    basis_state: {
        purpose: '在任意基（布洛赫方向 θ, φ）下构建量子态。',
        purposeEn: 'Builds a quantum state in an arbitrary basis (Bloch direction θ, φ).',
        syntax: 'auto q = basis_state(theta, phi, value);',
        params: '`theta`（double）极角、`phi`（double）方位角、`value`（int32）0 为 + 本征态 / 1 为 - 本征态。',
        paramsEn: '`theta` (double) polar angle, `phi` (double) azimuth, `value` (int32) 0 for the + eigenstate / 1 for the - eigenstate.',
        returns: '`QObject`',
        returnsEn: '`QObject`',
        example: 'auto xplus = basis_state(1.5707963, 0.0, 0);   // X 基 |+⟩',
    },
    export: {
        purpose: '导出符号（模块成员或函数）。',
        purposeEn: 'Exports a symbol (module member or function).',
        syntax: 'export int32 f() { ... }',
    },
    import: {
        purpose: '导入 `.mmi` 模块（配合 `from`）。',
        purposeEn: 'Imports a `.mmi` module (with `from`).',
        syntax: 'import alias from "./module.mmi";',
    },
    extern: {
        purpose: '外部 C 符号声明（FFI），调用原生动态库函数。',
        purposeEn: 'External C symbol declaration (FFI), calls a native dynamic-library function.',
        syntax: 'extern <ret> <name>(<params>);',
    },
    requires: {
        purpose: '声明权限（模块权限）或函数前置条件。',
        purposeEn: 'Declares a permission (module permission) or a function precondition.',
        syntax: 'requires io.network;                    // 权限\nfn f() requires x >= 0; { ... }   // 前置条件',
    },
    ensures: {
        purpose: '函数后置条件（静态验证契约）。',
        purposeEn: 'Function postcondition (static verification contract).',
        syntax: 'fn f() ensures result >= 0; { ... }',
    },
    invariant: {
        purpose: '循环不变量（用于 `while` / `for` 静态验证）。',
        purposeEn: 'Loop invariant (for `while` / `for` static verification).',
        syntax: 'while (cond) {\n    invariant i >= 0;\n    ...\n}',
    },
    from: {
        purpose: '配合 `import` 指定模块来源路径。',
        purposeEn: 'Specifies the module source path together with `import`.',
        syntax: 'import alias from "./module.mmi";',
    },
    path: {
        purpose: '`route` 中的取值分支标签。',
        purposeEn: 'A value-branch label inside `route`.',
        syntax: 'route (d) {\n    path V: { ... }\n}',
    },
    asm: {
        purpose: '裸汇编块（多指令 / 多寄存器序列）。',
        purposeEn: 'Raw assembly block (multi-instruction / multi-register sequence).',
        syntax: 'asm {\n    "push rax; push rbx;"\n    "iretq;"\n}',
        detail: '块内字符串按行拼接，不做 `${}` 占位符替换；与 `@[naked]` 裸函数配合时直接发射为裸汇编体。',
        detailEn: 'Strings inside are joined by lines without `${}` substitution; with `@[naked]` it emits the raw body directly.',
    },
};

/** 类型关键字 */
export const TYPE_DOCS: Record<string, HoverDoc> = {
    int: { purpose: '32 位有符号整数（`int32` 的别名）。', purposeEn: '32-bit signed integer (alias of `int32`).', detail: 'LLVM 映射：`i32`。', detailEn: 'LLVM mapping: `i32`.', example: 'int x = 42;' },
    int8: { purpose: '8 位有符号整数。', purposeEn: '8-bit signed integer.', detail: 'LLVM 映射：`i8`。', detailEn: 'LLVM mapping: `i8`.' },
    int16: { purpose: '16 位有符号整数。', purposeEn: '16-bit signed integer.', detail: 'LLVM 映射：`i16`。', detailEn: 'LLVM mapping: `i16`.' },
    int32: { purpose: '32 位有符号整数。', purposeEn: '32-bit signed integer.', detail: 'LLVM 映射：`i32`。', detailEn: 'LLVM mapping: `i32`.', example: 'int32 x = 42;' },
    int64: { purpose: '64 位有符号整数。', purposeEn: '64-bit signed integer.', detail: 'LLVM 映射：`i64`。', detailEn: 'LLVM mapping: `i64`.' },
    uint8: { purpose: '8 位无符号整数。', purposeEn: '8-bit unsigned integer.', detail: 'LLVM 映射：`i8`（无符号语义）。', detailEn: 'LLVM mapping: `i8` (unsigned semantics).' },
    uint16: { purpose: '16 位无符号整数。', purposeEn: '16-bit unsigned integer.', detail: 'LLVM 映射：`i16`。', detailEn: 'LLVM mapping: `i16`.' },
    uint32: { purpose: '32 位无符号整数。', purposeEn: '32-bit unsigned integer.', detail: 'LLVM 映射：`i32`。', detailEn: 'LLVM mapping: `i32`.' },
    uint64: { purpose: '64 位无符号整数。', purposeEn: '64-bit unsigned integer.', detail: 'LLVM 映射：`i64`，走 `udiv`/`urem`/`lshr` 无符号语义，承载 48 位 LBA / GPT 64 位字段。', detailEn: 'LLVM mapping: `i64`, uses `udiv`/`urem`/`lshr` unsigned semantics, holds 48-bit LBA / GPT 64-bit fields.' },
    float: { purpose: '单精度浮点。', purposeEn: 'Single-precision float.', detail: 'LLVM 映射：`float`。', detailEn: 'LLVM mapping: `float`.' },
    double: { purpose: '双精度浮点。', purposeEn: 'Double-precision float.', detail: 'LLVM 映射：`double`。', detailEn: 'LLVM mapping: `double`.' },
    complex64: { purpose: '单精度复数（量子态矢量运算）。', purposeEn: 'Single-precision complex (quantum state-vector arithmetic).', detail: 'LLVM 映射：`{ float, float }`。', detailEn: 'LLVM mapping: `{ float, float }`.', example: 'complex64 z = complex(1.0, 2.0);' },
    complex128: { purpose: '双精度复数（量子态矢量运算）。', purposeEn: 'Double-precision complex (quantum state-vector arithmetic).', detail: 'LLVM 映射：`{ double, double }`。', detailEn: 'LLVM mapping: `{ double, double }`.', example: 'complex128 z = complex(1.0, 2.0);' },
    arr: { purpose: '定长数组类型 `arr<T, N>`（静态查找表）。', purposeEn: 'Fixed-size array type `arr<T, N>` (static lookup table).', detail: 'LLVM 映射：`[N x T]`。', detailEn: 'LLVM mapping: `[N x T]`.', syntax: 'arr<int32, 4> a = [1, 2, 3, 4];', example: 'fixed arr<int32, 4> SCANCODES = [0x1E, 0x30, 0x2E, 0x20];' },
    string: { purpose: '字符串。', purposeEn: 'String.', detail: 'LLVM 映射：`i8*`。', detailEn: 'LLVM mapping: `i8*`.', example: 'string s = "quark";' },
    char: { purpose: '字符。', purposeEn: 'Character.', detail: 'LLVM 映射：`i8`。', detailEn: 'LLVM mapping: `i8`.' },
    bool: { purpose: '布尔类型。', purposeEn: 'Boolean type.', detail: 'LLVM 映射：`i1`。比较运算返回 `bool`。', detailEn: 'LLVM mapping: `i1`; comparisons return `bool`.' },
    void: { purpose: '空类型（无返回值）。', purposeEn: 'Void type (no return value).', detail: 'LLVM 映射：`void`。', detailEn: 'LLVM mapping: `void`.', example: 'void do_nothing() { return; }' },
    Qubit: { purpose: '单个量子比特，不可克隆。', purposeEn: 'A single qubit, non-clonable.', detail: 'LLVM 映射：`%Qubit*`（opaque）。受量子线性类型（QLT）no-cloning 约束。', detailEn: 'LLVM mapping: `%Qubit*` (opaque). Subject to QLT no-cloning.', example: 'Qubit q = alloc();' },
    QObject: { purpose: '量子对象（可容纳多 qubit 状态）。', purposeEn: 'Quantum object (may hold multi-qubit state).', detail: 'LLVM 映射：`%QObject*`（opaque）。', detailEn: 'LLVM mapping: `%QObject*` (opaque).' },
    QModel: { purpose: '量子语言模型。', purposeEn: 'Quantum language model.', detail: 'LLVM 映射：`%QModel*`（opaque）。支持 `.export(path)` 导出 `.qkm`。', detailEn: 'LLVM mapping: `%QModel*` (opaque). Supports `.export(path)` to `.qkm`.' },
    QRegister: { purpose: '量子寄存器类型。', purposeEn: 'Quantum register type.', detail: '用于量子寄存器操作。', detailEn: 'Used for quantum-register operations.' },
    Result: { purpose: '测量结果类型。', purposeEn: 'Measurement result type.', detail: '量子测量的结果。', detailEn: 'The result of a quantum measurement.' },
    DiracState: { purpose: '狄拉克态（n 维）。', purposeEn: 'Dirac state (n-dimensional).', syntax: 'auto s = new DiracState(n);', returns: '`QObject`', returnsEn: '`QObject`' },
    BellState: { purpose: 'Bell 态。', purposeEn: 'Bell state.', syntax: 'auto b = new BellState();', returns: '`QObject`', returnsEn: '`QObject`' },
    QuantumRegister: { purpose: 'n 比特量子寄存器。', purposeEn: 'n-qubit quantum register.', syntax: 'auto reg = new QuantumRegister(n);', returns: '`QObject`', returnsEn: '`QObject`' },
    QReservoir: { purpose: '量子存储池（QReservoir）。', purposeEn: 'Quantum reservoir.', detail: '用于量子资源管理。', detailEn: 'Used for quantum resource management.' },
};

/** 内置函数 */
export const FUNCTION_DOCS: Record<string, HoverDoc> = {
    // ── 量子核心 ──
    alloc: { purpose: '分配一个量子比特。', purposeEn: 'Allocates a qubit.', syntax: 'alloc()', returns: '`Qubit`', returnsEn: '`Qubit`', example: 'Qubit q = alloc();' },
    measure: { purpose: '测量量子比特并坍缩，返回 0/1。', purposeEn: 'Measures a qubit and collapses it, returning 0/1.', syntax: 'measure(q)', params: '`q`（Qubit）待测量比特。', paramsEn: '`q` (Qubit) the qubit to measure.', returns: '`int32`', returnsEn: '`int32`', example: 'int32 r = measure(q);' },
    measure_x: { purpose: 'X 基测量量子比特。', purposeEn: 'Measures a qubit in the X basis.', syntax: 'measure_x(q)', params: '`q`（Qubit）。', paramsEn: '`q` (Qubit).', returns: '`int32`', returnsEn: '`int32`' },
    measure_y: { purpose: 'Y 基测量量子比特。', purposeEn: 'Measures a qubit in the Y basis.', syntax: 'measure_y(q)', params: '`q`（Qubit）。', paramsEn: '`q` (Qubit).', returns: '`int32`', returnsEn: '`int32`' },
    basis_state: { purpose: '在任意基（θ, φ）下构建量子态。', purposeEn: 'Builds a quantum state in an arbitrary basis (θ, φ).', syntax: 'basis_state(theta, phi, value)', params: '`theta`/`phi`（double）布洛赫方向，`value`（int32）0/1。', paramsEn: '`theta`/`phi` (double) Bloch direction, `value` (int32) 0/1.', returns: '`QObject`', returnsEn: '`QObject`' },

    // ── 量子门 ──
    h: { purpose: 'Hadamard 门。', purposeEn: 'Hadamard gate.', syntax: 'h(q)', params: '`q`（Qubit）。', paramsEn: '`q` (Qubit).' },
    x: { purpose: 'Pauli-X 门（NOT）。', purposeEn: 'Pauli-X gate (NOT).', syntax: 'x(q)', params: '`q`（Qubit）。', paramsEn: '`q` (Qubit).' },
    y: { purpose: 'Pauli-Y 门。', purposeEn: 'Pauli-Y gate.', syntax: 'y(q)', params: '`q`（Qubit）。', paramsEn: '`q` (Qubit).' },
    z: { purpose: 'Pauli-Z 门（相位翻转）。', purposeEn: 'Pauli-Z gate (phase flip).', syntax: 'z(q)', params: '`q`（Qubit）。', paramsEn: '`q` (Qubit).' },
    s: { purpose: 'S 门（π/2 相位门，= Rz(π/2)）。', purposeEn: 'S gate (π/2 phase gate, = Rz(π/2)).', syntax: 's(q)', params: '`q`（Qubit）。', paramsEn: '`q` (Qubit).' },
    t: { purpose: 'T 门（π/4 相位门，= Rz(π/4)）。', purposeEn: 'T gate (π/4 phase gate, = Rz(π/4)).', syntax: 't(q)', params: '`q`（Qubit）。', paramsEn: '`q` (Qubit).' },
    rz: { purpose: '绕 Z 轴旋转门。', purposeEn: 'Rotation gate about the Z axis.', syntax: 'rz(q, angle)', params: '`q`（Qubit）、`angle`（double）旋转角。', paramsEn: '`q` (Qubit), `angle` (double).' },
    rx: { purpose: '绕 X 轴旋转门。', purposeEn: 'Rotation gate about the X axis.', syntax: 'rx(q, angle)', params: '`q`（Qubit）、`angle`（double）旋转角。', paramsEn: '`q` (Qubit), `angle` (double).' },
    ry: { purpose: '绕 Y 轴旋转门。', purposeEn: 'Rotation gate about the Y axis.', syntax: 'ry(q, angle)', params: '`q`（Qubit）、`angle`（double）旋转角。', paramsEn: '`q` (Qubit), `angle` (double).' },
    cnot: { purpose: '受控非门（控制, 目标）。', purposeEn: 'Controlled-NOT gate (control, target).', syntax: 'cnot(control, target)', params: '`control`、`target`（Qubit）。', paramsEn: '`control`, `target` (Qubit).' },
    toffoli: { purpose: 'Toffoli 门（两控制一目标）。', purposeEn: 'Toffoli gate (two controls, one target).', syntax: 'toffoli(c1, c2, target)', params: '两个控制位 + 一个目标位（Qubit）。', paramsEn: 'Two controls + one target (Qubit).' },
    swap: { purpose: '交换两个量子比特。', purposeEn: 'Swaps two qubits.', syntax: 'swap(q1, q2)', params: '`q1`、`q2`（Qubit）。', paramsEn: '`q1`, `q2` (Qubit).' },
    qft: { purpose: '量子傅里叶变换。', purposeEn: 'Quantum Fourier transform.', syntax: 'qft(n)', params: '`n`（int）比特数。', paramsEn: '`n` (int) number of qubits.' },
    iqft: { purpose: '逆量子傅里叶变换（qft 的可逆对偶）。', purposeEn: 'Inverse quantum Fourier transform (reversible dual of qft).', syntax: 'iqft(n)', params: '`n`（int）比特数。', paramsEn: '`n` (int) number of qubits.' },
    braid: { purpose: '编织门（Yang-Baxter）。', purposeEn: 'Braid gate (Yang-Baxter).', syntax: 'braid(q1, q2)', params: '`q1`、`q2`（Qubit）。', paramsEn: '`q1`, `q2` (Qubit).' },
    cx: { purpose: '受控 X（= CNOT）。', purposeEn: 'Controlled X (= CNOT).', syntax: 'cx(control, target)' },
    ch: { purpose: '受控 Hadamard。', purposeEn: 'Controlled Hadamard.', syntax: 'ch(control, target)' },
    crz: { purpose: '受控 Rz。', purposeEn: 'Controlled Rz.', syntax: 'crz(control, target, angle)' },
    cswap: { purpose: '受控 SWAP（Fredkin）。', purposeEn: 'Controlled SWAP (Fredkin).', syntax: 'cswap(c, q1, q2)' },
    c_toffoli: { purpose: '受控 Toffoli（C³X）。', purposeEn: 'Controlled Toffoli (C³X).', syntax: 'c_toffoli(c, c1, c2, target)' },
    cqft: { purpose: '受控 QFT。', purposeEn: 'Controlled QFT.', syntax: 'cqft(control, n)' },
    cbraid: { purpose: '受控编织（Yang-Baxter）。', purposeEn: 'Controlled braid (Yang-Baxter).', syntax: 'cbraid(c, q1, q2)' },

    // ── 文本 / 图像编码 ──
    encode_text: { purpose: '将文本编码为量子对象。', purposeEn: 'Encodes text into a quantum object.', syntax: 'encode_text(s)', params: '`s`（string）。', paramsEn: '`s` (string).', returns: '`QObject`', returnsEn: '`QObject`' },
    encode_image: { purpose: '将图像加载并振幅编码为量子对象。', purposeEn: 'Loads an image and amplitude-encodes it into a quantum object.', syntax: 'encode_image(path, num_qubits)', params: '`path`（string）图像路径（PNG/JPEG/BMP/PGM 等）；`num_qubits`（int32）编码 qubit 数（像素下采样到 2^num_qubits）。', paramsEn: '`path` (string) image path; `num_qubits` (int32) encoding qubit count.', returns: '`QObject`', returnsEn: '`QObject`' },
    qk_encode_string: { purpose: '将字符串编码为量子对象。', purposeEn: 'Encodes a string into a quantum object.', syntax: 'qk_encode_string(s)', returns: '`QObject`', returnsEn: '`QObject`' },
    qk_decode_string: { purpose: '将量子对象解码为字符串。', purposeEn: 'Decodes a quantum object into a string.', syntax: 'qk_decode_string(q)', returns: '`string`', returnsEn: '`string`' },

    // ── 量子语言模型（QLM）──
    qlm_invoke: { purpose: '调用量子语言模型推理。', purposeEn: 'Invokes quantum language model inference.', syntax: 'qlm_invoke(data, steps, lr)', params: '`data`（QObject）、`steps`（int）、`lr`（double）。', paramsEn: '`data` (QObject), `steps` (int), `lr` (double).', returns: '`QModel`', returnsEn: '`QModel`' },
    qlm_load: { purpose: '加载量子语言模型。', purposeEn: 'Loads a quantum language model.', syntax: 'qlm_load(path)', params: '`path`（string）。', paramsEn: '`path` (string).', returns: '`QModel`', returnsEn: '`QModel`' },
    qlm_forward: { purpose: '量子语言模型前向传播。', purposeEn: 'Quantum language model forward pass.', syntax: 'qlm_forward(model, input)', params: '`model`（QModel）、`input`（QObject）。', paramsEn: '`model` (QModel), `input` (QObject).', returns: '`void`', returnsEn: '`void`' },

    // ── 脑机接口（QbNS）──
    mind_read: { purpose: '读取脑机接口信号。', purposeEn: 'Reads brain-computer interface signals.', syntax: 'mind_read(modality)', params: '`modality`（string）：`stream/spike/lfp/eeg/sensor`。', paramsEn: '`modality` (string): `stream/spike/lfp/eeg/sensor`.', returns: '`QObject`', returnsEn: '`QObject`' },
    mind_train: { purpose: '训练脑机接口。', purposeEn: 'Trains the brain-computer interface.', syntax: 'mind_train(data, steps, lr)', returns: '`void`', returnsEn: '`void`' },
    mind_feedback: { purpose: '脑机接口反馈。', purposeEn: 'Brain-computer interface feedback.', syntax: 'mind_feedback(data)', returns: '`void`', returnsEn: '`void`' },
    veda_qlm_train: { purpose: 'VedaROS 量子语言模型训练。', purposeEn: 'VedaROS quantum language model training.', syntax: 'veda_qlm_train(data, steps, lr)', returns: '`void`', returnsEn: '`void`' },

    // ── 标量数学 / 神经原语 ──
    surrogate: { purpose: '代理梯度函数。', purposeEn: 'Surrogate gradient function.', syntax: 'surrogate(x, a, b)', params: '`x`、`a`、`b`（double）。', paramsEn: '`x`, `a`, `b` (double).', returns: '`double`', returnsEn: '`double`' },
    tanh_quantize: { purpose: 'tanh 量化。', purposeEn: 'tanh quantization.', syntax: 'tanh_quantize(x, scale, bits)', returns: '`double`', returnsEn: '`double`' },
    lif_step: { purpose: 'LIF 神经元单步演化。', purposeEn: 'LIF neuron single-step evolution.', syntax: 'lif_step(v, i, tau, dt)', returns: '`double`', returnsEn: '`double`' },
    mellowmax2: { purpose: 'Mellowmax 算子。', purposeEn: 'Mellowmax operator.', syntax: 'mellowmax2(x, y, alpha)', returns: '`double`', returnsEn: '`double`' },
    logsumexp2: { purpose: 'LogSumExp 算子。', purposeEn: 'LogSumExp operator.', syntax: 'logsumexp2(x, y, alpha)', returns: '`double`', returnsEn: '`double`' },
    boltzmann2: { purpose: 'Boltzmann 算子。', purposeEn: 'Boltzmann operator.', syntax: 'boltzmann2(x, y, alpha)', returns: '`double`', returnsEn: '`double`' },
    tnorm_luk: { purpose: 'Łukasiewicz t-范数。', purposeEn: 'Łukasiewicz t-norm.', syntax: 'tnorm_luk(a, b)', returns: '`double`', returnsEn: '`double`' },
    tnorm_prod: { purpose: '乘积 t-范数。', purposeEn: 'Product t-norm.', syntax: 'tnorm_prod(a, b)', returns: '`double`', returnsEn: '`double`' },
    tnorm_godel: { purpose: 'Gödel t-范数。', purposeEn: 'Gödel t-norm.', syntax: 'tnorm_godel(a, b)', returns: '`double`', returnsEn: '`double`' },
    polymer_weight: { purpose: '聚合物权重。', purposeEn: 'Polymer weight.', syntax: 'polymer_weight(x, y, z)', returns: '`double`', returnsEn: '`double`' },
    polymer_mix_bound: { purpose: '聚合物混合界。', purposeEn: 'Polymer mixing bound.', syntax: 'polymer_mix_bound(a, b)', returns: '`double`', returnsEn: '`double`' },
    complex: { purpose: '构造复数。', purposeEn: 'Constructs a complex number.', syntax: 'complex(re, im)', params: '`re`、`im`（double）实部 / 虚部。', paramsEn: '`re`, `im` (double) real / imaginary parts.', returns: '`complex128`', returnsEn: '`complex128`' },
    real: { purpose: '取复数实部。', purposeEn: 'Takes the real part of a complex number.', syntax: 'real(z)', returns: '`double`', returnsEn: '`double`' },
    imag: { purpose: '取复数虚部。', purposeEn: 'Takes the imaginary part.', syntax: 'imag(z)', returns: '`double`', returnsEn: '`double`' },
    cabs: { purpose: '取复数模长 |z|。', purposeEn: 'Takes the modulus |z|.', syntax: 'cabs(z)', returns: '`double`', returnsEn: '`double`' },
    conj: { purpose: '取复数共轭。', purposeEn: 'Takes the complex conjugate.', syntax: 'conj(z)', returns: '`complex128`', returnsEn: '`complex128`' },

    // ── QCOS 系统调用（syscall ABI）──
    qk_sys_call: { purpose: '系统调用（整数）。', purposeEn: 'System call (integer).', syntax: 'qk_sys_call(no, a, b, c)', returns: '`int32`', returnsEn: '`int32`' },
    qk_sys_calld: { purpose: '系统调用（double）。', purposeEn: 'System call (double).', syntax: 'qk_sys_calld(no, ...)', returns: '`double`', returnsEn: '`double`' },
    qk_sys_log: { purpose: '系统日志（字符串）。', purposeEn: 'System log (string).', syntax: 'qk_sys_log(level, msg)', returns: '`void`', returnsEn: '`void`' },
    qk_sys_logi: { purpose: '系统日志（整数）。', purposeEn: 'System log (integer).', syntax: 'qk_sys_logi(level, value)', returns: '`void`', returnsEn: '`void`' },
    qk_sys_callp: { purpose: '指针型系统调用入口。', purposeEn: 'Pointer-based system call entry.', syntax: 'qk_sys_callp(...)' },

    // ── QMS 数值内核 ──
    qk_qms_gap: { purpose: '量子 Markov 半群谱隙。', purposeEn: 'Quantum Markov semigroup spectral gap.', syntax: 'qk_qms_gap(model, p, q)', returns: '`double`', returnsEn: '`double`' },
    qk_mix_bound: { purpose: '混合界。', purposeEn: 'Mixing bound.', syntax: 'qk_mix_bound(gap, n, eps)', returns: '`double`', returnsEn: '`double`' },
    qk_qms_conc: { purpose: '方差收缩时间。', purposeEn: 'Variance contraction time.', syntax: 'qk_qms_conc(gap, eps)', returns: '`double`', returnsEn: '`double`' },

    // ── 系统级内建：原子 / 同步 ──
    sync_load: { purpose: '原子加载（load atomic）。', purposeEn: 'Atomic load.', syntax: 'sync_load(p)', returns: '`int32`', returnsEn: '`int32`' },
    sync_store: { purpose: '原子存储（store atomic）。', purposeEn: 'Atomic store.', syntax: 'sync_store(p, v)' },
    sync_add: { purpose: '原子加（atomicrmw add）。', purposeEn: 'Atomic add (atomicrmw add).', syntax: 'sync_add(p, v)', returns: '`int32`', returnsEn: '`int32`' },
    sync_cas: { purpose: '原子比较交换（cmpxchg）。', purposeEn: 'Atomic compare-and-swap (cmpxchg).', syntax: 'sync_cas(p, old, new)', returns: '`int32`', returnsEn: '`int32`' },
    sync_lock: { purpose: '原子 TAS 获取自旋锁（返回旧值：0 成功 / 1 已持有）。', purposeEn: 'Atomic TAS spinlock acquire (returns old value: 0 success / 1 held).', syntax: 'sync_lock(p)', returns: '`int32`', returnsEn: '`int32`' },
    sync_unlock: { purpose: '原子释放自旋锁。', purposeEn: 'Atomic spinlock release.', syntax: 'sync_unlock(p)' },

    // ── 系统级内建：volatile / 端口 I/O ──
    volatile_load: { purpose: 'volatile 加载（MMIO 轮询不被优化）。', purposeEn: 'Volatile load (MMIO polling not optimized away).', syntax: 'volatile_load(p)' },
    volatile_store: { purpose: 'volatile 存储。', purposeEn: 'Volatile store.', syntax: 'volatile_store(p, v)' },
    outb: { purpose: '8 位端口输出。', purposeEn: '8-bit port output.', syntax: 'outb(port, val)' },
    inb: { purpose: '8 位端口输入。', purposeEn: '8-bit port input.', syntax: 'inb(port)', returns: '`int32`', returnsEn: '`int32`' },
    outw: { purpose: '16 位端口输出。', purposeEn: '16-bit port output.', syntax: 'outw(port, val)' },
    inw: { purpose: '16 位端口输入。', purposeEn: '16-bit port input.', syntax: 'inw(port)', returns: '`int32`', returnsEn: '`int32`' },
    outl: { purpose: '32 位端口输出。', purposeEn: '32-bit port output.', syntax: 'outl(port, val)' },
    inl: { purpose: '32 位端口输入。', purposeEn: '32-bit port input.', syntax: 'inl(port)', returns: '`int32`', returnsEn: '`int32`' },

    // ── 系统级内建：寄存器 / MSR / CPUID ──
    read_cr0: { purpose: '读控制寄存器 CR0。', purposeEn: 'Reads control register CR0.', syntax: 'read_cr0()', returns: '`uint64`', returnsEn: '`uint64`' },
    read_cr2: { purpose: '读控制寄存器 CR2。', purposeEn: 'Reads control register CR2.', syntax: 'read_cr2()', returns: '`uint64`', returnsEn: '`uint64`' },
    read_cr3: { purpose: '读控制寄存器 CR3（页表根）。', purposeEn: 'Reads control register CR3 (page-table root).', syntax: 'read_cr3()', returns: '`uint64`', returnsEn: '`uint64`' },
    read_cr4: { purpose: '读控制寄存器 CR4。', purposeEn: 'Reads control register CR4.', syntax: 'read_cr4()', returns: '`uint64`', returnsEn: '`uint64`' },
    write_cr0: { purpose: '写控制寄存器 CR0。', purposeEn: 'Writes control register CR0.', syntax: 'write_cr0(v)' },
    write_cr3: { purpose: '写控制寄存器 CR3。', purposeEn: 'Writes control register CR3.', syntax: 'write_cr3(v)' },
    invlpg: { purpose: '刷新 TLB 单页。', purposeEn: 'Invalidates a single TLB page.', syntax: 'invlpg(addr)' },
    rdmsr: { purpose: '读模型特定寄存器（EDX:EAX 组合为 uint64）。', purposeEn: 'Reads a model-specific register (EDX:EAX combined into uint64).', syntax: 'rdmsr(msr)', returns: '`uint64`', returnsEn: '`uint64`' },
    wrmsr: { purpose: '写模型特定寄存器。', purposeEn: 'Writes a model-specific register.', syntax: 'wrmsr(msr, v)' },
    cpuid: { purpose: '探测 CPU 特性，写 4 个输出指针。', purposeEn: 'Probes CPU features, writes 4 output pointers.', syntax: 'cpuid(leaf, subleaf, eax, ebx, ecx, edx)' },
    rdtsc: { purpose: '读时间戳计数器 TSC。', purposeEn: 'Reads the timestamp counter TSC.', syntax: 'rdtsc()', returns: '`uint64`', returnsEn: '`uint64`' },
    read_rflags: { purpose: '读 RFLAGS。', purposeEn: 'Reads RFLAGS.', syntax: 'read_rflags()', returns: '`uint64`', returnsEn: '`uint64`' },
    xgetbv: { purpose: '读 XCR（如 XCR0 FPU 状态）。', purposeEn: 'Reads XCR (e.g. XCR0 FPU state).', syntax: 'xgetbv(xcr)', returns: '`uint64`', returnsEn: '`uint64`' },

    // ── 系统级内建：堆分配 / 取地址 ──
    qk_gc_alloc: { purpose: '内核堆分配。', purposeEn: 'Kernel heap allocation.', syntax: 'qk_gc_alloc(n)', params: '`n` 字节数。', paramsEn: '`n` byte count.', returns: '`cap<T>`', returnsEn: '`cap<T>`' },
    qk_gc_free: { purpose: '内核堆释放。', purposeEn: 'Kernel heap free.', syntax: 'qk_gc_free(p)' },
    addr: { purpose: '取函数地址（低 32 位）。', purposeEn: 'Takes a function\'s address (low 32 bits).', syntax: 'addr(&fn)', returns: '`int32`', returnsEn: '`int32`' },

    // ── 其他内建 ──
    strlen: { purpose: '字符串长度。', purposeEn: 'String length.', syntax: 'strlen(s)', returns: '`int32`', returnsEn: '`int32`' },
    kglobals_addr: { purpose: '内核全局状态区地址。', purposeEn: 'Kernel global-state region address.', syntax: 'kglobals_addr()' },

    // ── 量子通道逆因果容量（回程能力）──
    retrocausal_imax: { purpose: '量子通道的 max-information（Choi 矩阵最大特征值的对数）。', purposeEn: 'Max-information of a quantum channel (log of the largest Choi eigenvalue).', syntax: 'retrocausal_imax(kind, p)', params: '`kind`（int32）预置信道类型 0=去极化 1=退相 2=比特翻转 3=振幅阻尼 4=Hadamard 5=Y 翻转；`p`（double）信道参数。', paramsEn: '`kind` (int32) preset channel 0=depolarizing 1=dephasing 2=bit-flip 3=amplitude-damping 4=Hadamard 5=bit-phase-flip; `p` (double) channel parameter.', returns: '`double`', returnsEn: '`double`' },
    retrocausal_idoe: { purpose: '量子通道的 Doeblin information。', purposeEn: 'Doeblin information of a quantum channel.', syntax: 'retrocausal_idoe(kind, p)', returns: '`double`', returnsEn: '`double`' },
    retrocausal_q_capacity: { purpose: '渐近逆因果量子容量 Q_retro = ½(Imax + Idoe^∞)。', purposeEn: 'Asymptotic retrocausal quantum capacity Q_retro = ½(Imax + Idoe^∞).', syntax: 'retrocausal_q_capacity(kind, p)', returns: '`double`', returnsEn: '`double`' },
    retrocausal_c_capacity: { purpose: '渐近逆因果经典容量 C_retro = Imax + Idoe^∞。', purposeEn: 'Asymptotic retrocausal classical capacity C_retro = Imax + Idoe^∞.', syntax: 'retrocausal_c_capacity(kind, p)', returns: '`double`', returnsEn: '`double`' },
    retrocausal_q_one_shot: { purpose: '单次逆因果量子容量（含误差 ε）。', purposeEn: 'One-shot retrocausal quantum capacity (with error ε).', syntax: 'retrocausal_q_one_shot(kind, p, eps)', params: '`eps`（double）误差容限。', paramsEn: '`eps` (double) error tolerance.', returns: '`double`', returnsEn: '`double`' },
    retrocausal_gain: { purpose: '回程增益 Q_retro / Q_forward（时间不对称性）。', purposeEn: 'Retrocausal gain Q_retro / Q_forward (time asymmetry).', syntax: 'retrocausal_gain(kind, p)', returns: '`double`', returnsEn: '`double`' },
    retrocausal_deformed: { purpose: 'q-变形逆因果容量（q ∈ [−1,1] 参数化因果强度）。', purposeEn: 'q-deformed retrocausal capacity (q ∈ [−1,1] parameterizes causal strength).', syntax: 'retrocausal_deformed(kind, p, q)', params: '`q`（double）因果强度 −1=纯前向 +1=纯回程。', paramsEn: '`q` (double) causal strength −1=forward +1=retro.', returns: '`double`', returnsEn: '`double`' },
    retrocausal_ctc_q_capacity: { purpose: '快子 KK 双空间嘈杂 CTC（n 个 DD 维度）逆因果量子容量。', purposeEn: 'Retrocausal quantum capacity over noisy CTCs on n tachyon KK doubled dimensions.', syntax: 'retrocausal_ctc_q_capacity(n, theta, mu2, lambda)', params: '`n`（int32）额外维数；`theta`（double）Wilson line；`mu2`/`lambda`（double）快子势 V=−½μ²φ²+¼λφ⁴。', paramsEn: '`n` (int32) extra-dim count; `theta` (double) Wilson line; `mu2`/`lambda` (double) tachyon potential.', returns: '`double`', returnsEn: '`double`' },
    retrocausal_ctc_c_capacity: { purpose: '快子 KK 双空间嘈杂 CTC（n 个 DD 维度）逆因果经典容量。', purposeEn: 'Retrocausal classical capacity over noisy CTCs on n tachyon KK doubled dimensions.', syntax: 'retrocausal_ctc_c_capacity(n, theta, mu2, lambda)', returns: '`double`', returnsEn: '`double`' },
    retrocausal_ctc_gain: { purpose: '快子 KK 双空间嘈杂 CTC 的回程增益（Q_retro/Q_forward）。', purposeEn: 'Retrocausal gain (Q_retro/Q_forward) over tachyon KK noisy CTCs.', syntax: 'retrocausal_ctc_gain(n, theta, mu2, lambda)', returns: '`double`', returnsEn: '`double`' },
    retrocausal_ctc_dephasing: { purpose: 'Wilson line 破坏 KK ±n 对称导致的退相噪声（几何→噪声映射）。', purposeEn: 'Dephasing noise from Wilson-line KK ±n asymmetry (geometry→noise map).', syntax: 'retrocausal_ctc_dephasing(theta)', returns: '`double`', returnsEn: '`double`' },

    // ── QChain 量子区块链 ──
    qchain_wallet: { purpose: '创建量子区块链钱包。', purposeEn: 'Creates a quantum blockchain wallet.', syntax: 'qchain_wallet(...)' },
    qchain_mint: { purpose: '铸造代币。', purposeEn: 'Mints tokens.', syntax: 'qchain_mint(...)' },
    qchain_transfer: { purpose: '转账。', purposeEn: 'Transfers tokens.', syntax: 'qchain_transfer(...)' },
    qchain_balance: { purpose: '查询余额。', purposeEn: 'Queries balance.', syntax: 'qchain_balance(...)' },
    qchain_mine: { purpose: '挖矿。', purposeEn: 'Mines.', syntax: 'qchain_mine(...)' },
    qchain_height: { purpose: '查询区块高度。', purposeEn: 'Queries block height.', syntax: 'qchain_height()' },
    qchain_verify: { purpose: '验证链。', purposeEn: 'Verifies the chain.', syntax: 'qchain_verify(...)' },
    qchain_qkd: { purpose: '量子密钥分发。', purposeEn: 'Quantum key distribution.', syntax: 'qchain_qkd(...)' },
    qchain_qdba: { purpose: '量子数据库。', purposeEn: 'Quantum database.', syntax: 'qchain_qdba(...)' },
    qchain_coin_mint: { purpose: '铸造币。', purposeEn: 'Mints a coin.', syntax: 'qchain_coin_mint(...)' },
    qchain_coin_verify: { purpose: '验证币。', purposeEn: 'Verifies a coin.', syntax: 'qchain_coin_verify(...)' },
    qchain_sha3: { purpose: 'SHA-3 哈希。', purposeEn: 'SHA-3 hash.', syntax: 'qchain_sha3(...)' },
    qchain_hmac: { purpose: 'HMAC。', purposeEn: 'HMAC.', syntax: 'qchain_hmac(...)' },
    qchain_hash_unicode: { purpose: 'Unicode 哈希。', purposeEn: 'Unicode hash.', syntax: 'qchain_hash_unicode(...)' },
    qchain_sign: { purpose: '签名。', purposeEn: 'Signs.', syntax: 'qchain_sign(...)' },
    qchain_sign_verify: { purpose: '验证签名。', purposeEn: 'Verifies a signature.', syntax: 'qchain_sign_verify(...)' },
    qchain_sign_pubkey: { purpose: '获取签名公钥。', purposeEn: 'Gets the signing public key.', syntax: 'qchain_sign_pubkey(...)' },
    qchain_mlkem_encaps: { purpose: 'ML-KEM 封装。', purposeEn: 'ML-KEM encapsulation.', syntax: 'qchain_mlkem_encaps(...)' },
    qchain_mlkem_decaps: { purpose: 'ML-KEM 解封装。', purposeEn: 'ML-KEM decapsulation.', syntax: 'qchain_mlkem_decaps(...)' },
    qchain_causal_verify: { purpose: '因果验证。', purposeEn: 'Causal verification.', syntax: 'qchain_causal_verify(...)' },
    qchain_cipher_encrypt: { purpose: '加密。', purposeEn: 'Encrypts.', syntax: 'qchain_cipher_encrypt(...)' },
    qchain_cipher_decrypt: { purpose: '解密。', purposeEn: 'Decrypts.', syntax: 'qchain_cipher_decrypt(...)' },
};

/** 注解标签（@[...] 与 @layer(...)） */
export const ANNOTATION_DOCS: Record<string, HoverDoc> = {
    '@layer': {
        purpose: '多维拓扑调度标签（函数入口声明）。',
        purposeEn: 'Multi-dimensional topology scheduling tag (function entry declaration).',
        syntax: '@layer(time=T, thread=W, coord=(x,y,...)[, cost=N][, deadline=D])',
        params: '`time` 锚点时间（根块必填）、`thread` 逻辑线程 id、`coord` N 维坐标；`cost`（默认 1）、`deadline` 时间束缚上限。',
        paramsEn: '`time` anchor time (required for root blocks), `thread` logical thread id, `coord` N-dim coordinates; `cost` (default 1), `deadline` time-bound upper limit.',
        example: '@layer(time=0, thread=0, coord=(0,0))\nint32 main() { return 0; }',
    },
    '@[gate]': { purpose: '标记为可组合量子门单元。', purposeEn: 'Marks a composable quantum gate unit.', syntax: '@[gate]\nvoid U(Qubit q) { ... }' },
    '@[undo]': { purpose: '合成可逆对偶 U†（门序反转 + 逐门取逆）→ `<name>_undo`。', purposeEn: 'Synthesizes the reversible dual U† (reversed gate order + per-gate inverse) → `<name>_undo`.', syntax: '@[gate] @[undo]\nvoid U(Qubit q) { ... }' },
    '@[steer]': { purpose: '合成相干控制版本 Λ(U)（控制位导引目标门）→ `<name>_steer`。', purposeEn: 'Synthesizes the coherent controlled version Λ(U) (control guides the target gate) → `<name>_steer`.', syntax: '@[gate] @[steer]\nvoid U(Qubit q) { ... }' },
    '@[unitary]': { purpose: '酉性验证（无测量、无经典分支依赖）。', purposeEn: 'Unitarity verification (no measurement, no classical branch dependence).', syntax: '@[unitary]\nvoid U(Qubit q) { ... }' },
    '@[measure]': { purpose: '标记测量点（消费 Qubit，纳入 QLT 线性消费）。', purposeEn: 'Marks a measurement point (consumes Qubit, joins QLT linear consumption).', syntax: '@[measure]\nvoid M(Qubit q) { ... }' },
    '@[coherence]': { purpose: '相干时间（T1 弛豫 / T2 退相，单位 μs；须 0 < T2 ≤ T1）。', purposeEn: 'Coherence time (T1 relaxation / T2 dephasing, in μs; requires 0 < T2 ≤ T1).', syntax: '@[coherence(100, 50)]' },
    '@[noise]': { purpose: '噪声模型（`depolarizing`/`amplitude_damping`/`phase_damping`/`bit_flip`）。', purposeEn: 'Noise model (`depolarizing`/`amplitude_damping`/`phase_damping`/`bit_flip`).', syntax: '@[noise("depolarizing")]' },
    '@[basis]': { purpose: '指定测量基（X/Y/Z）。', purposeEn: 'Specifies the measurement basis (X/Y/Z).', syntax: '@[basis("X")]' },
    '@[decoherence_free]': { purpose: '无退相干子空间（DFS）。', purposeEn: 'Decoherence-free subspace (DFS).', syntax: '@[decoherence_free]' },
    '@[error_correction]': { purpose: '纠错码（如 `surface`）。', purposeEn: 'Error-correcting code (e.g. `surface`).', syntax: '@[error_correction("surface")]' },
    '@[inline]': { purpose: '强制内联。', purposeEn: 'Force inline.', detail: 'LLVM 映射：`alwaysinline`。', detailEn: 'LLVM mapping: `alwaysinline`.' },
    '@[noinline]': { purpose: '禁止内联。', purposeEn: 'Disable inline.', detail: 'LLVM 映射：`noinline`。', detailEn: 'LLVM mapping: `noinline`.' },
    '@[pure]': { purpose: '无副作用。', purposeEn: 'No side effects.', detail: 'LLVM 映射：`readnone`。', detailEn: 'LLVM mapping: `readnone`.' },
    '@[readonly]': { purpose: '只读。', purposeEn: 'Read-only.', detail: 'LLVM 映射：`readonly`。', detailEn: 'LLVM mapping: `readonly`.' },
    '@[cold]': { purpose: '冷路径提示。', purposeEn: 'Cold-path hint.', detail: 'LLVM 映射：`cold`。', detailEn: 'LLVM mapping: `cold`.' },
    '@[hot]': { purpose: '热路径提示。', purposeEn: 'Hot-path hint.', detail: 'LLVM 映射：`hot`。', detailEn: 'LLVM mapping: `hot`.' },
    '@[noreturn]': { purpose: '函数不返回。', purposeEn: 'Function does not return.', detail: 'LLVM 映射：`noreturn`。', detailEn: 'LLVM mapping: `noreturn`.' },
    '@[export]': { purpose: '导出符号。', purposeEn: 'Exports symbol.', detail: 'LLVM 映射：`dllexport`。', detailEn: 'LLVM mapping: `dllexport`.' },
    '@[section]': { purpose: '段放置（如 `@[section(".text.boot")]`）。', purposeEn: 'Section placement (e.g. `@[section(".text.boot")]`).', syntax: '@[section(".text.boot")]' },
    '@[naked]': { purpose: '裸函数（无栈帧、无 prologue/epilogue）。', purposeEn: 'Naked function (no stack frame, no prologue/epilogue).', syntax: '@[naked]\nvoid f() { asm { "iretq;" } }' },
};