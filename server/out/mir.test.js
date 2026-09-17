"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const lexer_1 = require("./lexer");
const parser_1 = require("./parser");
const mir_1 = require("./mir");
function build(src) {
    const parser = new parser_1.Parser(new lexer_1.Lexer(src));
    const ast = parser.parse();
    const prog = (0, mir_1.buildMir)(ast);
    node_assert_1.default.ok(prog.bodies.length >= 1, 'expect at least one body');
    return prog.bodies[0];
}
function count(body, kind) {
    return body.blocks.filter(b => b.terminator?.kind === kind).length;
}
(0, node_test_1.test)('mir: Qubit local is marked linear, int32 is not', () => {
    const body = build('int32 quark_main() { auto q = alloc(); int32 x = 1; return 0; }');
    const q = body.locals.find(l => l.name === 'q');
    const x = body.locals.find(l => l.name === 'x');
    node_assert_1.default.ok(q, 'q local exists');
    node_assert_1.default.ok(x, 'x local exists');
    node_assert_1.default.strictEqual(q.linear, true, 'Qubit is linear');
    node_assert_1.default.strictEqual(x.linear, false, 'int32 is not linear');
});
(0, node_test_1.test)('mir: if/else produces a single SwitchInt', () => {
    const body = build('int32 quark_main() { int32 x = 1; if (x == 1) { x = 2; } else { x = 3; } return x; }');
    node_assert_1.default.strictEqual(count(body, 'SwitchInt'), 1);
    node_assert_1.default.strictEqual(count(body, 'Return'), 1);
});
(0, node_test_1.test)('mir: else-if chain nests as one SwitchInt per if', () => {
    const body = build('int32 quark_main() { int32 x = 1; int32 r = 0; ' +
        'if (x == 0) { r = 1; } else if (x == 1) { r = 2; } else { r = 3; } return r; }');
    // 两个 if（外层 + 内层 else-if）各产生一个 SwitchInt
    node_assert_1.default.strictEqual(count(body, 'SwitchInt'), 2);
});
(0, node_test_1.test)('mir: logical AND short-circuit produces branching', () => {
    const body = build('int32 quark_main() { int32 a = 1; int32 b = 2; int32 c = a < 1 && b > 2; return 0; }');
    // a < 1 的比较用 SwitchInt 实现短回路，故至少 1 个
    node_assert_1.default.ok(count(body, 'SwitchInt') >= 1);
});
(0, node_test_1.test)('mir: while produces loop via SwitchInt + backedge Goto', () => {
    const body = build('int32 quark_main() { int32 i = 0; while (i < 10) { i = i + 1; } return i; }');
    node_assert_1.default.strictEqual(count(body, 'SwitchInt'), 1);
    node_assert_1.default.ok(count(body, 'Goto') >= 2, 'cond entry + backedge');
});
(0, node_test_1.test)('mir: for with break/continue routes to correct targets', () => {
    const body = build('int32 quark_main() { int32 i = 0; for (i = 0; i < 10; i = i + 1) { if (i == 5) { continue; } if (i == 8) { break; } } return i; }');
    // 1 个 for 的 SwitchInt + 2 个 if 的 SwitchInt
    node_assert_1.default.ok(count(body, 'SwitchInt') >= 3);
});
(0, node_test_1.test)('mir: return produces Return terminator', () => {
    const body = build('int32 quark_main() { return 7; }');
    node_assert_1.default.strictEqual(count(body, 'Return'), 1);
});
(0, node_test_1.test)('mir: all blocks terminated (well-formed CFG)', () => {
    const body = build('int32 quark_main() { int32 x = 1; int32 r = 0; ' +
        'while (x < 3) { x = x + 1; if (x == 2) { r = r + 1; } } return r; }');
    for (const b of body.blocks) {
        node_assert_1.default.notStrictEqual(b.terminator, null, `block ${b.id} must have a terminator`);
    }
});
//# sourceMappingURL=mir.test.js.map