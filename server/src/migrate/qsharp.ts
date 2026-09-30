// ============================================================================
// qsharp.ts —— Q#（Microsoft）前端：源码 → CircuitIR
//
// 覆盖 Q# 核心量子电路子集：
//   namespace / operation / use (q0, q1) = (Qubit(), Qubit());
//   using (qs = Qubit[n]) { ... } / H(q) / CNOT(c, t) / Rx(θ, q) / M(q) / Reset(q)
//
// 注意：Q# 的旋转门参数顺序为「角度在前、qubit 在后」（Rx(θ, q)），
// 此处归一为 qelib1 风格（qubit 在前、角度在后），交 emitter 统一发射。
// Q# 的 M(q) 不消费 qubit（需 Reset 复用），迁移到 qk 的消费式 measure，
// 随后的 Reset 降级为注释。
// ============================================================================

import { CircuitIR, Op, emptyCircuit, gate } from './circuit-ir';

// Q# 门名 → qelib1 风格门名；带角度（θ 在前）的门在此列出
const QSHARP_GATE_MAP: Record<string, string> = {
    H: 'h',
    X: 'x',
    Y: 'y',
    Z: 'z',
    S: 's',
    T: 't',
    Rx: 'rx',
    Ry: 'ry',
    Rz: 'rz',
    CNOT: 'cx',
    CCNOT: 'ccx',
    SWAP: 'swap',
};

// 带角度参数（θ 在第一个参数）的门
const ANGLE_GATES = new Set(['Rx', 'Ry', 'Rz']);

// ─── Tokenizer ──────────────────────────────────────────────────────────────

interface Tok {
    kind: 'ident' | 'number' | 'string' | 'punct' | 'eof';
    value: string;
    line: number;
}

function tokenize(src: string): Tok[] {
    const toks: Tok[] = [];
    let i = 0;
    let line = 1;
    const n = src.length;
    while (i < n) {
        const ch = src[i];
        if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
        if (ch === '\n') { line++; i++; continue; }
        if (ch === '/' && src[i + 1] === '/') {
            while (i < n && src[i] !== '\n') i++;
            continue;
        }
        if (ch === '"') {
            let j = i + 1;
            while (j < n && src[j] !== '"') j++;
            toks.push({ kind: 'string', value: src.slice(i + 1, j), line });
            i = j + 1;
            continue;
        }
        if (/[0-9]/.test(ch)) {
            let j = i;
            while (j < n && /[0-9.eE+-]/.test(src[j])) j++;
            toks.push({ kind: 'number', value: src.slice(i, j), line });
            i = j;
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < n && /[A-Za-z0-9_.]/.test(src[j])) j++;
            toks.push({ kind: 'ident', value: src.slice(i, j), line });
            i = j;
            continue;
        }
        if ((ch === '=' && src[i + 1] === '=') || (ch === '!' && src[i + 1] === '=') ||
            (ch === '&' && src[i + 1] === '&') || (ch === '|' && src[i + 1] === '|') ||
            (ch === '.' && src[i + 1] === '.')) {
            toks.push({ kind: 'punct', value: src.slice(i, i + 2), line });
            i += 2;
            continue;
        }
        if ('[]();,{}:()=<>+-*/%'.includes(ch)) {
            toks.push({ kind: 'punct', value: ch, line });
            i++;
            continue;
        }
        throw new Error(`[qk migrate:qsharp] Unexpected character '${ch}' at line ${line}`);
    }
    toks.push({ kind: 'eof', value: '', line });
    return toks;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

class QSharpParser {
    private toks: Tok[];
    private pos = 0;
    private ir: CircuitIR = emptyCircuit('qsharp');

    // qubit 变量名 → 全局索引（标量）或索引数组（using 数组）
    private qubits = new Map<string, number | number[]>();

    constructor(src: string) {
        this.toks = tokenize(src);
    }

    private peek(offset = 0): Tok {
        return this.toks[Math.min(this.pos + offset, this.toks.length - 1)];
    }

    private next(): Tok {
        return this.toks[this.pos++];
    }

    private isIdent(v?: string): boolean {
        const t = this.peek();
        return t.kind === 'ident' && (v === undefined || t.value === v);
    }

    private eatPunct(v: string): void {
        const t = this.next();
        if (t.kind !== 'punct' || t.value !== v) {
            throw new Error(`[qsharp] Expected '${v}' at line ${t.line}, got '${t.value}'`);
        }
    }

    private expectIdent(): string {
        const t = this.next();
        if (t.kind !== 'ident') throw new Error(`[qsharp] Expected identifier at line ${t.line}`);
        return t.value;
    }

