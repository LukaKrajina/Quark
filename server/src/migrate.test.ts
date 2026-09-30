import { test } from 'node:test';
import assert from 'node:assert';
import { parseQasm2 } from './migrate/qasm2';
import { emitCircuit } from './migrate/emitter';
import { migrate, detectLang } from './migrate';
import { lowerGate, lowerToBasic } from './migrate/gates';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { SemanticAnalyzer } from './semantic';

/** 用 qk 现有编译管线校验生成的 .qk 源码无语义错误 */
function analyze(src: string): SemanticAnalyzer {
    const parser = new Parser(new Lexer(src));
    const ast = parser.parse();
    const analyzer = new SemanticAnalyzer();
    analyzer.analyze(ast);
    return analyzer;
}

const BELL_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0], q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];
`;

test('migrate: parseQasm2 builds correct CircuitIR', () => {
    const ir = parseQasm2(BELL_QASM);
    assert.strictEqual(ir.qubitCount, 2);
    assert.strictEqual(ir.bitCount, 2);
    assert.strictEqual(ir.ops.length, 4);
    assert.deepStrictEqual(ir.ops[0], { kind: 'gate', name: 'h', qubits: [0], params: [] });
    assert.deepStrictEqual(ir.ops[1], { kind: 'gate', name: 'cx', qubits: [0, 1], params: [] });
    assert.deepStrictEqual(ir.ops[2], { kind: 'measure', qubit: 0, bit: 0 });
    assert.deepStrictEqual(ir.ops[3], { kind: 'measure', qubit: 1, bit: 1 });
});

test('migrate: OpenQASM 2.0 Bell state -> valid .qk', () => {
    const qk = migrate(BELL_QASM, 'openqasm2');
    assert.ok(qk.includes('Qubit q0 = alloc();'));
    assert.ok(qk.includes('h(q0);'));
    assert.ok(qk.includes('cx(q0, q1);'));
    assert.ok(qk.includes('c0 = measure(q0);'));
    assert.ok(qk.includes('c1 = measure(q1);'));
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0, 'generated .qk should be semantically valid');
});

test('migrate: parametric gates u3/cz decompose to native qk gates', () => {
    // u3(θ,φ,λ) → rz(λ)·ry(θ)·rz(φ)
    const u3 = lowerGate('u3', [0], [0.5, 0.2, 0.1]);
    assert.deepStrictEqual(u3.map(g => g.name), ['rz', 'ry', 'rz']);
    // cz → h(t)·cx·h(t)
    const cz = lowerGate('cz', [0, 1], []);
    assert.deepStrictEqual(cz.map(g => g.name), ['h', 'cx', 'h']);
    // sdg → rz(-π/2)
    const sdg = lowerGate('sdg', [0], []);
    assert.strictEqual(sdg[0].name, 'rz');
    assert.ok((sdg[0].params[0] as number) < 0);
});

test('migrate: custom gate definition emits @[gate] function', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
gate my_rot(angle) a {
    rz(angle) a;
}
my_rot(0.1) q[0];
my_rot(0.2) q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];
`;
    const qk = migrate(qasm, 'openqasm2');
    assert.ok(qk.includes('@[gate]'));
    assert.ok(qk.includes('void my_rot(Qubit a, double angle)'));
    assert.ok(qk.includes('rz(a, angle);'));
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0);
});

test('migrate: new native gates y/z/s/t/rx/ry are semantically valid', () => {
    const qk = `@layer(time=0, thread=0, coord=(0))
int32 quark_main() {
    Qubit q = alloc();
    h(q);
    x(q);
    y(q);
    z(q);
    s(q);
    t(q);
    rx(q, 0.5);
    ry(q, 0.5);
    rz(q, 0.5);
    int32 m = measure(q);
    return m;
}`;
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0, a.errors.map(e => e.message).join('; '));
});

test('migrate: detectLang auto-detects OpenQASM versions', () => {
    assert.strictEqual(detectLang(BELL_QASM), 'openqasm2');
    assert.strictEqual(detectLang('OPENQASM 3.0;\nqubit[2] q;'), 'openqasm3');
    assert.strictEqual(detectLang('DECLARE ro BIT[1]'), 'quil');
    assert.strictEqual(detectLang('namespace Foo { operation Bar() : Unit {} }'), 'qsharp');
    assert.strictEqual(detectLang('int32 x = 1;'), null);
});

test('migrate: emitter round-trips a full circuit with loop', () => {
    const ir = {
        name: 'test',
        qubitCount: 3,
        bitCount: 3,
        classicalVars: [],
        gateDefs: [],
        ops: [
            { kind: 'gate', name: 'h', qubits: [0], params: [] },
            { kind: 'for', varName: 'i', lo: 0, hi: 3, body: [
                { kind: 'gate', name: 'rz', qubits: [0], params: [0.1] },
            ] },
            { kind: 'measure', qubit: 0, bit: 0 },
            { kind: 'measure', qubit: 1, bit: 1 },
            { kind: 'measure', qubit: 2, bit: 2 },
        ] as any,
    };
    const qk = emitCircuit(ir);
    assert.ok(qk.includes('for (int32 i = 0; i < 3; i = i + 1) {'));
    assert.ok(qk.includes('rz(q0, 0.1);'));
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0, a.errors.map(e => e.message).join('; '));
});

