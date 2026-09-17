"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MirBuilder = void 0;
exports.buildMir = buildMir;
/**
 * 判断节点是否为顶层 Item（模块/类型/契约声明等）。
 * 与 ir.ts / semantic.ts 中的局部实现保持一致——它们都不是从 ast.ts 导出的。
 */
function isTopLevelItem(node) {
    return ['ModuleDecl', 'UseDecl', 'FormDecl', 'FlavorDecl', 'ImplDecl', 'TraitDecl',
        'TemplateDecl', 'ImportDecl', 'RequiresDecl', 'ExternDecl'].includes(node.type);
}
/**
 * 线性类型：受 no-cloning 约束。
 * 这类值不可复制，必须在每条执行路径上恰好被消费一次，
 * 由 borrow.ts 的 linearity pass 检查（量子线性类型 QLT）。
 */
const LINEAR_TYPES = new Set(['Qubit', 'QObject']);
/** 量子门：在语句位置由 parser 识别为普通函数调用，此处还原为 QGate */
const GATE_FNS = new Set([
    'x', 'h', 'rz', 'cnot', 'toffoli', 'swap', 'qft', 'braid',
]);
/** 测量：消费 Qubit */
const MEASURE_FNS = new Set(['measure', 'measure_x', 'measure_y']);
/** 从常量表达式提取整数值（RouteStatement 的 SwitchInt 用） */
function constInt(expr) {
    if (expr.type === 'NumberLiteral')
        return expr.value;
    return 0;
}
class MirBuilder {
    constructor(owner = 'quark_main') {
        this.locals = [];
        this.blocks = [];
        this.currentBlock = 0;
        /** 变量名 -> 局部变量槽（与 QK 现有语义一致：函数内为扁平作用域） */
        this.varEnv = new Map();
        this.loopStack = [];
        this.owner = owner;
        this.blocks.push({ id: 0, statements: [], terminator: null });
    }
    // ---- 基础设施 ----------------------------------------------------------
    newLocal(name, ty, mut, temporary, line, column) {
        const id = this.locals.length;
        this.locals.push({
            id, name, ty, mut,
            linear: LINEAR_TYPES.has(ty),
            temporary, line, column,
        });
        return id;
    }
    newBlock() {
        const id = this.blocks.length;
        this.blocks.push({ id, statements: [], terminator: null });
        return id;
    }
    place(local) {
        return { local, projection: [] };
    }
    push(stmt) {
        this.blocks[this.currentBlock].statements.push(stmt);
    }
    terminate(term) {
        this.blocks[this.currentBlock].terminator = term;
    }
    enterBlock(id) {
        this.currentBlock = id;
    }
    /** 把值落入一个显式临时局部变量（MIR 要求每个中间结果都可见） */
    materialize(rvalue, ty, line, column) {
        const tmp = this.newLocal(null, ty, true, true, line, column);
        this.push({ kind: 'Assign', place: this.place(tmp), rvalue });
        return this.place(tmp);
    }
    operandType(op) {
        if (op.kind === 'Const') {
            switch (op.value.kind) {
                case 'Int': return op.value.ty;
                case 'Float': return op.value.ty;
                case 'Str': return 'string';
                case 'Char': return 'char';
                case 'Bool': return 'bool';
            }
        }
        return this.locals[op.place.local].ty;
    }
    /** 二元运算的结果类型（比较运算为 bool，其余沿用左操作数类型） */
    binaryType(operator, lhs) {
        if (operator === '<' || operator === '>' || operator === '<=' ||
            operator === '>=' || operator === '==' || operator === '!=') {
            return 'bool';
        }
        if (operator === '&&' || operator === '||') {
            return 'bool';
        }
        const t = this.operandType(lhs);
        return t === 'unknown' ? 'int32' : t;
    }
    // ---- 表达式降级 --------------------------------------------------------
    lowerExpression(expr) {
        switch (expr.type) {
            case 'NumberLiteral': {
                const isFloat = expr.isFloat === true;
                return {
                    kind: 'Const',
                    value: { kind: isFloat ? 'Float' : 'Int', value: expr.value, ty: isFloat ? 'double' : 'int32' },
                };
            }
            case 'StringLiteral':
                return { kind: 'Const', value: { kind: 'Str', value: expr.value } };
            case 'CharLiteral':
                return { kind: 'Const', value: { kind: 'Char', value: expr.value } };
            case 'NullLiteral':
                // null 指针 -> 值 0、类型 i8*
                return { kind: 'Const', value: { kind: 'Int', value: 0, ty: 'i8*' } };
            case 'Dereference':
                // 裸指针解引用属于 unsafe 语义；借用检查 v1 不深入追踪指针别名，
                // 降为对指针本身的一次读取（真正的 typed load 在 IR 层完成）。
                return this.lowerExpression(expr.target);
            case 'AddressOf': {
                // &x（局部变量）→ 持久借用：降为 Ref 右值落到临时，供 borrow.ts
                //   追踪 loan 活跃区间（Polonius 子集式）；&fn（函数名）→ 函数
                //   地址常量，不追踪借用。
                if (expr.target.type === 'Identifier') {
                    const id = this.varEnv.get(expr.target.name);
                    if (id !== undefined) {
                        const p = this.materialize({ kind: 'Ref', place: this.place(id), mut: false, ty: 'i8*' }, 'i8*', expr.line, expr.column);
                        return { kind: 'Copy', place: p };
                    }
                }
                return { kind: 'Const', value: { kind: 'Int', value: 0, ty: 'i8*' } };
            }
            case 'FuseExpression': {
                // 融合表达式落到一个临时值；借用检查不深入其分支
                const p = this.materialize({ kind: 'Call', target: 'fuse', args: [], retTy: 'int32' }, 'int32', expr.line, expr.column);
                return { kind: 'Copy', place: p };
            }
            case 'NativeExpression': {
                // 原生指令是 side-effect 语句；MIR 层落到一个 void 临时槽。
                const p = this.materialize({ kind: 'Call', target: 'native', args: [], retTy: 'void' }, 'void', expr.line, expr.column);
                return { kind: 'Copy', place: p };
            }
            case 'Identifier': {
                const id = this.varEnv.get(expr.name);
                if (id === undefined) {
                    throw new Error(`MIR Error: unresolved variable '${expr.name}' (line ${expr.line})`);
                }
                return { kind: 'Copy', place: this.place(id) };
            }
            case 'BinaryExpression': {
                const lhs = this.lowerExpression(expr.left);
                const rhs = this.lowerExpression(expr.right);
                const ty = this.binaryType(expr.operator, lhs);
                const p = this.materialize({ kind: 'Binary', op: expr.operator, lhs, rhs, ty }, ty, expr.line, expr.column);
                return { kind: 'Copy', place: p };
            }
            case 'UnaryExpression': {
                const arg = this.lowerExpression(expr.argument);
                const ty = expr.operator === '!' ? 'bool' : this.operandType(arg);
                const p = this.materialize({ kind: 'Unary', op: expr.operator, arg, ty }, ty, expr.line, expr.column);
                return { kind: 'Copy', place: p };
            }
            /**
             * 短回路求值 —— 这是"为什么必须在 MIR 上做"的典型例子：
             * `a && b` 在 AST 里只是一个嵌套表达式，无法表达"b 可能不被求值"；
             * 降为 MIR 后表现为显式的条件分支，借用检查才能正确判断
             * b 中的借用是否活跃。
             */
            case 'LogicalExpression': {
                const result = this.newLocal(null, 'bool', true, true, expr.line, expr.column);
                const lhs = this.lowerExpression(expr.left);
                const shortCircuitBlock = this.newBlock(); // 需要求值右操作数的块
                const resultBlock = this.newBlock(); // 直接取短路结果的块
                const afterBlock = this.newBlock();
                const isAnd = expr.operator === '&&';
                this.terminate({
                    kind: 'SwitchInt',
                    discriminant: lhs,
                    targets: [
                        { value: 1, target: isAnd ? shortCircuitBlock : resultBlock },
                        { value: null, target: isAnd ? resultBlock : shortCircuitBlock },
                    ],
                });
                // 短路结果：&& 为 false，|| 为 true
                this.enterBlock(resultBlock);
                this.push({
                    kind: 'Assign',
                    place: this.place(result),
                    rvalue: { kind: 'Use', operand: { kind: 'Const', value: { kind: 'Bool', value: !isAnd } } },
                });
                this.terminate({ kind: 'Goto', target: afterBlock });
                // 求值右操作数
                this.enterBlock(shortCircuitBlock);
                const rhs = this.lowerExpression(expr.right);
                this.push({
                    kind: 'Assign',
                    place: this.place(result),
                    rvalue: { kind: 'Use', operand: rhs },
                });
                this.terminate({ kind: 'Goto', target: afterBlock });
                this.enterBlock(afterBlock);
                return { kind: 'Copy', place: this.place(result) };
            }
            case 'FunctionCall':
                return this.lowerCall(expr.name, expr.arguments, expr.line, expr.column);
            case 'NewExpression': {
                const args = expr.arguments.map(a => this.lowerExpression(a));
                const p = this.materialize({ kind: 'NewObject', className: expr.className, args, ty: expr.className }, expr.className, expr.line, expr.column);
                return { kind: 'Copy', place: p };
            }
            case 'MemberExpression': {
                const object = this.lowerExpression(expr.object);
                if (expr.isMethodCall) {
                    // 成员方法调用：降级为以其属性名为目标的调用
                    const args = (expr.arguments ?? []).map(a => this.lowerExpression(a));
                    const p = this.materialize({ kind: 'Call', target: expr.property, args, retTy: 'int32' }, 'int32', expr.line, expr.column);
                    return { kind: 'Copy', place: p };
                }
                const p = this.materialize({ kind: 'Member', object, property: expr.property, ty: 'unknown' }, 'unknown', expr.line, expr.column);
                return { kind: 'Copy', place: p };
            }
            case 'IndexExpression': {
                // 晶格索引读取：降为内置调用（不透明类型 + 运行时访问）
                return this.lowerCall('lattice_ref', [expr.object, ...expr.indices], expr.line, expr.column);
            }
            default:
                throw new Error(`MIR Error: unsupported expression '${expr.type}`);
        }
    }
    /** 把量子门的实参降为可变借用（&mut），表示施加门而非消费 */
    lowerBorrowArg(expr) {
        if (expr.type === 'Identifier') {
            const id = this.varEnv.get(expr.name);
            if (id === undefined) {
                throw new Error(`MIR Error: unresolved variable '${expr.name}' (line ${expr.line})`);
            }
            return { kind: 'Ref', place: this.place(id), mut: true };
        }
        // 非常量标识符的实参（如寄存器下标等）按普通表达式处理
        return this.lowerExpression(expr);
    }
    /** 函数调用：区分量子门 / 测量 / 普通调用 */
    lowerCall(name, args, line, column) {
        if (name === 'alloc') {
            const p = this.materialize({ kind: 'QAlloc', ty: 'Qubit' }, 'Qubit', line, column);
            return { kind: 'Copy', place: p };
        }
        if (GATE_FNS.has(name)) {
            // 门**借用**量子比特，不消费它；因此实参用 Ref 而非 Copy/Move，
            // 否则 QLT 会把"施加门"误判为"消耗量子比特"。
            const lowered = args.map(a => this.lowerBorrowArg(a));
            // 门不产生值；落到一个 void 槽以保持"每个语句只做一件事"
            const p = this.materialize({ kind: 'QGate', gate: name, args: lowered }, 'void', line, column);
            return { kind: 'Copy', place: p };
        }
        if (MEASURE_FNS.has(name)) {
            const lowered = args.map(a => this.lowerExpression(a));
            const p = this.materialize({ kind: 'QMeasure', arg: lowered[0], ty: 'int32' }, 'int32', line, column);
            return { kind: 'Copy', place: p };
        }
        const lowered = args.map(a => this.lowerExpression(a));
        const p = this.materialize({ kind: 'Call', target: name, args: lowered, retTy: 'int32' }, 'int32', line, column);
        return { kind: 'Copy', place: p };
    }
    // ---- 语句降级 ----------------------------------------------------------
    lowerStatement(stmt) {
        switch (stmt.type) {
            case 'VariableDeclaration': {
                // &x（对局部变量的持久借用）：直接生成 `r = Ref x`，让 r 成为 loan
                //   载体，使 loan 活跃区间 = r 的 liveness（而非被立即 Copy 的中间临时）。
                if (stmt.value.type === 'AddressOf' && stmt.value.target.type === 'Identifier') {
                    const borrowed = this.varEnv.get(stmt.value.target.name);
                    if (borrowed !== undefined) {
                        const local = this.newLocal(stmt.identifier, 'i8*', true, false, stmt.line, stmt.column);
                        this.push({
                            kind: 'Assign',
                            place: this.place(local),
                            rvalue: { kind: 'Ref', place: this.place(borrowed), mut: false, ty: 'i8*' },
                        });
                        this.varEnv.set(stmt.identifier, local);
                        break;
                    }
                }
                const operand = this.lowerExpression(stmt.value);
                const ty = stmt.varType === 'auto' ? this.operandType(operand) : stmt.varType;
                const local = this.newLocal(stmt.identifier, ty, true, false, stmt.line, stmt.column);
                this.push({ kind: 'Assign', place: this.place(local), rvalue: { kind: 'Use', operand } });
                this.varEnv.set(stmt.identifier, local);
                break;
            }
            case 'ExpressionStatement': {
                this.lowerExpression(stmt.expression);
                break;
            }
            case 'AssignmentStatement': {
                // 裸指针解引用赋值：*p = v（借用检查 v1 不追踪指针别名）
                if (stmt.target && stmt.target.type === 'Dereference') {
                    this.lowerExpression(stmt.target.target);
                    this.lowerExpression(stmt.value);
                    break;
                }
                // 晶格索引赋值 board[x,y] = v / 字段赋值 obj.field = v：作为副作用降级
                if (stmt.target && (stmt.target.type === 'IndexExpression' || stmt.target.type === 'MemberExpression')) {
                    this.lowerExpression(stmt.target);
                    this.lowerExpression(stmt.value);
                    break;
                }
                const id = this.varEnv.get(stmt.name);
                if (id === undefined) {
                    throw new Error(`MIR Error: assignment to unresolved variable '${stmt.name}' (line ${stmt.line})`);
                }
                const operand = this.lowerExpression(stmt.value);
                this.push({ kind: 'Assign', place: this.place(id), rvalue: { kind: 'Use', operand } });
                break;
            }
            case 'ReturnStatement': {
                const operand = stmt.argument ? this.lowerExpression(stmt.argument) : null;
                this.terminate({ kind: 'Return', value: operand });
                break;
            }
            case 'IfStatement': {
                const cond = this.lowerExpression(stmt.condition);
                const thenB = this.newBlock();
                const elseB = (stmt.alternate && stmt.alternate.length > 0) ? this.newBlock() : null;
                const afterB = this.newBlock();
                this.terminate({
                    kind: 'SwitchInt',
                    discriminant: cond,
                    targets: [
                        { value: 1, target: thenB },
                        { value: null, target: elseB ?? afterB },
                    ],
                });
                this.enterBlock(thenB);
                for (const s of stmt.consequent)
                    this.lowerStatement(s);
                this.terminate({ kind: 'Goto', target: afterB });
                if (elseB) {
                    this.enterBlock(elseB);
                    for (const s of stmt.alternate)
                        this.lowerStatement(s);
                    this.terminate({ kind: 'Goto', target: afterB });
                }
                this.enterBlock(afterB);
                break;
            }
            case 'UnsafeBlock': {
                for (const s of stmt.body)
                    this.lowerStatement(s);
                break;
            }
            case 'RouteStatement': {
                const disc = this.lowerExpression(stmt.discriminant);
                const caseBlocks = stmt.cases.map(() => this.newBlock());
                const fallbackB = stmt.fallback ? this.newBlock() : null;
                const afterB = this.newBlock();
                const targets = stmt.cases.map((c, i) => ({
                    value: constInt(c.value),
                    target: caseBlocks[i],
                }));
                this.terminate({
                    kind: 'SwitchInt',
                    discriminant: disc,
                    targets: [...targets, { value: null, target: fallbackB ?? afterB }],
                });
                stmt.cases.forEach((c, i) => {
                    this.enterBlock(caseBlocks[i]);
                    for (const s of c.body)
                        this.lowerStatement(s);
                    this.terminate({ kind: 'Goto', target: afterB });
                });
                if (fallbackB) {
                    this.enterBlock(fallbackB);
                    for (const s of stmt.fallback)
                        this.lowerStatement(s);
                    this.terminate({ kind: 'Goto', target: afterB });
                }
                this.enterBlock(afterB);
                break;
            }
            case 'SpinStatement': {
                const bodyB = this.newBlock();
                const condB = this.newBlock();
                const afterB = this.newBlock();
                // 先执行体
                this.terminate({ kind: 'Goto', target: bodyB });
                this.loopStack.push({ breakTo: afterB, continueTo: condB });
                this.enterBlock(bodyB);
                for (const s of stmt.body)
                    this.lowerStatement(s);
                this.loopStack.pop();
                this.terminate({ kind: 'Goto', target: condB });
                // 再判断条件
                this.enterBlock(condB);
                const cond = this.lowerExpression(stmt.condition);
                this.terminate({
                    kind: 'SwitchInt',
                    discriminant: cond,
                    targets: [
                        { value: 1, target: bodyB },
                        { value: null, target: afterB },
                    ],
                });
                this.enterBlock(afterB);
                break;
            }
            case 'WhileStatement': {
                const condB = this.newBlock();
                const bodyB = this.newBlock();
                const elseB = (stmt.elseBody && stmt.elseBody.length > 0) ? this.newBlock() : null;
                const afterB = this.newBlock();
                this.terminate({ kind: 'Goto', target: condB });
                this.enterBlock(condB);
                const cond = this.lowerExpression(stmt.condition);
                this.terminate({
                    kind: 'SwitchInt',
                    discriminant: cond,
                    targets: [
                        { value: 1, target: bodyB },
                        { value: null, target: elseB ?? afterB },
                    ],
                });
                this.loopStack.push({ breakTo: afterB, continueTo: condB });
                this.enterBlock(bodyB);
                for (const s of stmt.body)
                    this.lowerStatement(s);
                this.loopStack.pop();
                this.terminate({ kind: 'Goto', target: condB });
                if (elseB) {
                    this.enterBlock(elseB);
                    for (const s of stmt.elseBody)
                        this.lowerStatement(s);
                    this.terminate({ kind: 'Goto', target: afterB });
                }
                this.enterBlock(afterB);
                break;
            }
            case 'ForStatement': {
                if (stmt.init)
                    this.lowerStatement(stmt.init);
                const condB = this.newBlock();
                const bodyB = this.newBlock();
                const updateB = this.newBlock();
                const afterB = this.newBlock();
                this.terminate({ kind: 'Goto', target: condB });
                this.enterBlock(condB);
                if (stmt.condition) {
                    const cond = this.lowerExpression(stmt.condition);
                    this.terminate({
                        kind: 'SwitchInt',
                        discriminant: cond,
                        targets: [
                            { value: 1, target: bodyB },
                            { value: null, target: afterB },
                        ],
                    });
                }
                else {
                    this.terminate({ kind: 'Goto', target: bodyB });
                }
                this.loopStack.push({ breakTo: afterB, continueTo: updateB });
                this.enterBlock(bodyB);
                for (const s of stmt.body)
                    this.lowerStatement(s);
                this.loopStack.pop();
                this.terminate({ kind: 'Goto', target: updateB });
                this.enterBlock(updateB);
                if (stmt.update)
                    this.lowerStatement(stmt.update);
                this.terminate({ kind: 'Goto', target: condB });
                this.enterBlock(afterB);
                break;
            }
            case 'BreakStatement': {
                const top = this.loopStack[this.loopStack.length - 1];
                if (!top) {
                    throw new Error(`MIR Error: 'break' outside of loop (line ${stmt.line})`);
                }
                this.terminate({ kind: 'Goto', target: top.breakTo });
                break;
            }
            case 'ContinueStatement': {
                const top = this.loopStack[this.loopStack.length - 1];
                if (!top) {
                    throw new Error(`MIR Error: 'continue' outside of loop (line ${stmt.line})`);
                }
                this.terminate({ kind: 'Goto', target: top.continueTo });
                break;
            }
            case 'FunctionDeclaration':
                // 顶层函数由 lowerProgram 处理；此处忽略（QK 不支持嵌套函数定义）。
                break;
            default:
                throw new Error(`MIR Error: unsupported statement '${stmt.type}'`);
        }
    }
    // ---- 函数体与程序降级 ---------------------------------------------------
    lowerBody(owner, params, body, returnTy) {
        this.owner = owner;
        this.locals = [];
        this.blocks = [];
        this.varEnv = new Map();
        this.loopStack = [];
        this.currentBlock = 0;
        this.blocks.push({ id: 0, statements: [], terminator: null });
        const paramIds = [];
        for (const p of params) {
            const id = this.newLocal(p.name, p.type, true, false, 0, 0);
            paramIds.push(id);
            this.varEnv.set(p.name, id);
        }
        for (const s of body)
            this.lowerStatement(s);
        // 末块若无终结符，补一个终结符，保证 CFG 良好。
        const last = this.blocks[this.currentBlock];
        if (last.terminator === null) {
            last.terminator = (returnTy && returnTy !== 'void')
                ? { kind: 'Unreachable' }
                : { kind: 'Return', value: null };
        }
        return { owner, locals: this.locals, blocks: this.blocks, params: paramIds, returnTy };
    }
    /** 把一个顶层函数声明降为 MirBody */
    lowerFunction(fn) {
        return this.lowerBody(fn.name, fn.params, fn.body, fn.returnType);
    }
    /** 把整份程序降为 MirProgram */
    build(program) {
        const bodies = [];
        const fnDecls = program.body.filter((n) => n.type === 'FunctionDeclaration');
        if (fnDecls.length > 0) {
            for (const fn of fnDecls) {
                bodies.push(this.lowerFunction(fn));
            }
        }
        else {
            const stmts = program.body.filter((n) => !isTopLevelItem(n));
            bodies.push(this.lowerBody('quark_main', [], stmts, 'int32'));
        }
        return { bodies };
    }
}
exports.MirBuilder = MirBuilder;
/** 便捷入口：AST -> MIR */
function buildMir(program) {
    return new MirBuilder().build(program);
}
//# sourceMappingURL=mir.js.map