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
const semantic_1 = require("./semantic");
const mir_1 = require("./mir");
function parse(src) {
    return new parser_1.Parser(new lexer_1.Lexer(src)).parse();
}
(0, node_test_1.test)('syslevel: cap<int32> maps to i32*', () => {
    const ast = parse('int32 quark_main() { unsafe { cap<int32> p = null; } return 0; }');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('alloca i32*'), 'cap<int32> allocates i32*');
    node_assert_1.default.ok(ir.includes('i32* null'), 'null stored as i32*');
});
(0, node_test_1.test)('syslevel: dereference generates load and store', () => {
    const ast = parse('int32 quark_main() { unsafe { cap<int32> p = null; *p = 5; int32 x = *p; } return 0; }');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('store i32 5'), 'store through capability');
    node_assert_1.default.ok(ir.includes('load i32, i32*'), 'load through capability');
});
(0, node_test_1.test)('syslevel: semantic accepts dereference', () => {
    const a = new semantic_1.SemanticAnalyzer();
    const ast = parse('int32 quark_main() { unsafe { cap<int32> p = null; int32 x = *p; } return 0; }');
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, []);
});
(0, node_test_1.test)('syslevel: MIR lowering handles cap + deref', () => {
    const ast = parse('int32 quark_main() { unsafe { cap<int32> p = null; int32 x = *p; } return 0; }');
    const prog = (0, mir_1.buildMir)(ast);
    node_assert_1.default.ok(prog.bodies.length >= 1);
});
(0, node_test_1.test)('syslevel: cap return type lowers to i32*', () => {
    const ast = parse('cap<int32> quark_main() { return null; }');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('define i32* @quark_main'));
});
(0, node_test_1.test)('syslevel: native emits sideeffect inline asm', () => {
    const ast = parse('int32 quark_main() { unsafe { native("cli"); } return 0; }');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('call void asm sideeffect "cli"'));
});
(0, node_test_1.test)('syslevel: sync builtins emit atomic IR', () => {
    const ast = parse('int32 quark_main() { unsafe { cap<int32> p = null; sync_store(p, 1); int32 x = sync_load(p); int32 y = sync_add(p, 1); int32 z = sync_cas(p, 1, 2); } return 0; }');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('store atomic i32'), 'sync_store');
    node_assert_1.default.ok(ir.includes('load atomic i32'), 'sync_load');
    node_assert_1.default.ok(ir.includes('atomicrmw add'), 'sync_add');
    node_assert_1.default.ok(ir.includes('cmpxchg'), 'sync_cas');
});
(0, node_test_1.test)('syslevel: function attributes emit place/raw', () => {
    const ast = parse('@[place(".text.boot")] @[raw] int32 quark_main() { return 0; }');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('section ".text.boot"'), 'place attribute');
    node_assert_1.default.ok(ir.includes('naked'), 'raw attribute');
});
(0, node_test_1.test)('syslevel: bitwise operators emit or/and/shl/ashr/xor', () => {
    const ast = parse('int32 quark_main() { int32 a = 1 | 2; int32 b = a & 1; int32 c = 1 << 3; int32 d = c >> 1; int32 e = 5 ^ 3; int32 f = ~0; return a + b + c + d + e + f; }');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes(' or '), 'bitwise or');
    node_assert_1.default.ok(ir.includes(' and '), 'bitwise and');
    node_assert_1.default.ok(ir.includes(' shl '), 'shift left');
    node_assert_1.default.ok(ir.includes(' ashr '), 'shift right');
    node_assert_1.default.ok(ir.includes(' xor '), 'xor');
});
(0, node_test_1.test)('syslevel: cap pointer arithmetic emits getelementptr', () => {
    const ast = parse('int32 quark_main() { unsafe { cap<int32> p = null; cap<int32> q = p + 1; } return 0; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'pointer arithmetic is type-safe');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('getelementptr'), 'pointer arithmetic lowers to gep');
});
(0, node_test_1.test)('syslevel: int -> cap emits inttoptr', () => {
    const ast = parse('int32 quark_main() { unsafe { cap<int32> p = 753664; int32 x = *p; } return 0; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'int-to-cap is type-safe');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('inttoptr'), 'int-to-cap lowers to inttoptr');
});
(0, node_test_1.test)('syslevel: address-of emits function symbol', () => {
    const ast = parse('int32 my_handler() { return 1; } int32 quark_main() { unsafe { cap<uint8> h = &my_handler; } return 0; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'address-of is type-safe');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('@my_handler'), 'address-of references function');
});
(0, node_test_1.test)('syslevel: address-of local variable emits alloca pointer', () => {
    const ast = parse('int32 quark_main() { int32 x = 42; unsafe { cap<int32> p = &x; int32 y = *p; } return y; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'address-of local is type-safe');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('alloca i32*'), 'cap<int32> allocates i32* slot for the borrow');
    node_assert_1.default.ok(!ir.includes('@x'), 'local is not treated as a function symbol');
});
(0, node_test_1.test)('syslevel: qk_gc_free and qk_sys_callp emit calls', () => {
    const ast = parse('int32 quark_main() { unsafe { cap<int32> p = qk_gc_alloc(16); qk_gc_free(p); cap<uint8> m = qk_sys_callp(4, 4096, 0, 0); } return 0; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'qk_gc_free/qk_sys_callp are type-safe');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('@qk_gc_free'), 'qk_gc_free emits call');
    node_assert_1.default.ok(ir.includes('@qk_sys_callp'), 'qk_sys_callp emits call');
});
(0, node_test_1.test)('syslevel: route statement generates comparisons and branches', () => {
    const ast = parse('int32 quark_main() { int32 x = 2; int32 r = 0; route (x) { path 1: { r = 10; } path 2: { r = 20; } fallback: { r = 30; } } return r; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'route is type-safe');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('icmp eq'), 'route generates comparisons');
    node_assert_1.default.ok(ir.includes('route_path_'), 'route generates path labels');
});
(0, node_test_1.test)('syslevel: entry function can return any definite type', () => {
    const ast = parse('double quark_main() { return 1.5; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'double return type is accepted');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('define double @quark_main'), 'double return type lowers to double');
});
(0, node_test_1.test)('syslevel: entry function rejects unknown return type', () => {
    const ast = parse('auto quark_main() { return 1; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('definite type')), 'auto return type is rejected');
});
(0, node_test_1.test)('syslevel: spin executes body before checking condition', () => {
    const ast = parse('int32 quark_main() { int32 i = 0; spin { i = i + 1; } while (i < 3); return i; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'spin is type-safe');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('spin_body_'), 'spin generates body label');
    node_assert_1.default.ok(ir.includes('spin_cond_'), 'spin generates condition label');
});
(0, node_test_1.test)('syslevel: fixed value cannot be reassigned', () => {
    const ast = parse('int32 quark_main() { fixed int32 X = 5; X = 6; return X; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('cannot reassign fixed')), 'fixed reassignment is rejected');
});
(0, node_test_1.test)('syslevel: flavor members resolve to integers', () => {
    const ast = parse('flavor Color { RED, GREEN, BLUE } int32 quark_main() { int32 x = GREEN; int32 y = BLUE; return x + y; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'flavor is type-safe');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('quark_main'), 'flavor declaration does not break codegen');
});
(0, node_test_1.test)('syslevel: fuse pattern matching returns matched arm', () => {
    const ast = parse('int32 quark_main() { int32 x = 2; int32 r = fuse (x) { 1: 10, 2: 20, _: 30, }; return r; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.deepStrictEqual(a.errors, [], 'fuse is type-safe');
    const ir = new ir_1.IRGenerator().generate(ast);
    node_assert_1.default.ok(ir.includes('fuse_cmp_'), 'fuse generates comparison labels');
    node_assert_1.default.ok(ir.includes('fuse_arm_'), 'fuse generates arm labels');
});
(0, node_test_1.test)('syslevel: fuse arms must have same type', () => {
    const ast = parse('int32 quark_main() { int32 x = 1; int32 r = fuse (x) { 1: 10, _: 2.5, }; return r; }');
    const a = new semantic_1.SemanticAnalyzer();
    a.analyze(ast);
    node_assert_1.default.ok(a.errors.some(e => e.message.includes('same type')), 'fuse arm type mismatch is rejected');
});
//# sourceMappingURL=syslevel.test.js.map