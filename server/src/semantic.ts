import { Program, Statement, Expression, MemberExpression, Item, FormDecl, TraitDecl, ImplDecl, ModuleDecl, TemplateDecl, FnDecl } from "./ast";
import { buildMir } from "./mir";
import { BorrowChecker } from "./borrow";
import { detectRaces, detectQuantumRaces, entanglementClosure, Access, Digest } from "./race";

function isTopLevelItem(node: any): node is Item {
    return ['ModuleDecl', 'UseDecl', 'FormDecl', 'FlavorDecl', 'ImplDecl', 'TraitDecl', 'TemplateDecl', 'ImportDecl', 'RequiresDecl'].includes(node.type);
}

// 量子门名（我已将它们从 lexer 关键字移除，但是仍作为门调用使用）
const GATE_NAMES = new Set(['h', 'x', 'rz', 'cnot', 'toffoli', 'swap', 'qft', 'braid', 'measure_x', 'measure_y']);

export interface SemanticError {
    message: string;
    line: number;
    column: number;
    length: number;
}

export class SemanticAnalyzer {
    private symbolMap: Map<string, string> = new Map();
    public errors: SemanticError[] = [];
    private forms: Map<string, FormDecl> = new Map();
    private traits: Map<string, TraitDecl> = new Map();
    private impls: ImplDecl[] = [];
    private modules: Map<string, ModuleDecl> = new Map();
    private templates: TemplateDecl[] = [];
    private parentOf: Map<string, string> = new Map();
    private childOf: Map<string, string> = new Map();
    private loopDepth: number = 0;
    private currentReturnType: string = 'void';
    private measuredQubits: Set<string> = new Set();
    private declaredGateVars: Set<string> = new Set();
    private usedGates: Set<string> = new Set();
    private fixedSymbols: Set<string> = new Set();
    private flavorMembers: Map<string, number> = new Map();

    private resetDeclarations() {
        this.forms.clear();
        this.traits.clear();
        this.impls = [];
        this.modules.clear();
        this.templates = [];
        this.parentOf.clear();
        this.childOf.clear();
    }

    private collectDeclarations(items: (Statement | Item)[], prefix: string) {
        for (const node of items) {
            if (node.type === 'FormDecl') {
                const fullName = prefix ? prefix + '::' + node.name : node.name;
                if (this.forms.has(fullName)) {
                    this.errors.push({ message: `Duplicate form '${fullName}'.`, line: node.line, column: node.column, length: node.name.length });
                }
                this.forms.set(fullName, node);
            } else if (node.type === 'FlavorDecl') {
                node.members.forEach((m, i) => this.flavorMembers.set(m, i));
            } else if (node.type === 'TraitDecl') {
                const fullName = prefix ? prefix + '::' + node.name : node.name;
                if (this.traits.has(fullName)) {
                    this.errors.push({ message: `Duplicate trait '${fullName}'.`, line: node.line, column: node.column, length: node.name.length });
                }
                this.traits.set(fullName, node);
            } else if (node.type === 'ImplDecl') {
                this.impls.push(node);
            } else if (node.type === 'TemplateDecl') {
                this.templates.push(node);
            } else if (node.type === 'ModuleDecl') {
                const fullName = prefix ? prefix + '::' + node.name : node.name;
                this.modules.set(fullName, node);
                this.collectDeclarations(node.body, fullName);
            }
        }
    }

    private checkInheritance() {
        for (const [name, form] of this.forms) {
            if (form.inherits) this.checkSingleInherit(name, form.inherits.base, form.inherits.ranks, 'form', form);
        }
        for (const [name, trait] of this.traits) {
            if (trait.inherits) this.checkSingleInherit(name, trait.inherits.base, trait.inherits.ranks, 'trait', trait);
        }
    }

    private checkSingleInherit(child: string, parent: string, ranks: string[], kind: string, decl: FormDecl | TraitDecl) {
        if (this.parentOf.has(child)) {
            this.errors.push({ message: `Inheritance Error: '${child}' already inherits '${this.parentOf.get(child)}'. Single inheritance only.`, line: decl.line, column: decl.column, length: child.length });
        }

        if (this.childOf.has(parent)) {
            this.errors.push({ message: `Inheritance Error: '${parent}' is already inherited by '${this.childOf.get(parent)}'. Each ${kind} can be inherited only once.`, line: decl.line, column: decl.column, length: parent.length });
        }

        const parentExists = this.forms.has(parent) || this.traits.has(parent);
        if (!parentExists) {
            this.errors.push({ message: `Inheritance Error: undefined parent ${kind} '${parent}'.`, line: decl.line, column: decl.column, length: parent.length });
        }
        this.parentOf.set(child, parent);
        this.childOf.set(parent, child);

        if (ranks.length > 0) {
            const parentDecl = this.forms.get(parent) || this.traits.get(parent);
            if (parentDecl) {
                const parentRanks = new Set(parentDecl.ranks.map(r => r.name));
                for (const r of ranks) {
                    if (!parentRanks.has(r)) {
                        this.errors.push({ message: `Rank Error: parent '${parent}' has no rank '${r}'.`, line: decl.line, column: decl.column, length: r.length });
                    }
                }
            }
        }
    }

    private checkTraitImpls() {
        for (const impl of this.impls) {
            if (!impl.traitName) continue;
            const trait = this.traits.get(impl.traitName);
            if (!trait) {
                this.errors.push({ message: `Impl Error: undefined trait '${impl.traitName}'.`, line: impl.line, column: impl.column, length: impl.traitName.length });
                continue;
            }
            if (!this.forms.has(impl.target)) {
                this.errors.push({ message: `Impl Error: undefined form '${impl.target}'.`, line: impl.line, column: impl.column, length: impl.target.length });
                continue;
            }
            const traitMethods = this.collectTraitMethods(trait);
            const implNames = new Set(impl.methods.map(m => m.name));
            for (const tm of traitMethods) {
                if (!implNames.has(tm.name)) {
                    this.errors.push({ message: `Impl Error: missing implementation of trait method '${tm.name}' for form '${impl.target}'.`, line: impl.line, column: impl.column, length: tm.name.length });
                }
            }
        }
    }