    parse(): CircuitIR {
        // 跳过 namespace 声明，定位 operation
        while (this.peek().kind !== 'eof') {
            if (this.isIdent('namespace')) {
                this.skipNamespace();
                continue;
            }
            if (this.isIdent('operation')) {
                this.parseOperation();
                break; // MVP：取第一个 operation
            }
            this.next();
        }
        return this.ir;
    }

    private skipNamespace(): void {
        this.next(); // 'namespace'
        // 名字可能是 namespace Foo.Bar
        while (this.peek().kind === 'ident') this.next();
        this.eatPunct('{');
    }

    /** 解析 operation，把其量子电路 body 写入 ir。 */
    private parseOperation(): void {
        this.next(); // 'operation'
        this.expectIdent(); // 名字

        // 参数列表
        this.skipBalancedParens();

        // 返回类型 : Type（含 Result[] 数组类型）
        if (this.peek().kind === 'punct' && this.peek().value === ':') {
            this.next();
            while (this.peek().kind === 'ident' ||
                   (this.peek().kind === 'punct' && (this.peek().value === '[' || this.peek().value === ']'))) {
                this.next();
            }
        }

        this.eatPunct('{');
        this.parseBody();
        this.eatPunct('}');
    }

    private skipBalancedParens(): void {
        if (!(this.peek().kind === 'punct' && this.peek().value === '(')) return;
        let depth = 0;
        do {
            const t = this.next();
            if (t.kind === 'punct' && t.value === '(') depth++;
            else if (t.kind === 'punct' && t.value === ')') depth--;
        } while (depth > 0 && this.peek().kind !== 'eof');
    }

    /** 解析 operation body 的语句序列。 */
    private parseBody(): void {
        while (this.peek().kind !== 'eof' && !(this.peek().kind === 'punct' && this.peek().value === '}')) {
            this.parseStatement();
        }
    }

    private parseStatement(): void {
        if (this.isIdent('use')) {
            this.parseUse();
            return;
        }
        if (this.isIdent('using')) {
            this.parseUsing();
            return;
        }
        if (this.isIdent('let')) {
            this.parseLet();
            return;
        }
        if (this.isIdent('mutable')) {
            this.next();
            this.expectIdent();
            this.eatPunct('=');
            this.skipExpression();
            this.eatPunct(';');
            return;
        }
        if (this.isIdent('ResetAll')) {
            this.next();
            this.skipBalancedParens();
            this.eatPunct(';');
            return;
        }
        if (this.isIdent('Reset')) {
            this.next();
            this.skipBalancedParens();
            this.eatPunct(';');
            return;
        }
        if (this.isIdent('for')) {
            this.parseFor();
            return;
        }
        if (this.isIdent('return')) {
            // 忽略返回值（迁移后的 quark_main 统一 return 0）
            this.next();
            while (!(this.peek().kind === 'punct' && this.peek().value === ';')) this.next();
            this.eatPunct(';');
            return;
        }
        if (this.isIdent('if')) {
            // Q# if：MVP 跳过（经典控制流，量子电路罕见）
            this.skipStatement();
            return;
        }
        // 门调用（H(q) / CNOT(c,t) / Rx(θ,q) 等）
        this.parseGateCall();
    }

    /** use (q0, q1) = (Qubit(), Qubit()); */
    private parseUse(): void {
        this.next(); // 'use'
        this.eatPunct('(');
        const names: string[] = [];
        while (!(this.peek().kind === 'punct' && this.peek().value === ')')) {
            names.push(this.expectIdent());
            if (this.peek().kind === 'punct' && this.peek().value === ',') this.next();
        }
        this.eatPunct(')');
        this.eatPunct('=');
        this.eatPunct('(');
        // 每个 Qubit() 分配一个全局 qubit
        for (const name of names) {
            this.expectIdent(); // 'Qubit'
            this.eatPunct('(');
            this.eatPunct(')');
            this.qubits.set(name, this.ir.qubitCount++);
            if (this.peek().kind === 'punct' && this.peek().value === ',') this.next();
        }
        this.eatPunct(')');
        this.eatPunct(';');
    }

    /** using (qs = Qubit[n]) { ... } */
    private parseUsing(): void {
        this.next(); // 'using'
        this.eatPunct('(');
        const name = this.expectIdent();
        this.eatPunct('=');
        this.expectIdent(); // 'Qubit'
        this.eatPunct('[');
        const n = Number(this.next().value);
        this.eatPunct(']');
        this.eatPunct(')');

        const arr: number[] = [];
        for (let i = 0; i < n; i++) arr.push(this.ir.qubitCount++);
        this.qubits.set(name, arr);

        this.eatPunct('{');
        this.parseBody();
        this.eatPunct('}');
    }