test('migrate: OpenQASM 3.0 with qubit[] and for loop -> valid .qk', () => {
    const qasm3 = `OPENQASM 3.0;
qubit[3] q;
bit[3] c;
h q[0];
for i in [0:3] {
    rx(0.1) q[i];
}
c = measure q;
`;
    const qk = migrate(qasm3, 'openqasm3');
    assert.ok(qk.includes('Qubit q0 = alloc();'));
    assert.ok(qk.includes('rx(q0, 0.1);'));
    assert.ok(qk.includes('rx(q1, 0.1);'));
    assert.ok(qk.includes('rx(q2, 0.1);'));
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0, a.errors.map(e => e.message).join('; '));
});

test('migrate: Quil circuit -> valid .qk', () => {
    const quil = `DECLARE ro BIT[2]
H 0
CNOT 0 1
MEASURE 0 ro[0]
MEASURE 1 ro[1]
`;
    const qk = migrate(quil, 'quil');
    assert.ok(qk.includes('h(q0);'));
    assert.ok(qk.includes('cx(q0, q1);'));
    assert.ok(qk.includes('c0 = measure(q0);'));
    assert.ok(qk.includes('c1 = measure(q1);'));
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0, a.errors.map(e => e.message).join('; '));
});

test('migrate: Q# operation -> valid .qk', () => {
    const qsharp = `namespace Quantum.Bell {
    operation Bell() : Result[] {
        use (q0, q1) = (Qubit(), Qubit());
        H(q0);
        CNOT(q0, q1);
        let r0 = M(q0);
        let r1 = M(q1);
        Reset(q0);
        Reset(q1);
        return [r0, r1];
    }
}
`;
    const qk = migrate(qsharp, 'qsharp');
    assert.ok(qk.includes('h(q0);'));
    assert.ok(qk.includes('cx(q0, q1);'));
    assert.ok(qk.includes('c0 = measure(q0);'));
    assert.ok(qk.includes('c1 = measure(q1);'));
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0, a.errors.map(e => e.message).join('; '));
});

test('migrate: Silq circuit -> valid .qk', () => {
    const silq = `def main() {
    q := 0:𝔹;
    q := H(q);
    x := measure(q);
    return x;
}
`;
    const qk = migrate(silq, 'silq');
    assert.ok(qk.includes('h(q0);'));
    assert.ok(qk.includes('c0 = measure(q0);'));
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0, a.errors.map(e => e.message).join('; '));
});

test('migrate: mid-circuit reset uses QObject layer with conditional flip', () => {
    const qasm = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[2];
h q[0];
measure q[0] -> c[0];
reset q[0];
h q[0];
measure q[0] -> c[1];
`;
    const qk = migrate(qasm, 'openqasm2');
    // 中间 reset → QObject 层：QuantumRegister + qgate_* + qmeasure + 条件翻转
    assert.ok(qk.includes('auto q = new QuantumRegister(1);'));
    assert.ok(qk.includes('c0 = qmeasure(q, 0);'));
    assert.ok(qk.includes('qmeasure(q, 0);'));
    assert.ok(qk.includes('qgate_x(q, 0);'));
    assert.ok(qk.includes('c1 = qmeasure(q, 0);'));
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0, a.errors.map(e => e.message).join('; '));
});

test('migrate: OpenQASM 3 classical vars + while + complex if -> valid .qk', () => {
    const qasm3 = `OPENQASM 3.0;
qubit[1] q;
bit[1] c;
int[32] count = 0;
bool flag = true;
h q[0];
count = count + 1;
while (count < 3) {
    count = count + 1;
}
if (count >= 1 && flag) {
    x q[0];
}
c[0] = measure q[0];
`;
    const qk = migrate(qasm3, 'openqasm3');
    assert.ok(qk.includes('int32 count = 0;'));
    assert.ok(qk.includes('int32 flag = 1;'));
    assert.ok(qk.includes('count = count + 1;'));
    assert.ok(qk.includes('while (count < 3) {'));
    assert.ok(qk.includes('if (count >= 1 && flag) {'));
    assert.ok(qk.includes('c0 = measure(q0);'));
    const a = analyze(qk);
    assert.strictEqual(a.errors.length, 0, a.errors.map(e => e.message).join('; '));
});

test('migrate: gate decomposition to QObject primitives (h/x/rz/cnot)', () => {
    // ry(θ) → rz(-π/2)·h·rz(θ)·h·rz(π/2)
    const ry = lowerToBasic('ry', [0], [0.5]);
    assert.deepStrictEqual(ry.map(g => g.name), ['rz', 'h', 'rz', 'h', 'rz']);
    // swap → 3×cnot
    const sw = lowerToBasic('swap', [0, 1], []);
    assert.deepStrictEqual(sw.map(g => g.name), ['cnot', 'cnot', 'cnot']);
    // y → x·h·x·h
    const y = lowerToBasic('y', [0], []);
    assert.deepStrictEqual(y.map(g => g.name), ['x', 'h', 'x', 'h']);
});