    private collectTraitMethods(trait: TraitDecl): FnDecl[] {
        const methods: FnDecl[] = [];
        for (const rank of trait.ranks) {
            methods.push(...rank.methods);
        }
        return methods;
    }

    private findFieldType(formName: string, fieldName: string): string | null {
        const form = this.forms.get(formName);
        if (!form) return null;
        if (form.inherits && form.inherits.base) {
            const parent = this.findFieldType(form.inherits.base, fieldName);
            if (parent) return parent;
        }
        for (const rank of form.ranks) {
            for (const f of rank.fields) {
                if (f.name === fieldName) return f.type;
            }
        }
        return null;
    }
    public analyze(program: Program) {
        this.symbolMap.clear();
        this.errors = [];
        this.measuredQubits.clear();
        this.declaredGateVars.clear();
        this.usedGates.clear();
        this.resetDeclarations();
        this.collectDeclarations(program.body, '');
        this.checkInheritance();
        this.checkTraitImpls();
        program.body.forEach(stmt => {
            if (isTopLevelItem(stmt)) return;
            this.visitStatement(stmt as Statement);
        });

        // P1：量子线性类型（QLT）+ 借用检查，运行于 MIR 层。
        this.runBorrowCheck(program);

        // 算法 2：Q-Digest 量子感知静态竞争检测。
        this.runRaceDetection(program);
    }

    /**
     * MIR 降级 + 借用检查。
     * 采用 best-effort：若某程序用到了 MIR 尚不支持的构造（如 lambda 表达式），
     * 降级会抛错，此时静默跳过借用检查，绝不让既有合法程序因此回归。
     */
    private runBorrowCheck(program: Program): void {
        let mir;
        try {
            mir = buildMir(program);
        } catch (err: any) {
            console.warn(`[borrow] MIR lowering skipped: ${err?.message ?? err}`);
            return;
        }
        for (const body of mir.bodies) {
            for (const e of new BorrowChecker(body).check()) {
                this.errors.push({
                    message: `[${e.code}] ${e.message}`,
                    line: e.line,
                    column: e.column,
                    length: 1,
                });
            }
        }
    }

