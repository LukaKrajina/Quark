// ============================================================================
// quil.ts —— Quil（Rigetti）前端：源码 → CircuitIR
//
// 覆盖 Quil 核心子集：
//   DECLARE ro BIT[N] / H 0 / CNOT 0 1 / RX(pi/2) 0 / MEASURE 0 ro[0]
//
// Quil 的 qubit 用整数索引（无需声明），经典 bit 用 DECLARE 声明寄存器。
// 门名在此归一为 OpenQASM qelib1 风格，交给 emitter 的 lowerGate 统一分解。
// ============================================================================

import { CircuitIR, Op, emptyCircuit, gate } from './circuit-ir';

// Quil 门名 → qelib1 风格门名（lowerGate 可识别）
const QUIL_GATE_MAP: Record<string, string> = {
    H: 'h',
    X: 'x',
    Y: 'y',
    Z: 'z',
    S: 's',
    T: 't',
    RX: 'rx',
    RY: 'ry',
    RZ: 'rz',
    CNOT: 'cx',
    CZ: 'cz',
    CY: 'cy',
    SWAP: 'swap',
    CCNOT: 'ccx',
    CSWAP: 'cswap',
    CH: 'ch',
    PHASE: 'u1',
    CPHASE: 'cu1',
};

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
        if (ch === '#' || (ch === '/' && src[i + 1] === '/')) {
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
            while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
            toks.push({ kind: 'ident', value: src.slice(i, j), line });
            i = j;
            continue;
        }
        if ('[]();,(){}*+-/'.includes(ch)) {
            toks.push({ kind: 'punct', value: ch, line });
            i++;
            continue;
        }
        throw new Error(`[qk migrate:quil] Unexpected character '${ch}' at line ${line}`);
    }
    toks.push({ kind: 'eof', value: '', line });
    return toks;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

class QuilParser {
    private toks: Tok[];
    private pos = 0;
    private ir: CircuitIR = emptyCircuit('quil');
    private cregs = new Map<string, { offset: number; size: number }>();

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
            throw new Error(`[quil] Expected '${v}' at line ${t.line}, got '${t.value}'`);
        }
    }

    private expectIdent(): string {
        const t = this.next();
        if (t.kind !== 'ident') throw new Error(`[quil] Expected identifier at line ${t.line}`);
        return t.value;
    }

    parse(): CircuitIR {
        while (this.peek().kind !== 'eof') {
            this.parseLine();
        }
        return this.ir;
    }

    private parseLine(): void {
        const t = this.peek();

        if (this.isIdent('DECLARE')) {
            this.next();
            const name = this.expectIdent();
            this.expectIdent(); // BIT
            this.eatPunct('[');
            const size = Number(this.next().value);
            this.eatPunct(']');
            this.cregs.set(name, { offset: this.ir.bitCount, size });
            this.ir.bitCount += size;
            return;
        }

        if (this.isIdent('MEASURE')) {
            this.next();
            const qubit = Number(this.next().value);
            const c = this.parseBitRef();
            this.ir.ops.push({ kind: 'measure', qubit, bit: this.resolveC(c.name, c.idx) });
            return;
        }

        if (this.isIdent('RESET')) {
            this.next();
            const qubit = Number(this.next().value);
            this.ir.ops.push({ kind: 'reset', qubit });
            return;
        }

        // DEFGATE / DEFCIRCUIT / 其它声明：跳过到换行（MVP 不支持）
        if (this.isIdent('DEFGATE') || this.isIdent('DEFCIRCUIT')) {
            while (this.peek().kind !== 'eof' && this.peek().line === t.line) this.next();
            return;
        }

        // 门调用：GATE q1 q2 ... 或 GATE(params) q1 q2 ...
        if (t.kind === 'ident') {
            const gateName = this.expectIdent().toUpperCase();
            const params: (number | string)[] = [];
            if (this.peek().kind === 'punct' && this.peek().value === '(') {
                this.next();
                while (!(this.peek().kind === 'punct' && this.peek().value === ')')) {
                    const p = this.next();
                    if (p.kind === 'number') params.push(Number(p.value));
                    else if (p.kind === 'ident') params.push(p.value); // pi
                    else throw new Error(`[quil] Unexpected param at line ${p.line}`);
                    if (this.peek().kind === 'punct' && this.peek().value === ',') this.next();
                }
                this.eatPunct(')');
            }

            const qubits: number[] = [];
            const startLine = this.peek().line;
            while (this.peek().kind === 'number' && this.peek().line === startLine) {
                qubits.push(Number(this.next().value));
            }

            const mapped = QUIL_GATE_MAP[gateName];
            if (!mapped) throw new Error(`[qk migrate:quil] Unsupported Quil gate '${gateName}'`);
            this.ir.ops.push(gate(mapped, qubits, params));
            // 更新 qubit 数
            for (const q of qubits) this.ir.qubitCount = Math.max(this.ir.qubitCount, q + 1);
            return;
        }

        // 跳过空行 / 未知
        this.next();
    }

    private parseBitRef(): { name: string; idx: number } {
        const name = this.expectIdent();
        this.eatPunct('[');
        const idx = Number(this.next().value);
        this.eatPunct(']');
        return { name, idx };
    }

    private resolveC(name: string, idx: number): number {
        const r = this.cregs.get(name);
        if (!r) throw new Error(`[quil] Undefined register '${name}'`);
        return r.offset + idx;
    }
}

/** 解析 Quil 源码为 CircuitIR */
export function parseQuil(src: string): CircuitIR {
    return new QuilParser(src).parse();
}