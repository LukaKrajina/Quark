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

// ─── QChain 量子区块链内置函数 ──────────────────────────────────────
test('ir: qchain_wallet generates qk_qchain_wallet call', () => {
    const ir = generateIR('int32 quark_main() { string w = qchain_wallet(); return 0; }');
    assert.ok(ir.includes('declare i8* @qk_qchain_wallet'));
    assert.ok(ir.includes('call i8* @qk_qchain_wallet'));
});

test('ir: qchain_mint generates qk_qchain_mint call with zext amount', () => {
    const ir = generateIR('int32 quark_main() { qchain_mint("a", 1000); return 0; }');
    assert.ok(ir.includes('call void @qk_qchain_mint'));
    assert.ok(ir.includes('zext i32'));
});

test('ir: qchain_balance declares i64 return', () => {
    const ir = generateIR('int32 quark_main() { uint64 b = qchain_balance("a"); return 0; }');
    assert.ok(ir.includes('declare i64 @qk_qchain_balance'));
    assert.ok(ir.includes('call i64 @qk_qchain_balance'));
});

test('ir: qchain_coin_mint returns QObject pointer', () => {
    const ir = generateIR('int32 quark_main() { QObject c = qchain_coin_mint(8); return 0; }');
    assert.ok(ir.includes('declare %QObject* @qk_qchain_coin_mint'));
    assert.ok(ir.includes('call %QObject* @qk_qchain_coin_mint'));
});

test('ir: qchain_coin_verify takes QObject', () => {
    const ir = generateIR('int32 quark_main() { QObject c = qchain_coin_mint(8); int32 ok = qchain_coin_verify(c); return ok; }');
    assert.ok(ir.includes('declare i32 @qk_qchain_coin_verify'));
    assert.ok(ir.includes('call i32 @qk_qchain_coin_verify'));
});

// ─── QChain 密码原语 / 抗超时空 / 时空加密 ──────────────────────
test('ir: qchain_sha3 generates qk_qchain_sha3 call', () => {
    const ir = generateIR('int32 quark_main() { string h = qchain_sha3("abc"); return 0; }');
    assert.ok(ir.includes('declare i8* @qk_qchain_sha3'));
    assert.ok(ir.includes('call i8* @qk_qchain_sha3'));
});

test('ir: qchain_sign generates qk_qchain_sign call', () => {
    const ir = generateIR('int32 quark_main() { string s = qchain_sign("msg"); return 0; }');
    assert.ok(ir.includes('declare i8* @qk_qchain_sign'));
    assert.ok(ir.includes('call i8* @qk_qchain_sign'));
});

test('ir: qchain_mlkem_encaps generates qk_qchain_mlkem_encaps call', () => {
    const ir = generateIR('int32 quark_main() { string c = qchain_mlkem_encaps("pk"); return 0; }');
    assert.ok(ir.includes('declare i8* @qk_qchain_mlkem_encaps'));
    assert.ok(ir.includes('call i8* @qk_qchain_mlkem_encaps'));
});

test('ir: qchain_causal_verify generates qk_qchain_causal_verify call', () => {
    const ir = generateIR('int32 quark_main() { int32 ok = qchain_causal_verify(); return ok; }');
    assert.ok(ir.includes('declare i32 @qk_qchain_causal_verify'));
    assert.ok(ir.includes('call i32 @qk_qchain_causal_verify'));
});

test('ir: qchain_cipher_encrypt zext seed to i64', () => {
    const ir = generateIR('int32 quark_main() { string c = qchain_cipher_encrypt(12345, "msg"); return 0; }');
    assert.ok(ir.includes('declare i8* @qk_qchain_cipher_encrypt'));
    assert.ok(ir.includes('zext i32'));
    assert.ok(ir.includes('call i8* @qk_qchain_cipher_encrypt'));
});

// ─── lattice 晶格数组类型 ──────────────────────────────────────
test('ir: lattice construct generates qk_lattice_new call', () => {
    const ir = generateIR('int32 quark_main() { lattice<int32, open> b = new lattice<int32, open>(19, 19); return 0; }');
    assert.ok(ir.includes('%Lattice = type opaque'));
    assert.ok(ir.includes('declare %Lattice* @qk_lattice_new'));
    assert.ok(ir.includes('call %Lattice* @qk_lattice_new(i32 2, i32 19, i32 19, i32 0)'));
});

test('ir: lattice index read/write emits qk_lattice_ref/set', () => {
    const ir = generateIR('int32 quark_main() { lattice<int32, open> b = new lattice<int32, open>(9, 9); b[3, 3] = 1; int32 v = b[3, 3]; return v; }');
    assert.ok(ir.includes('call void @qk_lattice_set'));
    assert.ok(ir.includes('call i32 @qk_lattice_ref'));
});

test('ir: lattice periodic boundary encodes 1', () => {
    const ir = generateIR('int32 quark_main() { lattice<int32, periodic> w = new lattice<int32, periodic>(9, 9); return 0; }');
    assert.ok(ir.includes('qk_lattice_new(i32 2, i32 9, i32 9, i32 1)'));
});

test('ir: lattice introspection emits rank/size/boundary calls', () => {
    const ir = generateIR('int32 quark_main() { lattice<int32, open> b = new lattice<int32, open>(19, 19); int32 r = lattice_rank(b); return r; }');
    assert.ok(ir.includes('call i32 @qk_lattice_rank'));
});

test('ir: modulo operator emits srem', () => {
    const ir = generateIR('int32 quark_main() { int32 m = 10 % 3; return m; }');
    assert.ok(ir.includes('srem i32 10, 3'));
});