    /**
     * 算法 2：Q-Digest —— 量子感知的静态数据竞争检测。
     *
     * 在类型检查之后运行。把 spawn / entangle / sync_* / measure 构造翻译为
     * (access, digest) 记录：digest = 线程 id + 锁集 + 量子比特纠缠闭包。
     * 用 MHP 谓词判定两访问能否并行：能并行且至少一次是写（经典），或破坏性
     * 量子操作触及同一纠缠闭包（量子），则报告潜在竞争。
     *
     * 参考：arXiv:2609.00246《Beyond Locks and Thread IDs: Static Data Race
     * Detection Off The Beaten Path》的 digest 框架；纠缠闭包为本文新增。
     */
    private runRaceDetection(program: Program): void {
        const entry = program.body.find(
            s => s.type === 'FunctionDeclaration' && (s as any).name === 'quark_main'
        ) as any ?? program.body.find(s => s.type === 'FunctionDeclaration') as any;
        if (!entry || !Array.isArray(entry.body)) return;

        interface RawAccess {
            tid: string;
            variable: string;
            isWrite: boolean;
            destructive: string[];
        }
        const classic: RawAccess[] = [];
        const quantum: RawAccess[] = [];
        const entanglePairs: [string, string][] = [];
        const threadQubits: Map<string, Set<string>> = new Map();
        let tidCounter = 0;

        const touchQubit = (tid: string, q: string): void => {
            if (q === 'mem') return;
            if (!threadQubits.has(tid)) threadQubits.set(tid, new Set());
            threadQubits.get(tid)!.add(q);
        };
        const varName = (e: any): string => (e && e.type === 'Identifier' ? e.name : 'mem');

        const GATES = new Set(['h', 'x', 'rz', 'cnot', 'toffoli', 'swap', 'qft', 'braid']);
        const MEASURES = new Set(['measure', 'measure_x', 'measure_y']);
        const SYNC = new Set(['sync_load', 'sync_store', 'sync_add', 'sync_cas']);

        const walkExpr = (expr: any, tid: string): void => {
            if (!expr) return;
            switch (expr.type) {
                case 'FunctionCall': {
                    const name = expr.name;
                    if (SYNC.has(name)) {
                        classic.push({
                            tid,
                            variable: varName(expr.arguments[0]),
                            isWrite: name !== 'sync_load',
                            destructive: [],
                        });
                    }
                    if (MEASURES.has(name)) {
                        const q = varName(expr.arguments[0]);
                        touchQubit(tid, q);
                        quantum.push({ tid, variable: 'qubit:' + q, isWrite: true, destructive: [q] });
                    }
                    if (GATES.has(name)) {
                        for (const a of expr.arguments) touchQubit(tid, varName(a));
                        quantum.push({
                            tid,
                            variable: 'qubit:' + varName(expr.arguments[0]),
                            isWrite: false,
                            destructive: [],
                        });
                    }
                    expr.arguments.forEach((a: any) => walkExpr(a, tid));
                    return;
                }
                case 'BinaryExpression': walkExpr(expr.left, tid); walkExpr(expr.right, tid); return;
                case 'LogicalExpression': walkExpr(expr.left, tid); walkExpr(expr.right, tid); return;
                case 'UnaryExpression': walkExpr(expr.argument, tid); return;
                case 'Dereference': walkExpr(expr.target, tid); return;
                case 'AddressOf': walkExpr(expr.target, tid); return;
                case 'MemberExpression': walkExpr(expr.object, tid); expr.arguments.forEach((a: any) => walkExpr(a, tid)); return;
                case 'NewExpression': expr.arguments.forEach((a: any) => walkExpr(a, tid)); return;
                case 'FuseExpression':
                    walkExpr(expr.discriminant, tid);
                    expr.arms.forEach((arm: any) => { walkExpr(arm.pattern, tid); walkExpr(arm.value, tid); });
                    return;
                case 'FunctionExpression': walkStmts(expr.body, tid); return;
                default: return; // 字面量 / 标识符 / native / result 等叶子
            }
        };

        const walkStmts = (stmts: any[], tid: string): void => {
            for (const s of stmts) {
                if (!s) continue;
                switch (s.type) {
                    case 'SpawnStatement': walkStmts(s.body, 't' + (++tidCounter)); break;
                    case 'EntangleStatement': {
                        const l = varName(s.left), r = varName(s.right);
                        if (l !== 'mem' && r !== 'mem') entanglePairs.push([l, r]);
                        touchQubit(tid, l); touchQubit(tid, r);
                        walkExpr(s.left, tid); walkExpr(s.right, tid);
                        break;
                    }
                    case 'VariableDeclaration': walkExpr(s.value, tid); break;
                    case 'ExpressionStatement': walkExpr(s.expression, tid); break;
                    case 'AssignmentStatement': walkExpr(s.target, tid); walkExpr(s.value, tid); break;
                    case 'ReturnStatement': walkExpr(s.argument, tid); break;
                    case 'IfStatement': walkExpr(s.condition, tid); walkStmts(s.consequent, tid); if (s.alternate) walkStmts(s.alternate, tid); break;
                    case 'WhileStatement': walkExpr(s.condition, tid); walkStmts(s.body, tid); if (s.elseBody) walkStmts(s.elseBody, tid); break;
                    case 'ForStatement': if (s.init) walkStmts([s.init], tid); if (s.condition) walkExpr(s.condition, tid); walkStmts(s.body, tid); if (s.update) walkStmts([s.update], tid); break;
                    case 'RouteStatement': walkExpr(s.discriminant, tid); s.cases.forEach((c: any) => { walkExpr(c.value, tid); walkStmts(c.body, tid); }); if (s.fallback) walkStmts(s.fallback, tid); break;
                    case 'SpinStatement': walkStmts(s.body, tid); walkExpr(s.condition, tid); break;
                    case 'UnsafeBlock': walkStmts(s.body, tid); break;
                    default: break;
                }
            }
        };

        walkStmts(entry.body, 'main');

        // 展开纠缠闭包：每个量子比特的等价类（纠缠传递性）
        const closure = entanglementClosure(entanglePairs);
        const closureOf = (q: string): Set<string> => {
            for (const g of closure.values()) if (g.has(q)) return g;
            return new Set([q]);
        };

        // 每个线程可影响到的量子比特闭包（该线程触及的所有比特 + 纠缠传递）
        const threadClosure: Map<string, Set<string>> = new Map();
        for (const [tid, qs] of threadQubits) {
            const acc = new Set<string>();
            for (const q of qs) closureOf(q).forEach(x => acc.add(x));
            threadClosure.set(tid, acc);
        }

        const makeDigest = (tid: string): Digest => ({
            tid,
            locks: new Set<string>(),
            qubits: threadClosure.get(tid) ?? new Set<string>(),
        });

        const classicAccesses: Access[] = classic.map(a => ({
            variable: a.variable,
            isWrite: a.isWrite,
            digest: makeDigest(a.tid),
            destructiveQubits: new Set<string>(),
        }));
        const quantumAccesses: Access[] = quantum.map(a => ({
            variable: a.variable,
            isWrite: a.isWrite,
            digest: makeDigest(a.tid),
            destructiveQubits: new Set(a.destructive),
        }));

        for (const r of detectRaces(classicAccesses)) {
            this.errors.push({
                message: `Race Warning [Q-Digest]: shared '${r.variable}' accessed by '${r.threadA}' and '${r.threadB}' without a common lock (${r.reason}).`,
                line: 0, column: 0, length: 1,
            });
        }
        for (const r of detectQuantumRaces(quantumAccesses)) {
            this.errors.push({
                message: `Quantum Race [Q-Digest]: ${r.reason} (threads '${r.threadA}' vs '${r.threadB}').`,
                line: 0, column: 0, length: 1,
            });
        }
    }

