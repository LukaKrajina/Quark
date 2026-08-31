import { Program, FunctionDeclaration, Statement, Expression } from './ast';

// ============================================================================
// S-表达式：验证条件的中间表示（跨语言协议的中性形式）
// 与 C++ 判定器（runtime/include/verify/Verifier.hpp）通过行协议对接。
// ============================================================================
export type SExpr =
    | { kind: 'var'; name: string }
    | { kind: 'const'; type: string; value: string }
    | { kind: 'app'; op: string; args: SExpr[] };

export interface Obligation {
    id: string;
    antecedent: SExpr;
    consequent: SExpr;
}

const TRUE: SExpr = { kind: 'const', type: 'bool', value: 'true' };

// ============================================================================
// VCGen：最弱前置条件（WP）演算把函数体 + 契约翻译为证明义务。
//
//   wp(x := e, Q)             = Q[e/x]
//   wp(return e, Q)           = Q[result/e]
//   wp(while b inv I {S}, Q)  = I ，并产生两条额外义务：
//       (1) I && !b  =>  Q        （退出时后置条件成立）
//       (2) I &&  b  =>  wp(S, I) （循环体保持不变量）
//   wp(S1; S2, Q)             = wp(S1, wp(S2, Q))
// ============================================================================
export class VCGenerator {
    private obligations: Obligation[] = [];
    private obligationCounter: number = 0;

    public generate(ast: Program): Obligation[] {
        this.obligations = [];
        this.obligationCounter = 0;
        for (const node of ast.body) {
            if (node.type === 'FunctionDeclaration') {
                if (node.requires.length > 0 || node.ensures.length > 0) {
                    this.verifyFunction(node);
                }
            }
        }
        return this.obligations;
    }

    private verifyFunction(fn: FunctionDeclaration): void {
        const P = this.conjoin(fn.requires);
        const Q = this.conjoin(fn.ensures);
        const result = this.wpBlock(fn.body, Q);

        this.obligations.push({
            id: fn.name + '::implies',
            antecedent: P,
            consequent: result.formula
        });

        for (const o of result.obligations) {
            this.obligations.push(o);
        }
    }

    // 合取多个契约表达式（空则为 true）
    private conjoin(exprs: Expression[]): SExpr {
        if (exprs.length === 0) return TRUE;
        let acc = this.exprToS(exprs[0]);
        for (let i = 1; i < exprs.length; i++) {
            acc = { kind: 'app', op: '&&', args: [acc, this.exprToS(exprs[i])] };
        }
        return acc;
    }

    // 表达式 → S-表达式
    private exprToS(expr: Expression): SExpr {
        switch (expr.type) {
            case 'NumberLiteral':
                return {
                    kind: 'const',
                    type: expr.value % 1 !== 0 ? 'double' : 'i32',
                    value: String(expr.value)
                };
            case 'StringLiteral':
                return { kind: 'const', type: 'string', value: expr.value };
            case 'CharLiteral':
                return { kind: 'const', type: 'char', value: expr.value };
            case 'Identifier':
                return { kind: 'var', name: expr.name };
            case 'ResultExpr':
                return { kind: 'var', name: 'result' };
            case 'BinaryExpression':
                return { kind: 'app', op: expr.operator, args: [this.exprToS(expr.left), this.exprToS(expr.right)] };
            case 'LogicalExpression':
                return { kind: 'app', op: expr.operator, args: [this.exprToS(expr.left), this.exprToS(expr.right)] };
            case 'UnaryExpression':
                return { kind: 'app', op: expr.operator, args: [this.exprToS(expr.argument)] };
            default:
                // 函数调用 / 成员访问 / new 等：验证层面视为不可解释的原子
                return { kind: 'var', name: 'uninterpreted' };
        }
    }

    // 替换：Q[name := e]
    private substitute(s: SExpr, name: string, e: SExpr): SExpr {
        if (s.kind === 'var' && s.name === name) {
            return e;
        }
        if (s.kind === 'app') {
            return { kind: 'app', op: s.op, args: s.args.map(a => this.substitute(a, name, e)) };
        }
        return s;
    }

    private wpBlock(stmts: Statement[], q: SExpr): { formula: SExpr; obligations: Obligation[] } {
        const obligations: Obligation[] = [];
        let cur = q;
        // WP 演算从后往前
        for (let i = stmts.length - 1; i >= 0; i--) {
            const r = this.wp(stmts[i], cur);
            cur = r.formula;
            obligations.push(...r.obligations);
        }
        return { formula: cur, obligations };
    }

