import { test } from 'node:test';
import assert from 'node:assert';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { IRGenerator } from './ir';

function generateIR(src: string): string {
    const parser = new Parser(new Lexer(src));
    const ast = parser.parse();
    return new IRGenerator().generate(ast);
}

test('ir: function with return generates define + ret', () => {
    const ir = generateIR('int32 quark_main() { return 42; }');
    assert.ok(ir.includes('define i32 @quark_main'));
    assert.ok(ir.includes('ret i32 42'));
});

test('ir: arithmetic generates add instruction', () => {
    const ir = generateIR('int32 quark_main() { int32 x = 1 + 2; return x; }');
    assert.ok(ir.includes('add i32 1, 2'));
});

test('ir: comparison generates icmp', () => {
    const ir = generateIR('int32 quark_main() { int32 x = 1 < 2; return 0; }');
    assert.ok(ir.includes('icmp slt'));
});

test('ir: qubit allocation generates qubit_allocate call', () => {
    const ir = generateIR('int32 quark_main() { auto q = alloc(); h(q); return 0; }');
    assert.ok(ir.includes('__quantum__rt__qubit_allocate'));
    assert.ok(ir.includes('__quantum__qis__h'));
});

test('ir: BellState generates qk_create_BellState call', () => {
    const ir = generateIR('int32 quark_main() { auto b = new BellState(); return 0; }');
    assert.ok(ir.includes('qk_create_BellState'));
});

test('ir: string literal generates global string constant', () => {
    const ir = generateIR('int32 quark_main() { let s = "hello"; return 0; }');
    assert.ok(ir.includes('@.str.1'));
    assert.ok(ir.includes('hello'));
});

test('ir: top-level statements wrap into quark_main', () => {
    const ir = generateIR('auto q = alloc();');
    assert.ok(ir.includes('define i32 @quark_main'));
});

test('ir: QIR standard library declarations present', () => {
    const ir = generateIR('int32 quark_main() { return 0; }');
    assert.ok(ir.includes('%Qubit = type opaque'));
    assert.ok(ir.includes('declare i32 @__quantum__qis__measure_int'));
});

test('ir: while loop generates branch labels', () => {
    const ir = generateIR('int32 quark_main() { int32 i = 0; while (i < 10) { i = i + 1; } return i; }');
    assert.ok(ir.includes('while_cond_'));
    assert.ok(ir.includes('while_body_'));
    assert.ok(ir.includes('while_after_'));
});

test('ir: measure generates measure_int call', () => {
    const ir = generateIR('int32 quark_main() { auto q = alloc(); auto m = measure(q); return m; }');
    assert.ok(ir.includes('__quantum__qis__measure_int'));
});
