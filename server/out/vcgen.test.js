"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const lexer_1 = require("./lexer");
const parser_1 = require("./parser");
const vcgen_1 = require("./vcgen");
function obligations(src) {
    const parser = new parser_1.Parser(new lexer_1.Lexer(src));
    const ast = parser.parse();
    return new vcgen_1.VCGenerator().generate(ast);
}
(0, node_test_1.test)('vcgen: function with contracts generates obligations', () => {
    const obs = obligations(`
        int32 abs(int32 x) requires x >= 0 ensures result >= 0 {
            return x;
        }
    `);
    node_assert_1.default.ok(obs.length > 0);
    node_assert_1.default.ok(obs.some(o => o.id.includes('abs')));
});
(0, node_test_1.test)('vcgen: no contracts produces no obligations', () => {
    const obs = obligations('int32 f() { return 0; }');
    node_assert_1.default.strictEqual(obs.length, 0);
});
(0, node_test_1.test)('vcgen: while with invariant produces obligations', () => {
    const obs = obligations(`
        int32 loop(int32 n) ensures result >= 0 {
            int32 i = 0;
            while (i < n) invariant i >= 0 {
                i = i + 1;
            }
            return i;
        }
    `);
    node_assert_1.default.ok(obs.some(o => o.id.includes('while')));
});
(0, node_test_1.test)('vcgen: toProtocol emits OBLIGATION/ANTE/CONSE lines', () => {
    const obs = obligations('int32 f() requires true ensures true { return 0; }');
    const protocol = new vcgen_1.VCGenerator().toProtocol(obs);
    node_assert_1.default.ok(protocol.includes('OBLIGATION'));
    node_assert_1.default.ok(protocol.includes('ANTE'));
    node_assert_1.default.ok(protocol.includes('CONSE'));
});
(0, node_test_1.test)('vcgen: toSmtLib emits check-sat', () => {
    const obs = obligations('int32 f() requires true ensures true { return 0; }');
    const smt = new vcgen_1.VCGenerator().toSmtLib(obs);
    node_assert_1.default.ok(smt.includes('(check-sat)'));
});
//# sourceMappingURL=vcgen.test.js.map