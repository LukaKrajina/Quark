"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const lexer_1 = require("./lexer");
const parser_1 = require("./parser");
const ir_1 = require("./ir");
function generateIR(src) {
    const parser = new parser_1.Parser(new lexer_1.Lexer(src));
    const ast = parser.parse();
    return new ir_1.IRGenerator().generate(ast);
}
(0, node_test_1.test)('ir: function with return generates define + ret', () => {
    const ir = generateIR('int32 quark_main() { return 42; }');
    node_assert_1.default.ok(ir.includes('define i32 @quark_main'));
    node_assert_1.default.ok(ir.includes('ret i32 42'));
});
(0, node_test_1.test)('ir: arithmetic generates add instruction', () => {
    const ir = generateIR('int32 quark_main() { int32 x = 1 + 2; return x; }');
    node_assert_1.default.ok(ir.includes('add i32 1, 2'));
});
(0, node_test_1.test)('ir: comparison generates icmp', () => {
    const ir = generateIR('int32 quark_main() { int32 x = 1 < 2; return 0; }');
    node_assert_1.default.ok(ir.includes('icmp slt'));
});
(0, node_test_1.test)('ir: qubit allocation generates qubit_allocate call', () => {
    const ir = generateIR('int32 quark_main() { auto q = alloc(); h(q); return 0; }');
    node_assert_1.default.ok(ir.includes('__quantum__rt__qubit_allocate'));
    node_assert_1.default.ok(ir.includes('__quantum__qis__h'));
});
(0, node_test_1.test)('ir: BellState generates qk_create_BellState call', () => {
    const ir = generateIR('int32 quark_main() { auto b = new BellState(); return 0; }');
    node_assert_1.default.ok(ir.includes('qk_create_BellState'));
});
(0, node_test_1.test)('ir: string literal generates global string constant', () => {
    const ir = generateIR('int32 quark_main() { let s = "hello"; return 0; }');
    node_assert_1.default.ok(ir.includes('@.str.1'));
    node_assert_1.default.ok(ir.includes('hello'));
});
(0, node_test_1.test)('ir: top-level statements wrap into quark_main', () => {
    const ir = generateIR('auto q = alloc();');
    node_assert_1.default.ok(ir.includes('define i32 @quark_main'));
});
(0, node_test_1.test)('ir: QIR standard library declarations present', () => {
    const ir = generateIR('int32 quark_main() { return 0; }');
    node_assert_1.default.ok(ir.includes('%Qubit = type opaque'));
    node_assert_1.default.ok(ir.includes('declare i32 @__quantum__qis__measure_int'));
});
(0, node_test_1.test)('ir: while loop generates branch labels', () => {
    const ir = generateIR('int32 quark_main() { int32 i = 0; while (i < 10) { i = i + 1; } return i; }');
    node_assert_1.default.ok(ir.includes('while_cond_'));
    node_assert_1.default.ok(ir.includes('while_body_'));
    node_assert_1.default.ok(ir.includes('while_after_'));
});
(0, node_test_1.test)('ir: measure generates measure_int call', () => {
    const ir = generateIR('int32 quark_main() { auto q = alloc(); auto m = measure(q); return m; }');
    node_assert_1.default.ok(ir.includes('__quantum__qis__measure_int'));
});
//# sourceMappingURL=ir.test.js.map