    private wp(stmt: Statement, q: SExpr): { formula: SExpr; obligations: Obligation[] } {
        switch (stmt.type) {
            case 'VariableDeclaration': {
                const e = this.exprToS(stmt.value);
                return { formula: this.substitute(q, stmt.identifier, e), obligations: [] };
            }
            case 'AssignmentStatement': {
                const e = this.exprToS(stmt.value);
                return { formula: this.substitute(q, stmt.name, e), obligations: [] };
            }
            case 'ReturnStatement': {
                const e = this.exprToS(stmt.argument);
                return { formula: this.substitute(q, 'result', e), obligations: [] };
            }
            case 'ExpressionStatement':
                return { formula: q, obligations: [] };
            case 'WhileStatement': {
                if (!stmt.invariant || stmt.invariant.length === 0) {
                    // 无不变量的循环无法验证，保守地返回 q（不产生错误，但也不保证）
                    return { formula: q, obligations: [] };
                }
                const I = this.conjoin(stmt.invariant);
                const b = this.exprToS(stmt.condition);
                const notB: SExpr = { kind: 'app', op: '!', args: [b] };

                const body = this.wpBlock(stmt.body, I);
                const obligations: Obligation[] = [];
                const n = this.obligationCounter++;
                obligations.push({
                    id: `while_${n}::exit`,
                    antecedent: { kind: 'app', op: '&&', args: [I, notB] },
                    consequent: q
                });
                obligations.push({
                    id: `while_${n}::preserve`,
                    antecedent: { kind: 'app', op: '&&', args: [I, b] },
                    consequent: body.formula
                });
                obligations.push(...body.obligations);
                return { formula: I, obligations };
            }
            case 'ForStatement': {
                // for 循环暂不支持验证（无 invariant 语法），保守跳过
                return { formula: q, obligations: [] };
            }
            case 'BreakStatement':
            case 'ContinueStatement':
                // 控制流跳转暂不参与 WP 演算，保守跳过
                return { formula: q, obligations: [] };
            case 'FunctionDeclaration':
                return { formula: q, obligations: [] };
            default:
                return { formula: q, obligations: [] };
        }
    }

    // =========================================================================
    // 行协议序列化（纯文本，与 C++ 判定器对接）
    // =========================================================================
    public toProtocol(obligations: Obligation[]): string {
        const lines: string[] = [];
        for (const o of obligations) {
            lines.push(`OBLIGATION ${o.id}`);
            lines.push(`ANTE ${this.sexprToString(o.antecedent)}`);
            lines.push(`CONSE ${this.sexprToString(o.consequent)}`);
            lines.push(`END_OBLIGATION`);
        }
        return lines.join('\n');
    }

    private sexprToString(s: SExpr): string {
        if (s.kind === 'var') return `( var ${s.name} )`;
        if (s.kind === 'const') return `( const ${s.type} ${s.value} )`;
        return `( ${s.op} ${s.args.map(a => this.sexprToString(a)).join(' ')} )`;
    }

    // =========================================================================
    // SMT-LIB 导出（对接外部求解器 Z3 / cvc5）
    // 与 runtime/include/verify/SmtLibEmitter.hpp 保持一致的语义。
    // =========================================================================
    public toSmtLib(obligations: Obligation[]): string {
        const lines: string[] = ['(set-logic ALL)', ''];
        for (const o of obligations) {
            const vars = new Set<string>();
            this.collectVars(o.antecedent, vars);
            this.collectVars(o.consequent, vars);

            lines.push(`; obligation ${o.id}`);
            for (const v of vars) {
                lines.push(`(declare-const ${v} Int)`);
            }
            lines.push(`(assert (and ${this.sexprToSmtLib(o.antecedent)} (not ${this.sexprToSmtLib(o.consequent)})))`);
            lines.push('(check-sat)');
            lines.push('');
        }
        return lines.join('\n');
    }

    private collectVars(s: SExpr, vars: Set<string>): void {
        if (s.kind === 'var') { vars.add(s.name); return; }
        if (s.kind === 'app') { s.args.forEach(a => this.collectVars(a, vars)); }
    }

    private sexprToSmtLib(s: SExpr): string {
        if (s.kind === 'var') return s.name;
        if (s.kind === 'const') return s.value;
        const op = s.op;
        if (op === '!') return `(not ${this.sexprToSmtLib(s.args[0])})`;
        if (op === '-' && s.args.length === 1) return `(- ${this.sexprToSmtLib(s.args[0])})`;
        if (op === '!=') return `(not (= ${this.sexprToSmtLib(s.args[0])} ${this.sexprToSmtLib(s.args[1])}))`;
        const smtOpMap: Record<string, string> = {
            '==': '=', '&&': 'and', '||': 'or', '+': '+', '-': '-', '*': '*', '/': 'div',
            '<': '<', '<=': '<=', '>': '>', '>=': '>='
        };
        const smtOp = smtOpMap[op] ?? op;
        return `(${smtOp} ${s.args.map(a => this.sexprToSmtLib(a)).join(' ')})`;
    }
}