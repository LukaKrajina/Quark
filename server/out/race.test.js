"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const race_1 = require("./race");
const lexer_1 = require("./lexer");
const parser_1 = require("./parser");
const semantic_1 = require("./semantic");
function analyze(src) {
    const ast = new parser_1.Parser(new lexer_1.Lexer(src)).parse();
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    return a;
}
function d(tid, locks = [], qubits = []) {
    return { tid, locks: new Set(locks), qubits: new Set(qubits) };
}
function access(variable, isWrite, digest, destructive = []) {
    return { variable, isWrite, digest, destructiveQubits: new Set(destructive), line: 0, column: 0 };
}
// ---- 经典（锁集 + 线程 id）----
(0, node_test_1.test)('race: common mutex excludes data race', () => {
    const a = access('g', true, d('t1', ['m']));
    const b = access('g', true, d('t2', ['m']));
    node_assert_1.default.deepStrictEqual((0, race_1.detectRaces)([a, b]), []);
});
(0, node_test_1.test)('race: unsynchronized writes race', () => {
    const a = access('g', true, d('t1'));
    const b = access('g', true, d('t2'));
    node_assert_1.default.strictEqual((0, race_1.detectRaces)([a, b]).length, 1);
});
(0, node_test_1.test)('race: two reads do not race', () => {
    const a = access('g', false, d('t1'));
    const b = access('g', false, d('t2'));
    node_assert_1.default.deepStrictEqual((0, race_1.detectRaces)([a, b]), []);
});
(0, node_test_1.test)('race: same thread never races', () => {
    const a = access('g', true, d('t1'));
    const b = access('g', true, d('t1'));
    node_assert_1.default.deepStrictEqual((0, race_1.detectRaces)([a, b]), []);
});
(0, node_test_1.test)('race: partial lock overlap still excludes (one side holds m, other holds m+n)', () => {
    const a = access('g', true, d('t1', ['m']));
    const b = access('g', true, d('t2', ['m', 'n']));
    node_assert_1.default.deepStrictEqual((0, race_1.detectRaces)([a, b]), []);
});
// ---- 量子（纠缠闭包 + 破坏性操作）----
(0, node_test_1.test)('race: destructive ops on entangled qubits collide without a lock', () => {
    // q1~q2 纠缠；t1 测量 q1，t2 测量 q2，无共同锁 -> 可能并发坍缩
    const a = access('reg', true, d('t1', [], ['q1', 'q2']), ['q1']);
    const b = access('reg', true, d('t2', [], ['q1', 'q2']), ['q2']);
    const q = (0, race_1.detectQuantumRaces)([a, b]);
    node_assert_1.default.strictEqual(q.length, 1);
    node_assert_1.default.ok(q[0].quantum);
});
(0, node_test_1.test)('race: entangled ops under a common lock are safe', () => {
    const a = access('reg', true, d('t1', ['m'], ['q1', 'q2']), ['q1']);
    const b = access('reg', true, d('t2', ['m'], ['q1', 'q2']), ['q2']);
    node_assert_1.default.deepStrictEqual((0, race_1.detectQuantumRaces)([a, b]), []);
});
(0, node_test_1.test)('race: a gate on an entangled partner still collides with a measurement', () => {
    // t1 测量 q1（破坏），t2 只对 q2 施加门（非破坏）。二者共享纠缠闭包 {q1,q2}：
    // 对 q1 的测量会坍缩整个纠缠对，故与对 q2 的门施加构成竞争。
    const a = access('reg', false, d('t1', [], ['q1', 'q2']), ['q1']);
    const b = access('reg', false, d('t2', [], ['q1', 'q2']));
    node_assert_1.default.strictEqual((0, race_1.detectQuantumRaces)([a, b]).length, 1);
});
// ---- 纠缠闭包 ----
(0, node_test_1.test)('race: entanglement closure is transitive (q1~q2~q3 => one group)', () => {
    const groups = (0, race_1.entanglementClosure)([['q1', 'q2'], ['q2', 'q3']]);
    node_assert_1.default.strictEqual(groups.size, 1);
    const [group] = groups.values();
    node_assert_1.default.ok(group.has('q1') && group.has('q2') && group.has('q3'));
});
(0, node_test_1.test)('race: disjoint entanglement pairs stay separate', () => {
    const groups = (0, race_1.entanglementClosure)([['q1', 'q2'], ['q3', 'q4']]);
    node_assert_1.default.strictEqual(groups.size, 2);
});
// ---- 端到端（Q-Digest 已接入编译管线）----
(0, node_test_1.test)('race: e2e classic race across spawn threads is detected', () => {
    const a = analyze(`
        int32 quark_main() {
            cap<int32> counter = qk_gc_alloc(4);
            spawn { sync_add(counter, 1); }
            spawn { sync_store(counter, 100); }
            return 0;
        }
    `);
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('Race Warning [Q-Digest]')), 'classic race reported: ' + JSON.stringify(a.errors.map(e => e.message)));
});
(0, node_test_1.test)('race: e2e quantum race on entangled closure is detected', () => {
    const a = analyze(`
        int32 quark_main() {
            Qubit q1 = alloc(1);
            Qubit q2 = alloc(1);
            entangle(q1, q2);
            spawn { measure(q1); }
            spawn { measure(q2); }
            return 0;
        }
    `);
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('Quantum Race [Q-Digest]')), 'quantum race reported: ' + JSON.stringify(a.errors.map(e => e.message)));
});
(0, node_test_1.test)('race: e2e single-threaded sync accesses are race-free', () => {
    const a = analyze(`
        int32 quark_main() {
            cap<int32> counter = qk_gc_alloc(4);
            sync_add(counter, 1);
            sync_store(counter, 100);
            return 0;
        }
    `);
    node_assert_1.default.ok(!a.errors.some(e => e.message.includes('Race')), 'no race in single thread: ' + JSON.stringify(a.errors.map(e => e.message)));
});
//# sourceMappingURL=race.test.js.map