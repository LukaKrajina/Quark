import { test } from 'node:test';
import assert from 'node:assert';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { buildMir, MirBody } from './mir';

function build(src: string): MirBody {
    const parser = new Parser(new Lexer(src));
    const ast = parser.parse();
    const prog = buildMir(ast);
    assert.ok(prog.bodies.length >= 1, 'expect at least one body');
    return prog.bodies[0];
}

function count(body: MirBody, kind: string): number {
    return body.blocks.filter(b => b.terminator?.kind === kind).length;
}

test('mir: Qubit local is marked linear, int32 is not', () => {
    const body = build('int32 quark_main() { auto q = alloc(); int32 x = 1; return 0; }');
    const q = body.locals.find(l => l.name === 'q');
    const x = body.locals.find(l => l.name === 'x');
    assert.ok(q, 'q local exists');
    assert.ok(x, 'x local exists');
    assert.strictEqual(q.linear, true, 'Qubit is linear');
    assert.strictEqual(x.linear, false, 'int32 is not linear');
});

test('mir: if/else produces a single SwitchInt', () => {
    const body = build('int32 quark_main() { int32 x = 1; if (x == 1) { x = 2; } else { x = 3; } return x; }');
    assert.strictEqual(count(body, 'SwitchInt'), 1);
    assert.strictEqual(count(body, 'Return'), 1);
});

test('mir: else-if chain nests as one SwitchInt per if', () => {
    const body = build(
        'int32 quark_main() { int32 x = 1; int32 r = 0; ' +
        'if (x == 0) { r = 1; } else if (x == 1) { r = 2; } else { r = 3; } return r; }');
    // 两个 if（外层 + 内层 else-if）各产生一个 SwitchInt
    assert.strictEqual(count(body, 'SwitchInt'), 2);
});

test('mir: logical AND short-circuit produces branching', () => {
    const body = build('int32 quark_main() { int32 a = 1; int32 b = 2; int32 c = a < 1 && b > 2; return 0; }');
    // a < 1 的比较用 SwitchInt 实现短回路，故至少 1 个
    assert.ok(count(body, 'SwitchInt') >= 1);
});

test('mir: while produces loop via SwitchInt + backedge Goto', () => {
    const body = build('int32 quark_main() { int32 i = 0; while (i < 10) { i = i + 1; } return i; }');
    assert.strictEqual(count(body, 'SwitchInt'), 1);
    assert.ok(count(body, 'Goto') >= 2, 'cond entry + backedge');
});

test('mir: for with break/continue routes to correct targets', () => {
    const body = build(
        'int32 quark_main() { int32 i = 0; for (i = 0; i < 10; i = i + 1) { if (i == 5) { continue; } if (i == 8) { break; } } return i; }');
    // 1 个 for 的 SwitchInt + 2 个 if 的 SwitchInt
    assert.ok(count(body, 'SwitchInt') >= 3);
});

test('mir: return produces Return terminator', () => {
    const body = build('int32 quark_main() { return 7; }');
    assert.strictEqual(count(body, 'Return'), 1);
});

test('mir: all blocks terminated (well-formed CFG)', () => {
    const body = build(
        'int32 quark_main() { int32 x = 1; int32 r = 0; ' +
        'while (x < 3) { x = x + 1; if (x == 2) { r = r + 1; } } return r; }');
    for (const b of body.blocks) {
        assert.notStrictEqual(b.terminator, null, `block ${b.id} must have a terminator`);
    }
});
