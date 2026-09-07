export interface ASTNode {
    type: string;
    line: number;
    column: number;
    length: number;
}

export interface Program extends ASTNode {
    type: 'Program';
    body: (Statement | Item)[];
}

export type Statement = 
    |VariableDeclaration 
    | ExpressionStatement 
    | WhileStatement 
    | ForStatement
    | IfStatement
    | RouteStatement
    | SpinStatement
    | UnsafeBlock
    | BreakStatement
    | ContinueStatement
    | AssignmentStatement
    | FunctionDeclaration 
    | SpawnStatement
    | EntangleStatement
    | ReturnStatement;

/**
 * 条件分支。
 *
 * 注意：`else if` **不**单独设节点，而是把 `else` 分支表示为「只含一个
 * IfStatement 的语句数组」。这样 IR/MIR  lowering 只需处理一种分支结构，
 * 无需为链式 else-if 特判。
 */
export interface IfStatement extends ASTNode {
    type: 'IfStatement';
    condition: Expression;
    /** then 分支 */
    consequent: Statement[];
    /** else 分支；`else if` 时该数组只含一个 IfStatement；无 else 时为 null */
    alternate: Statement[] | null;
}

/**
 * unsafe 块：允许裸指针解引用、内联汇编、MMIO 等"系统级"操作。
 * 是系统级编程（写内核）的显式危险边界；capability 校验在语义层完成。
 */
export interface UnsafeBlock extends ASTNode {
    type: 'UnsafeBlock';
    body: Statement[];
}

/**
 * 路由分支（新范式 switch）：把一个判别值"路由"到若干路径之一。
 * 命名源自拓扑量子编译的 qubit routing。
 */
export interface RouteCase {
    /** 路径值（常量表达式，如数字/字符/布尔） */
    value: Expression;
    body: Statement[];
}

export interface RouteStatement extends ASTNode {
    type: 'RouteStatement';
    /** 被路由的判别表达式 */
    discriminant: Expression;
    /** 各 case 分支 */
    cases: RouteCase[];
    /** default 分支（fallback）；无则为 null */
    fallback: Statement[] | null;
}

/**
 * 自旋循环（新范式 do-while）：先执行循环体，再判断条件；至少执行一次。
 * 命名源自量子态的自旋演化。
 */
export interface SpinStatement extends ASTNode {
    type: 'SpinStatement';
    body: Statement[];
    condition: Expression;
}

export interface VariableDeclaration extends ASTNode {
    type: 'VariableDeclaration';
    varType: string;
    identifier: string;
    value: Expression;
    /** fixed：编译期常量，不可重新赋值（确定型范式） */
    isFixed?: boolean;
}

export interface ExpressionStatement extends ASTNode {
    type: 'ExpressionStatement';
    expression: Expression;
}

export interface BinaryExpression  extends ASTNode {
    type: 'BinaryExpression';
    operator: string;
    left: Expression;
    right: Expression;
}

export interface LogicalExpression extends ASTNode {
    type: 'LogicalExpression';
    operator: '&&' | '||';
    left: Expression;
    right: Expression;
}

export interface UnaryExpression extends ASTNode {
    type: 'UnaryExpression';
    operator: '!' | '-';
    argument: Expression;
}

export interface ResultExpr extends ASTNode {
    type: 'ResultExpr';
}

export interface FunctionExpression extends ASTNode {
    type: 'FunctionExpression';
    params: Param[];
    returnType: string | null;
    body: Statement[];
}

export interface WhileStatement extends ASTNode {
    type: 'WhileStatement';
    condition: Expression;
    body: Statement[];
    elseBody?: Statement[];
    invariant?: Expression[];
}

export interface ForStatement extends ASTNode {
    type: 'ForStatement';
    init: Statement | null;
    condition: Expression | null;
    update: Statement | null;
    body: Statement[];
    invariant?: Expression[];
}

export interface BreakStatement extends ASTNode {
    type: 'BreakStatement';
}

export interface ContinueStatement extends ASTNode {
    type: 'ContinueStatement';
}

export interface AssignmentStatement extends ASTNode {
    type: 'AssignmentStatement';
    name: string;
    target?: Expression;
    value: Expression;
}

// ============================================================================
// 表达式
// ============================================================================
export type Expression =
    | NumberLiteral 
    | StringLiteral
    | CharLiteral
    | NullLiteral
    | Dereference
    | AddressOf
    | NativeExpression
    | FuseExpression
    | Identifier 
    | FunctionCall
    | NewExpression
    | MemberExpression
    | BinaryExpression
    | LogicalExpression
    | UnaryExpression
    | ResultExpr
    | FunctionExpression

export interface NumberLiteral extends ASTNode {
    type: 'NumberLiteral';
    value: number;
    /** 字面量源码中是否带小数点/指数（如 0.0、1e3），决定其应为 double 而非 int32 */
    isFloat?: boolean;
}

export interface CharLiteral extends ASTNode {
    type: 'CharLiteral';
    value: string;
}

export interface StringLiteral extends ASTNode {
    type: 'StringLiteral';
    value: string;
}

/** null 指针字面量 */
export interface NullLiteral extends ASTNode {
    type: 'NullLiteral';
}

/** 指针解引用：*p */
export interface Dereference extends ASTNode {
    type: 'Dereference';
    target: Expression;
}

/** 取地址：&fn（函数指针，供中断处理函数 / 调度任务入口用） */
export interface AddressOf extends ASTNode {
    type: 'AddressOf';
    target: Expression;
}