    private visitStatement(stmt: Statement) {
        if (stmt.type === 'VariableDeclaration') {
            const exprType = this.visitExpression(stmt.value);

            const inferredType = stmt.varType === 'auto' ? exprType : stmt.varType;

            // null 可赋给任意能力类型（cap<T>）
            const nullToCap = exprType === 'null' && stmt.varType.startsWith('cap<');
            // 整型地址可构造能力（int -> cap，MMIO 等）
            const intToCap = ['int8', 'int16', 'int32', 'int64',
                              'uint8', 'uint16', 'uint32', 'uint64'].includes(exprType)
                             && stmt.varType.startsWith('cap<');
            if (stmt.varType !== 'auto' && stmt.varType !== exprType && exprType !== 'unknown' && !nullToCap && !intToCap) {
                this.errors.push({
                    message: `Type Error: Cannot assign expression of type '${exprType}' to variable of type '${stmt.varType}'.`,
                    line: stmt.value.line,
                    column: stmt.value.column,
                    length: stmt.value.length
                });
            }

            if (stmt.value.type === 'Identifier') {
                const sourceVarType = this.symbolMap.get(stmt.value.name);
                if (sourceVarType === 'Qubit') {
                    this.errors.push({
                        message: `Quantum Violation: Cannot copy Qubit '${stmt.value.name}'. Quark statically enforces the No-Cloning Theorem.`,
                        line: stmt.value.line,
                        column: stmt.value.column,
                        length: stmt.value.length
                    });
                }
            }

            this.symbolMap.set(stmt.identifier, inferredType);
            if (stmt.isFixed) {
                this.fixedSymbols.add(stmt.identifier);
            }

            if (GATE_NAMES.has(stmt.identifier)) {
                this.declaredGateVars.add(stmt.identifier);
                if (this.usedGates.has(stmt.identifier)) {
                    this.errors.push({
                        message: `Ambiguity Warning: '${stmt.identifier}' is used both as a quantum gate and as a variable.`,
                        line: stmt.line,
                        column: stmt.column,
                        length: stmt.identifier.length
                    });
                }
            }
        }
        else if (stmt.type === 'ExpressionStatement') {
            this.visitExpression(stmt.expression);
        }
        else if (stmt.type === 'AssignmentStatement') {
            if (stmt.target) {
                // 指针解引用赋值：*p = v（target 是 Dereference，非 MemberExpression）
                if (stmt.target.type === 'Dereference') {
                    this.visitExpression(stmt.target.target);
                    this.visitExpression(stmt.value);
                    return;
                }
                const objType = this.visitExpression((stmt.target as MemberExpression).object);
                this.visitExpression(stmt.value);
                if (objType === 'unknown') {
                    this.errors.push({
                        message: `Reference Error: Undefined object in field assignment.`,
                        line: stmt.line,
                        column: stmt.column,
                        length: 1
                    });
                }
                return;
            }
            const exprType = this.visitExpression(stmt.value);
            // fixed 值不可重新赋值（确定型范式）
            if (this.fixedSymbols.has(stmt.name)) {
                this.errors.push({
                    message: `Type Error: cannot reassign fixed value '${stmt.name}'.`,
                    line: stmt.line,
                    column: stmt.column,
                    length: stmt.name.length
                });
            }
            const targetType = this.symbolMap.get(stmt.name);
            if (!targetType) {
                this.errors.push({
                    message: `Reference Error: Undefined variable '${stmt.name}'.`,
                    line: stmt.line,
                    column: stmt.column,
                    length: stmt.name.length
                });
            } else if (targetType !== exprType && exprType !== 'unknown') {
                this.errors.push({
                    message: `Type Error: Cannot reassign variable '${stmt.name}' of type '${targetType}' to '${exprType}'.`,
                    line: stmt.value.line,
                    column: stmt.value.column,
                    length: stmt.value.length
                });
            }
        }
        else if (stmt.type === 'WhileStatement') {
            const condType = this.visitExpression(stmt.condition);
            if (condType !== 'bool' && condType !== 'int32' && condType !== 'double' && condType !== 'unknown') {
                this.errors.push({
                    message: `Type Error: while condition must be boolean/numeric, got '${condType}'.`,
                    line: stmt.condition.line,
                    column: stmt.condition.column,
                    length: stmt.condition.length
                });
            }
            if (stmt.invariant) {
                for (const inv of stmt.invariant) {
                    const t = this.visitExpression(inv);
                    if (t !== 'bool' && t !== 'int32' && t !== 'unknown') {
                        this.errors.push({
                            message: `Contract Error: 'invariant' condition must be boolean, got '${t}'.`,
                            line: inv.line,
                            column: inv.column,
                            length: inv.length
                        });
                    }
                }
            }
            this.loopDepth++;
            stmt.body.forEach(s => this.visitStatement(s));
            this.loopDepth--;
            if (stmt.elseBody) {
                stmt.elseBody.forEach(s => this.visitStatement(s));
            }
        }
        else if (stmt.type === 'ForStatement') {
            if (stmt.init) this.visitStatement(stmt.init);
            if (stmt.condition) {
                const condType = this.visitExpression(stmt.condition);
                if (condType !== 'bool' && condType !== 'int32' && condType !== 'double' && condType !== 'unknown') {
                    this.errors.push({
                        message: `Type Error: for condition must be boolean/numeric, got '${condType}'.`,
                        line: stmt.condition.line,
                        column: stmt.condition.column,
                        length: stmt.condition.length
                    });
                }
            }
            this.loopDepth++;
            stmt.body.forEach(s => this.visitStatement(s));
            this.loopDepth--;
            if (stmt.update) this.visitStatement(stmt.update);
        }
        else if (stmt.type === 'IfStatement') {
            const condType = this.visitExpression(stmt.condition);
            if (condType !== 'bool' && condType !== 'int32' && condType !== 'double' && condType !== 'unknown') {
                this.errors.push({
                    message: `Type Error: if condition must be boolean/numeric, got '${condType}'.`,
                    line: stmt.condition.line,
                    column: stmt.condition.column,
                    length: stmt.condition.length
                });
            }
            stmt.consequent.forEach(s => this.visitStatement(s));
            if (stmt.alternate) {
                stmt.alternate.forEach(s => this.visitStatement(s));
            }
        }
        else if (stmt.type === 'UnsafeBlock') {
            stmt.body.forEach(s => this.visitStatement(s));
        }
        else if (stmt.type === 'RouteStatement') {
            this.visitExpression(stmt.discriminant);
            stmt.cases.forEach(c => {
                this.visitExpression(c.value);
                c.body.forEach(s => this.visitStatement(s));
            });
            if (stmt.fallback) {
                stmt.fallback.forEach(s => this.visitStatement(s));
            }
        }
        else if (stmt.type === 'SpinStatement') {
            const condType = this.visitExpression(stmt.condition);
            if (condType !== 'bool' && condType !== 'int32' && condType !== 'double' && condType !== 'unknown') {
                this.errors.push({
                    message: `Type Error: spin condition must be boolean/numeric, got '${condType}'.`,
                    line: stmt.condition.line,
                    column: stmt.condition.column,
                    length: stmt.condition.length
                });
            }
            this.loopDepth++;
            stmt.body.forEach(s => this.visitStatement(s));
            this.loopDepth--;
        }
        else if (stmt.type === 'SpawnStatement') {
            // 并发线程闭包：继承外层作用域，逐一检查块体语句
            stmt.body.forEach(s => this.visitStatement(s));
        }
        else if (stmt.type === 'EntangleStatement') {
            // entangle(q1, q2)：两操作数都必须是 Qubit
            for (const operand of [stmt.left, stmt.right]) {
                const t = this.visitExpression(operand);
                if (t !== 'Qubit' && t !== 'unknown') {
                    this.errors.push({
                        message: `Type Error: 'entangle' expects Qubit operands, got '${t}'.`,
                        line: operand.line,
                        column: operand.column,
                        length: operand.length
                    });
                }
            }
        }
        else if (stmt.type === 'BreakStatement') {
            if (this.loopDepth === 0) {
                this.errors.push({
                    message: `Reference Error: 'break' outside of loop.`,
                    line: stmt.line,
                    column: stmt.column,
                    length: stmt.length
                });
            }
        }
        else if (stmt.type === 'ContinueStatement') {
            if (this.loopDepth === 0) {
                this.errors.push({
                    message: `Reference Error: 'continue' outside of loop.`,
                    line: stmt.line,
                    column: stmt.column,
                    length: stmt.length
                });
            }
        }
        else if (stmt.type === 'FunctionDeclaration') {
            this.symbolMap.clear();
            for (const p of stmt.params) {
                this.symbolMap.set(p.name, p.type);
            }
            this.currentReturnType = stmt.returnType;
            // 返回类型必须是"确定类型"（不能是 auto/let/unknown/空）——
            // 新范式：入口与函数返回值都有明确定义的类型，杜绝 unknown。
            if (!stmt.returnType || ['auto', 'let', 'unknown'].includes(stmt.returnType)) {
                this.errors.push({
                    message: `Type Error: function '${stmt.name}' return type must be a definite type, got '${stmt.returnType ?? 'void'}'.`,
                    line: stmt.line,
                    column: stmt.column,
                    length: stmt.name.length
                });
            }
            for (const req of stmt.requires) {
                const t = this.visitExpression(req);
                if (t !== 'bool' && t !== 'int32' && t !== 'unknown') {
                    this.errors.push({
                        message: `Contract Error: 'requires' condition must be boolean, got '${t}'.`,
                        line: req.line,
                        column: req.column,
                        length: req.length
                    });
                }
            }
            for (const ens of stmt.ensures) {
                const t = this.visitExpression(ens);
                if (t !== 'bool' && t !== 'int32' && t !== 'unknown') {
                    this.errors.push({
                        message: `Contract Error: 'ensures' condition must be boolean, got '${t}'.`,
                        line: ens.line,
                        column: ens.column,
                        length: ens.length
                    });
                }
            }
            stmt.body.forEach(s => this.visitStatement(s));
        }
        else if (stmt.type === 'ReturnStatement') {
            this.visitExpression(stmt.argument);
        }
    }

