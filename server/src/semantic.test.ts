import { test } from 'node:test';
import assert from 'node:assert';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { SemanticAnalyzer } from './semantic';

function analyze(src: string): SemanticAnalyzer {
    const parser = new Parser(new Lexer(src));
    const ast = parser.parse();
    const analyzer = new SemanticAnalyzer();
    analyzer.analyze(ast);
    return analyzer;
}

test('semantic: valid program has no errors', () => {
    const a = analyze('int32 x = 1;\nint32 y = x + 1;');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: undefined variable is flagged', () => {
    const a = analyze('auto x = undefined_var;');
    assert.ok(a.errors.some(e => e.message.includes('Undefined variable')));
});

test('semantic: Qubit cannot be cloned (No-Cloning Theorem)', () => {
    const a = analyze('auto q = alloc();\nauto q2 = q;');
    assert.ok(a.errors.some(e => e.message.includes('No-Cloning') || e.message.includes('Cannot copy Qubit')));
});

test('semantic: type mismatch is flagged', () => {
    const a = analyze('int32 x = 1;\nx = "hello";');
    assert.ok(a.errors.some(e => e.message.includes('Type Error')));
});

test('semantic: measure consumes qubit', () => {
    // measure 后 qubit 被消费,再次使用应报错
    const a = analyze('auto q = alloc();\nauto m = measure(q);\nauto m2 = measure(q);');
    assert.ok(a.errors.some(e => e.message.includes('used after measurement')));
});

test('semantic: while condition must be boolean/numeric', () => {
    const a = analyze('while ("string") { int32 i = 1; }');
    assert.ok(a.errors.some(e => e.message.includes('while condition')));
});

// ─── QChain 量子区块链内置函数 ──────────────────────────────────────
test('semantic: qchain_wallet returns string', () => {
    const a = analyze('string w = qchain_wallet();');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: qchain_balance expects string address', () => {
    const a = analyze('uint64 b = qchain_balance("addr");');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: qchain_mint with wrong arg count is flagged', () => {
    const a = analyze('qchain_mint();');
    assert.ok(a.errors.some(e => e.message.includes('qchain_mint')));
});

test('semantic: qchain_transfer returns int32', () => {
    const a = analyze('int32 ok = qchain_transfer("a", "b", 100);');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: qchain_coin_mint returns QObject, verify takes QObject', () => {
    const a = analyze('QObject c = qchain_coin_mint(8);\nint32 ok = qchain_coin_verify(c);');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: qchain_coin_verify with non-QObject is flagged', () => {
    const a = analyze('int32 ok = qchain_coin_verify(42);');
    assert.ok(a.errors.some(e => e.message.includes('qchain_coin_verify')));
});

// ─── QChain 密码原语 / 抗超时空 / 时空加密 ──────────────────────
test('semantic: qchain_sha3 returns string', () => {
    const a = analyze('string h = qchain_sha3("abc");');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: qchain_hmac expects 2 args', () => {
    const a = analyze('string h = qchain_hmac("key", "msg");');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: qchain_sign and sign_verify', () => {
    const a = analyze('string s = qchain_sign("msg");\nint32 ok = qchain_sign_verify("msg", s);');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: qchain_mlkem_encaps returns string', () => {
    const a = analyze('string c = qchain_mlkem_encaps("pk");');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: qchain_causal_verify returns int32', () => {
    const a = analyze('int32 ok = qchain_causal_verify();');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: qchain_cipher_encrypt returns string', () => {
    const a = analyze('string c = qchain_cipher_encrypt(12345, "msg");');
    assert.strictEqual(a.errors.length, 0);
});