import { Program, Statement, Expression, MemberExpression, Item, FormDecl, TraitDecl, ImplDecl, ModuleDecl, TemplateDecl, FnDecl } from "./ast";

function isTopLevelItem(node: any): node is Item {
    return ['ModuleDecl', 'UseDecl', 'FormDecl', 'ImplDecl', 'TraitDecl', 'TemplateDecl', 'ImportDecl', 'RequiresDecl'].includes(node.type);
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
    }
    private visitStatement(stmt: Statement) {
        if (stmt.type === 'VariableDeclaration') {
            const exprType = this.visitExpression(stmt.value);

            const inferredType = stmt.varType === 'auto' ? exprType : stmt.varType;

            if (stmt.varType !== 'auto' && stmt.varType !== exprType && exprType !== 'unknown') {
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
            return expr.value % 1 !== 0 ? 'double' : 'int32';
        }

        if (expr.type === 'StringLiteral') return 'string';
        if (expr.type === 'CharLiteral') return 'char';

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
            if (l !== r && l !== 'unknown' && r !== 'unknown') {
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