    private checkQubitArgs(expr: any, expectedCount: number): void {
        if (expr.arguments.length !== expectedCount) {
            this.errors.push({
                message: `Signature Error: '${expr.name}' expects ${expectedCount} Qubit argument(s).`,
                line: expr.line, column: expr.column, length: expr.length
            });
            return;
        }
        for (const arg of expr.arguments) {
            const t = this.visitExpression(arg);
            if (t !== 'Qubit' && t !== 'unknown') {
                this.errors.push({
                    message: `Type Error: '${expr.name}' expects Qubit arguments, got '${t}'.`,
                    line: arg.line, column: arg.column, length: arg.length
                });
            }
        }
    }

    private visitExpression(expr: Expression): string {
        if (expr.type === 'ResultExpr') {
            return this.currentReturnType;
        }

        if (expr.type === 'FunctionExpression') {
            const savedSymbols = this.symbolMap;
            const savedReturnType = this.currentReturnType;
            // 扩展符号表：保留外部符号（闭包捕获），参数遮蔽外部同名
            this.symbolMap = new Map(savedSymbols);
            for (const p of expr.params) {
                this.symbolMap.set(p.name, p.type);
            }
            let retType = expr.returnType ?? 'void';
            if (!expr.returnType) {
                for (const s of expr.body) {
                    if (s.type === 'ReturnStatement') {
                        retType = this.visitExpression(s.argument);
                        break;
                    }
                }
            }
            this.currentReturnType = retType;
            expr.body.forEach(s => this.visitStatement(s));
            this.symbolMap = savedSymbols;
            this.currentReturnType = savedReturnType;
            return '(' + expr.params.map(p => p.type).join(',') + ')->' + retType;
        }

        if (expr.type === 'NumberLiteral') {
            return expr.isFloat ? 'double' : 'int32';
        }

        if (expr.type === 'StringLiteral') return 'string';
        if (expr.type === 'CharLiteral') return 'char';
        if (expr.type === 'NullLiteral') return 'null';

        if (expr.type === 'Dereference') {
            const t = this.visitExpression(expr.target);
            if (t.startsWith('cap<')) return t.slice(4, -1);  // 剥掉 cap<...>
            return 'unknown';
        }

        if (expr.type === 'AddressOf') {
            // &x（局部变量）→ cap<T>（元素类型能力指针）；&fn（函数名）→ cap<uint8>
            if (expr.target.type === 'Identifier') {
                const t = this.symbolMap.get(expr.target.name);
                if (t) {
                    return 'cap<' + t + '>';
                }
            }
            return 'cap<uint8>';  // 函数指针：不透明指针能力
        }

        if (expr.type === 'FuseExpression') {
            this.visitExpression(expr.discriminant);
            let resultType = 'unknown';
            for (const arm of expr.arms) {
                if (arm.pattern) this.visitExpression(arm.pattern);
                const t = this.visitExpression(arm.value);
                if (resultType === 'unknown') resultType = t;
                else if (resultType !== t && t !== 'unknown') {
                    this.errors.push({
                        message: `Type Error: fuse arms must have the same type, got '${resultType}' and '${t}'.`,
                        line: expr.line,
                        column: expr.column,
                        length: expr.length
                    });
                }
            }
            return resultType;
        }

        if (expr.type === 'NativeExpression') return 'void';

        if (expr.type === 'Identifier') {
            if (this.measuredQubits.has(expr.name)) {
                this.errors.push({
                    message: `Quantum Violation: Qubit '${expr.name}' used after measurement. Measurement collapses and consumes the qubit.`,
                    line: expr.line,
                    column: expr.column,
                    length: expr.length
                });
                return 'unknown';
            }
            if (this.flavorMembers.has(expr.name)) {
                return 'int32';  // 味成员（新范式 enum 常量）
            }
            if (!this.symbolMap.has(expr.name)) {
                this.errors.push({
                    message: `Reference Error: Undefined variable '${expr.name}'.`,
                    line: expr.line,
                    column: expr.column,
                    length: expr.length
                });
                return 'unknown';
            }
            return this.symbolMap.get(expr.name)!;
        }

        if (expr.type === 'FunctionCall') {
            if (GATE_NAMES.has(expr.name)) {
                this.usedGates.add(expr.name);
                if (this.declaredGateVars.has(expr.name)) {
                    this.errors.push({
                        message: `Ambiguity Warning: '${expr.name}' is used both as a quantum gate and as a variable.`,
                        line: expr.line,
                        column: expr.column,
                        length: expr.length
                    });
                }
            }
            if (expr.name === 'alloc') return 'Qubit';

            // 任意基构建量子态：basis_state(theta, phi, value) -> QObject
            if (expr.name === 'basis_state') {
                if (expr.arguments.length !== 3) {
                    this.errors.push({
                        message: `Signature Error: 'basis_state' expects 3 arguments (theta: double, phi: double, value: int32).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                } else {
                    expr.arguments.forEach(a => this.visitExpression(a));
                }
                return 'QObject';
            }

            if (expr.name === 'h' || expr.name === 'x') {
                this.checkQubitArgs(expr, 1);
                return 'void';
            }
            if (expr.name === 'rz') {
                this.checkQubitArgs(expr, 1);
                if (expr.arguments.length >= 2) this.visitExpression(expr.arguments[1]);
                return 'void';
            }
            if (expr.name === 'cnot' || expr.name === 'swap' || expr.name === 'braid') {
                this.checkQubitArgs(expr, 2);
                return 'void';
            }
            if (expr.name === 'toffoli') {
                this.checkQubitArgs(expr, 3);
                return 'void';
            }
            if (expr.name === 'qft') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: 'qft' expects 1 argument (num_qubits: int).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                } else {
                    this.visitExpression(expr.arguments[0]);
                }
                return 'void';
            }
            if (expr.name === 'measure_x' || expr.name === 'measure_y') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: '${expr.name}' expects exactly 1 Qubit argument.`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                    return 'int32';
                }
                const argType = this.visitExpression(expr.arguments[0]);
                if (argType !== 'Qubit' && argType !== 'unknown') {
                    this.errors.push({
                        message: `Type Error: '${expr.name}' expects a Qubit, but received '${argType}'.`,
                        line: expr.arguments[0].line,
                        column: expr.arguments[0].column,
                        length: expr.arguments[0].length
                    });
                }
                if (expr.arguments[0].type === 'Identifier') {
                    const qname = (expr.arguments[0] as any).name;
                    this.symbolMap.delete(qname);
                    this.measuredQubits.add(qname);
                }
                return 'int32';
            }

            if (expr.name === 'measure') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: 'measure' expects exactly 1 argument.`,
                        line: expr.line,
                        column: expr.column,
                        length: expr.length
                    });
                    return 'int32';
                }

                const argType = this.visitExpression(expr.arguments[0]);
                if (argType !== 'Qubit' && argType !== 'unknown') {
                    this.errors.push({
                        message: `Type Error: 'measure' expects a Qubit, but received '${argType}'.`,
                        line: expr.arguments[0].line,
                        column: expr.arguments[0].column,
                        length: expr.arguments[0].length
                    });
                }

                if (expr.arguments[0].type === 'Identifier') {
                    const qname = (expr.arguments[0] as any).name;
                    this.symbolMap.delete(qname);
                    this.measuredQubits.add(qname);
                }

                return 'int32';
            }

            if (expr.name === 'encode_text') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: 'encode_text' expects 1 string argument.`,
                        line: expr.line,
                        column: expr.column,
                        length: expr.length
                    });
                    return 'QObject';
                }
                const argType = this.visitExpression(expr.arguments[0]);
                if (argType !== 'string' && argType !== 'unknown') {
                    this.errors.push({
                        message: `Type Error: 'encode_text' expects string, got '${argType}'.`,
                        line: expr.arguments[0].line,
                        column: expr.arguments[0].column,
                        length: expr.arguments[0].length
                    });
                }
                return 'QObject';
            }