    /** let r = M(q); → 测量（映射为 measure(q)） */
    private parseLet(): void {
        this.next(); // 'let'
        this.expectIdent(); // r
        this.eatPunct('=');
        const fn = this.expectIdent(); // M 或其它
        this.eatPunct('(');
        if (fn === 'M') {
            const q = this.resolveQubit(this.expectIdent());
            this.eatPunct(')');
            this.eatPunct(';');
            this.ir.ops.push({ kind: 'measure', qubit: q, bit: this.ir.bitCount++ });
            return;
        }
        // 其它 let 表达式：跳过
        this.skipExpression();
        this.eatPunct(';');
    }

    /** for i in 0..n-1 { ... }（循环展开） */
    private parseFor(): void {
        this.next(); // 'for'
        const varName = this.expectIdent();
        this.expectIdent(); // 'in'
        const lo = Number(this.next().value);
        this.eatPunct('..');
        // 上界可能是 n-1 形式（ident - number）
        const hiTok = this.next();
        let hi: number;
        if (hiTok.kind === 'number') hi = Number(hiTok.value);
        else if (hiTok.kind === 'ident') {
            const n = this.qubits.get(hiTok.value);
            if (Array.isArray(n)) hi = n.length;
            else hi = Number(hiTok.value); // 回退
        } else hi = 0;
        // 处理 `n - 1` 的 `- 1`
        if (this.peek().kind === 'punct' && this.peek().value === '-') {
            this.next();
            const k = Number(this.next().value);
            hi = hi - k;
        }

        this.eatPunct('{');

        // 循环展开：替换 qs[i] 下标里的循环变量
        const saved = this.loopVar;
        for (let i = lo; i < hi; i++) {
            this.loopVar = { name: varName, value: i };
            this.parseBody();
        }
        this.loopVar = saved;

        this.eatPunct('}');
    }

    private loopVar: { name: string; value: number } | null = null;

    /** 解析门调用：H(q) / CNOT(c,t) / Rx(θ,q) */
    private parseGateCall(): void {
        const gateName = this.expectIdent();
        const mapped = QSHARP_GATE_MAP[gateName];
        if (!mapped) {
            // 未知标识符（可能是表达式）：跳过语句
            this.skipStatement();
            return;
        }

        this.eatPunct('(');
        const args: (number | string)[] = [];
        const qubits: number[] = [];
        let idx = 0;
        while (!(this.peek().kind === 'punct' && this.peek().value === ')')) {
            const t = this.next();
            if (ANGLE_GATES.has(gateName) && idx === 0) {
                // 角度在第一个参数
                if (t.kind === 'number') args.push(Number(t.value));
                else if (t.kind === 'ident') args.push(t.value);
            } else {
                // qubit 引用
                if (t.kind === 'ident') qubits.push(this.resolveQubit(t.value));
            }
            idx++;
            if (this.peek().kind === 'punct' && this.peek().value === ',') this.next();
        }
        this.eatPunct(')');
        this.eatPunct(';');

        this.ir.ops.push(gate(mapped, qubits, args));
    }

    private resolveQubit(name: string): number {
        // qs[i] 数组下标（含循环变量）
        if (this.peek().kind === 'punct' && this.peek().value === '[') {
            this.next();
            const idxTok = this.next();
            let idx: number;
            if (idxTok.kind === 'number') idx = Number(idxTok.value);
            else if (idxTok.kind === 'ident' && this.loopVar && this.loopVar.name === idxTok.value) idx = this.loopVar.value;
            else idx = 0;
            this.eatPunct(']');
            const arr = this.qubits.get(name);
            if (Array.isArray(arr)) return arr[idx];
            throw new Error(`[qsharp] '${name}' is not a qubit array`);
        }
        const v = this.qubits.get(name);
        if (typeof v === 'number') return v;
        throw new Error(`[qsharp] Undefined qubit '${name}'`);
    }

    private skipExpression(): void {
        while (!(this.peek().kind === 'punct' && (this.peek().value === ';' || this.peek().value === ')'))) {
            this.next();
        }
    }

    private skipStatement(): void {
        let depth = 0;
        while (this.peek().kind !== 'eof') {
            const t = this.next();
            if (t.kind === 'punct' && t.value === '{') depth++;
            if (t.kind === 'punct' && t.value === '}') {
                if (depth === 0) { this.pos--; return; }
                depth--;
            }
            if (t.kind === 'punct' && t.value === ';' && depth === 0) return;
        }
    }
}

/** 解析 Q# 源码为 CircuitIR */
export function parseQsharp(src: string): CircuitIR {
    return new QSharpParser(src).parse();
}