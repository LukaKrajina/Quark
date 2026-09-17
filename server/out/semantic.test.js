"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const lexer_1 = require("./lexer");
const parser_1 = require("./parser");
const semantic_1 = require("./semantic");
function analyze(src) {
    const parser = new parser_1.Parser(new lexer_1.Lexer(src));
    const ast = parser.parse();
    const analyzer = new semantic_1.SemanticAnalyzer();
    analyzer.analyze(ast);
    return analyzer;
}
(0, node_test_1.test)('semantic: valid program has no errors', () => {
    const a = analyze('int32 x = 1;\nint32 y = x + 1;');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: undefined variable is flagged', () => {
    const a = analyze('auto x = undefined_var;');
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('Undefined variable')));
});
(0, node_test_1.test)('semantic: Qubit cannot be cloned (No-Cloning Theorem)', () => {
    const a = analyze('auto q = alloc();\nauto q2 = q;');
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('No-Cloning') || e.message.includes('Cannot copy Qubit')));
});
(0, node_test_1.test)('semantic: type mismatch is flagged', () => {
    const a = analyze('int32 x = 1;\nx = "hello";');
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('Type Error')));
});
(0, node_test_1.test)('semantic: measure consumes qubit', () => {
    // measure 后 qubit 被消费,再次使用应报错
    const a = analyze('auto q = alloc();\nauto m = measure(q);\nauto m2 = measure(q);');
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('used after measurement')));
});
(0, node_test_1.test)('semantic: while condition must be boolean/numeric', () => {
    const a = analyze('while ("string") { int32 i = 1; }');
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('while condition')));
});
// ─── QChain 量子区块链内置函数 ──────────────────────────────────────
(0, node_test_1.test)('semantic: qchain_wallet returns string', () => {
    const a = analyze('string w = qchain_wallet();');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: qchain_balance expects string address', () => {
    const a = analyze('uint64 b = qchain_balance("addr");');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: qchain_mint with wrong arg count is flagged', () => {
    const a = analyze('qchain_mint();');
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('qchain_mint')));
});
(0, node_test_1.test)('semantic: qchain_transfer returns int32', () => {
    const a = analyze('int32 ok = qchain_transfer("a", "b", 100);');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: qchain_coin_mint returns QObject, verify takes QObject', () => {
    const a = analyze('QObject c = qchain_coin_mint(8);\nint32 ok = qchain_coin_verify(c);');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: qchain_coin_verify with non-QObject is flagged', () => {
    const a = analyze('int32 ok = qchain_coin_verify(42);');
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('qchain_coin_verify')));
});
// ─── QChain 密码原语 / 抗超时空 / 时空加密 ──────────────────────
(0, node_test_1.test)('semantic: qchain_sha3 returns string', () => {
    const a = analyze('string h = qchain_sha3("abc");');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: qchain_hmac expects 2 args', () => {
    const a = analyze('string h = qchain_hmac("key", "msg");');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: qchain_sign and sign_verify', () => {
    const a = analyze('string s = qchain_sign("msg");\nint32 ok = qchain_sign_verify("msg", s);');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: qchain_mlkem_encaps returns string', () => {
    const a = analyze('string c = qchain_mlkem_encaps("pk");');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: qchain_causal_verify returns int32', () => {
    const a = analyze('int32 ok = qchain_causal_verify();');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
(0, node_test_1.test)('semantic: qchain_cipher_encrypt returns string', () => {
    const a = analyze('string c = qchain_cipher_encrypt(12345, "msg");');
    node_assert_1.default.strictEqual(a.errors.length, 0);
});
//# sourceMappingURL=semantic.test.js.map