            if (expr.name === 'qlm_invoke') {
                if (expr.arguments.length !== 3) {
                    this.errors.push({
                        message: `Signature Error: 'qlm_invoke' expects 3 arguments (data: QObject, epochs: int, lr: double).`,
                        line: expr.line,
                        column: expr.column,
                        length: expr.length
                    });
                    return 'QModel';
                }
                const arg0Type = this.visitExpression(expr.arguments[0]);
                if (arg0Type !== 'QObject' && arg0Type !== 'unknown') {
                    this.errors.push({
                        message: `Type Error: First argument of 'qlm_invoke' must be QObject, got '${arg0Type}'.`,
                        line: expr.arguments[0].line,
                        column: expr.arguments[0].column,
                        length: expr.arguments[0].length
                    });
                }
                return 'QModel';
            }

            if (expr.name === 'qlm_load') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: 'qlm_load' expects 1 argument (path: string).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                }
                return 'QModel';
            }

            if (expr.name === 'qk_encode_string') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: 'qk_encode_string' expects 1 argument (prompt: string).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                }
                return 'QObject';
            }

            if (expr.name === 'qlm_forward') {
                if (expr.arguments.length !== 2) {
                    this.errors.push({
                        message: `Signature Error: 'qlm_forward' expects 2 arguments (model: QModel, data: QObject).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                }
                return 'void';
            }

            if (expr.name === 'qk_decode_string') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: 'qk_decode_string' expects 1 argument (data: QObject).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                }
                return 'string';
            }

            if (expr.name === 'mind_read') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: 'mind_read' expects 1 argument (modality: string).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                } else {
                    const argType = this.visitExpression(expr.arguments[0]);
                    if (argType !== 'string' && argType !== 'unknown') {
                        this.errors.push({
                            message: `Type Error: 'mind_read' expects a string modality, got '${argType}'.`,
                            line: expr.arguments[0].line,
                            column: expr.arguments[0].column,
                            length: expr.arguments[0].length
                        });
                    }
                }
                return 'QObject';
            }

            if (expr.name === 'mind_train') {
                if (expr.arguments.length !== 3) {
                    this.errors.push({
                        message: `Signature Error: 'mind_train' expects 3 arguments (state: QObject, epochs: int, lr: double).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                } else {
                    const arg0Type = this.visitExpression(expr.arguments[0]);
                    if (arg0Type !== 'QObject' && arg0Type !== 'unknown') {
                        this.errors.push({
                            message: `Type Error: First argument of 'mind_train' must be QObject, got '${arg0Type}'.`,
                            line: expr.arguments[0].line,
                            column: expr.arguments[0].column,
                            length: expr.arguments[0].length
                        });
                    }
                }
                return 'void';
            }

            if (expr.name === 'mind_feedback') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: 'mind_feedback' expects 1 argument (state: QObject).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                } else {
                    const argType = this.visitExpression(expr.arguments[0]);
                    if (argType !== 'QObject' && argType !== 'unknown') {
                        this.errors.push({
                            message: `Type Error: 'mind_feedback' expects a QObject, got '${argType}'.`,
                            line: expr.arguments[0].line,
                            column: expr.arguments[0].column,
                            length: expr.arguments[0].length
                        });
                    }
                }
                return 'void';
            }

            if (expr.name === 'veda_qlm_train') {
                if (expr.arguments.length !== 3) {
                    this.errors.push({
                        message: `Signature Error: 'veda_qlm_train' expects 3 arguments (state: QObject, epochs: int, lr: double).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                } else {
                    const arg0Type = this.visitExpression(expr.arguments[0]);
                    if (arg0Type !== 'QObject' && arg0Type !== 'unknown') {
                        this.errors.push({
                            message: `Type Error: First argument of 'veda_qlm_train' must be QObject, got '${arg0Type}'.`,
                            line: expr.arguments[0].line,
                            column: expr.arguments[0].column,
                            length: expr.arguments[0].length
                        });
                    }
                }
                return 'void';
            }

            // QCOS syscall ABI（通用 syscall 入口 + 控制台）
            if (expr.name === 'qk_sys_call') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'int32';
            }
            if (expr.name === 'qk_sys_calld') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'double';
            }
            if (expr.name === 'qk_sys_log') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'void';
            }
            if (expr.name === 'qk_sys_logi') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'int32';
            }
            if (expr.name === 'qk_sys_callp') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'cap<uint8>';   // 指针型 syscall：返回指针能力
            }
            if (expr.name === 'qk_gc_free') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'void';
            }

            // 同步内存事件（系统级：自旋锁 / 计数器；语义源自弱内存模型）
            if (expr.name === 'sync_load' || expr.name === 'sync_add' || expr.name === 'sync_cas') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'int32';
            }
            if (expr.name === 'sync_store') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'void';
            }
            // 端口 I/O（原生效应：x86 outb/inb）
            if (expr.name === 'outb') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'void';
            }
            if (expr.name === 'inb') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'int32';
            }
            // 类型化堆分配：返回 cap<int32>（以 int32 字为单位的能力）
            if (expr.name === 'qk_gc_alloc') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'cap<int32>';
            }
            // 能力 -> 整型地址（ptrtoint，返回低 32 位）
            if (expr.name === 'addr') {
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'int32';
            }

            // QMS 数值内核（谱隙 / 混合界 / 方差收缩时间）
            const qmsFns: Record<string, { argc: number; args: string[] }> = {
                qk_qms_gap:   { argc: 3, args: ['int32', 'double', 'double'] },
                qk_mix_bound: { argc: 3, args: ['double', 'double', 'double'] },
                qk_qms_conc:  { argc: 2, args: ['double', 'double'] },
            };
            const qf = qmsFns[expr.name];
            if (qf) {
                if (expr.arguments.length !== qf.argc) {
                    this.errors.push({
                        message: `Signature Error: '${expr.name}' expects ${qf.argc} argument(s).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                }
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'double';
            }

            const scalarMathFns: Record<string, { argc: number; args: string[] }> = {
                surrogate:    { argc: 3, args: ['double', 'double', 'double'] },
                tanh_quantize:{ argc: 3, args: ['double', 'double', 'int32'] },
                lif_step:     { argc: 4, args: ['double', 'double', 'double', 'double'] },
                mellowmax2:   { argc: 3, args: ['double', 'double', 'double'] },
                logsumexp2:   { argc: 3, args: ['double', 'double', 'double'] },
                boltzmann2:   { argc: 3, args: ['double', 'double', 'double'] },
                tnorm_luk:    { argc: 2, args: ['double', 'double'] },
                tnorm_prod:   { argc: 2, args: ['double', 'double'] },
                tnorm_godel:  { argc: 2, args: ['double', 'double'] },
                polymer_weight: { argc: 3, args: ['double', 'double', 'double'] },
                polymer_mix_bound: { argc: 2, args: ['double', 'double'] },
            };
            const sf = scalarMathFns[expr.name];
            if (sf) {
                if (expr.arguments.length !== sf.argc) {
                    this.errors.push({
                        message: `Signature Error: '${expr.name}' expects ${sf.argc} argument(s).`,
                        line: expr.line, column: expr.column, length: expr.length
                    });
                }
                expr.arguments.forEach(a => this.visitExpression(a));
                return 'double';
            }

            // 函数变量调用（lambda / 高阶函数）
            const fnType = this.symbolMap.get(expr.name);
            if (fnType && fnType.startsWith('(') && fnType.includes(')->')) {
                const arrowIdx = fnType.indexOf(')->');
                const retType = fnType.slice(arrowIdx + 3);
                expr.arguments.forEach(a => this.visitExpression(a));
                return retType;
            }
        }

        if (expr.type === 'MemberExpression') {
            const objType = this.visitExpression(expr.object);

            if (objType === 'QModel' && expr.property === 'export') {
                if (expr.arguments.length !== 1) {
                    this.errors.push({
                        message: `Signature Error: QModel.export expects 1 string argument (export path).`,
                        line: expr.line,
                        column: expr.column,
                        length: expr.length
                    });
                } else {
                    const pathType = this.visitExpression(expr.arguments[0]);
                    if (pathType !== 'string' && pathType !== 'unknown') {
                        this.errors.push({
                            message: `Type Error: Export path must be string, got '${pathType}'.`,
                            line: expr.arguments[0].line,
                            column: expr.arguments[0].column,
                            length: expr.arguments[0].length
                        });
                    }
                }
                return 'void';
            }

            if (objType === 'QObject' && expr.property === 'measure') return 'int32';

            // QCOS: form 字段读取（含继承字段）
            if (!expr.isMethodCall) {
                const ft = this.findFieldType(objType, expr.property);
                if (ft) return ft;
            }
        }

        if (expr.type === 'BinaryExpression') {
            const l = this.visitExpression(expr.left);
            const r = this.visitExpression(expr.right);
            if (expr.operator === '<' || expr.operator === '==' ||
                expr.operator === '>' || expr.operator === '<=' ||
                expr.operator === '>=' || expr.operator === '!=') return 'bool';
            // 指针算术：cap<T> + int -> cap<T>（允许类型不一致）
            const ptrArith = expr.operator === '+' && l.startsWith('cap<');
            if (l !== r && l !== 'unknown' && r !== 'unknown' && !ptrArith) {
                this.errors.push({
                    message: `Type Error: binary operator '${expr.operator}' on mismatched types '${l}' and '${r}'.`,
                    line: expr.line,
                    column: expr.column,
                    length: expr.length
                });
            }
            return l === 'unknown' ? r : l;
        }

        if (expr.type === 'LogicalExpression') {
            const l = this.visitExpression(expr.left);
            const r = this.visitExpression(expr.right);
            if (l !== 'bool' && l !== 'int32' && l !== 'unknown') {
                this.errors.push({
                    message: `Type Error: logical operator '${expr.operator}' requires boolean operands, got '${l}'.`,
                    line: expr.left.line,
                    column: expr.left.column,
                    length: expr.left.length
                });
            }
            if (r !== 'bool' && r !== 'int32' && r !== 'unknown') {
                this.errors.push({
                    message: `Type Error: logical operator '${expr.operator}' requires boolean operands, got '${r}'.`,
                    line: expr.right.line,
                    column: expr.right.column,
                    length: expr.right.length
                });
            }
            return 'bool';
        }

        if (expr.type === 'UnaryExpression') {
            const t = this.visitExpression(expr.argument);
            if (expr.operator === '!') {
                if (t !== 'bool' && t !== 'int32' && t !== 'unknown') {
                    this.errors.push({
                        message: `Type Error: unary '!' requires a boolean operand, got '${t}'.`,
                        line: expr.argument.line,
                        column: expr.argument.column,
                        length: expr.argument.length
                    });
                }
                return 'bool';
            }
            return t;
        }

        if (expr.type === 'NewExpression') {
            if (expr.className === 'BellState' || expr.className === 'DiracState' || expr.className === 'QuantumRegister') {
                return 'QObject';
            }
            const base = expr.className.split('<')[0];
            if (this.forms.has(base)) {
                return base;
            }
            this.errors.push({
                message: `Type Error: Unknown form '${expr.className}'.`,
                line: expr.line,
                column: expr.column,
                length: expr.length
            });
            return 'unknown';
        }
        return 'unknown';
    }
}