/**
 * 原生指令：native("...")——逃逸到目标机器的原生指令集（代数效应视角下的
 * "原生效应"）。定位为**无操作数的纯 sideeffect 指令**（如 cli/sti/hlt）；
 * 带操作数的底层硬件操作由专门内置函数覆盖（outb/inb 端口 I/O、sync_* 原子、
 * qk_sys_* 系统调用），无需在 native 里手写约束字符串。
 * 必须在 unsafe 块内（持有能力授予）方可使用。
 */
export interface NativeExpression extends ASTNode {
    type: 'NativeExpression';
    template: string;
}

/**
 * 融合-模式匹配表达式：把判别值"融合"到若干模式之一并求值。
 * 命名源自 Hopf 代数的余乘（comultiplication）——把一个值解构为分支。
 */
export interface FuseArm {
    /** 模式：常量表达式；null 表示通配符 _ */
    pattern: Expression | null;
    value: Expression;
}

export interface FuseExpression extends ASTNode {
    type: 'FuseExpression';
    discriminant: Expression;
    arms: FuseArm[];
}

export interface Identifier extends ASTNode {
    type: 'Identifier';
    name: string;
}

export interface FunctionCall extends ASTNode {
    type: 'FunctionCall';
    name: string;             // 简单名，或完整路径 'a::b::fn'
    arguments: Expression[];
}

export interface NewExpression extends ASTNode {
    type: 'NewExpression';
    className: string;
    arguments: Expression[];
    heapAlloc?: boolean;
}

export interface MemberExpression extends ASTNode {
    type: 'MemberExpression';
    object: Expression;
    property: string;
    isMethodCall: boolean;
    arguments: Expression[];
}

export type Item =
    | ModuleDecl
    | UseDecl
    | FormDecl
    | FlavorDecl
    | ImplDecl
    | TraitDecl
    | TemplateDecl
    | ImportDecl
    | RequiresDecl;

export interface Param {
    name: string;
    type: string;
}

export interface FieldDecl {
    name: string;
    type: string;
    isPub: boolean;
}


export interface FnDecl {
    name: string;
    receiver: string | null;
    params: Param[];
    returnType: string;
    isPub: boolean;
    body: Statement[] | null;
    line: number;
    column: number;
    length: number;
}

export interface RankBlock {
    name: string;
    fields: FieldDecl[];
    methods: FnDecl[];
}

export interface InheritClause {
    base: string;
    ranks: string[];
}

export interface ModuleDecl extends ASTNode {
    type: 'ModuleDecl';
    name: string;
    body: Item[];
}

export interface UseDecl extends ASTNode {
    type: 'UseDecl';
    path: string[];
}

export interface FormDecl extends ASTNode {
    type: 'FormDecl';
    name: string;
    isPub: boolean;
    isExport: boolean;
    inherits: InheritClause | null;
    ranks: RankBlock[];
}

/**
 * 味：一组具名常量，成员自动按声明顺序赋整数值 0,1,2,...
 * 命名源自量子味（flavor）概念。
 */
export interface FlavorDecl extends ASTNode {
    type: 'FlavorDecl';
    name: string;
    members: string[];
    isPub: boolean;
}

export interface ImplDecl extends ASTNode {
    type: 'ImplDecl';
    target: string;
    traitName: string | null;
    rank: string | null;
    methods: FnDecl[];
}

export interface TraitDecl extends ASTNode {
    type: 'TraitDecl';
    name: string;
    isPub: boolean;
    inherits: InheritClause | null;
    ranks: RankBlock[];
}

export interface TemplateDecl extends ASTNode {
    type: 'TemplateDecl';
    params: string[];
    inner: FormDecl | ImplDecl;
}

export interface ImportDecl extends ASTNode {
    type: 'ImportDecl';
    alias: string;
    path: string;
}

export interface RequiresDecl extends ASTNode {
    type: 'RequiresDecl';
    permission: string;
}

export interface FunctionDeclaration extends ASTNode {
    type: 'FunctionDeclaration';
    returnType: string;
    name: string;
    params: Param[];
    receiver: string | null;
    isPub: boolean;
    isExport: boolean;
    requires: Expression[];
    ensures: Expression[];
    body: Statement[];
    /** 函数属性（系统级）：如 @[section(".text.boot")]、@[naked] */
    attributes?: FunctionAttribute[];
}

/** 函数属性：@[name] 或 @[name("value")] */
export interface FunctionAttribute {
    name: string;
    value: string | null;
}

export interface ReturnStatement extends ASTNode {
    type: 'ReturnStatement';
    argument: Expression;
}

/**
 * 并发线程（Q-Digest）：spawn { ... } 派生一个并发执行单元。
 * 块体闭包继承外层作用域（共享 cap 指针 / 量子比特），是竞争检测的"线程"。
 * 命名源自量子并行（quantum parallelism）与调度中的任务派生。
 */
export interface SpawnStatement extends ASTNode {
    type: 'SpawnStatement';
    body: Statement[];
}

/**
 * 量子纠缠声明（Q-Digest）：entangle(q1, q2) 声明两比特纠缠。
 * 纠缠具有传递性（q1~q2~q3 => q1~q3），竞争检测据此构建纠缠闭包，
 * 判定跨线程的破坏性操作（测量/释放）是否触及同一闭包。
 */
export interface EntangleStatement extends ASTNode {
    type: 'EntangleStatement';
    left: Expression;
    right: Expression;
}