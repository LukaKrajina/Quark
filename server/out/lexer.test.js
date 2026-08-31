"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const lexer_1 = require("./lexer");
function tokenize(src) {
    const lexer = new lexer_1.Lexer(src);
    const tokens = [];
    for (;;) {
        const t = lexer.getNextToken();
        tokens.push(t);
        if (t.type === lexer_1.TokenType.EOF)
            break;
    }
    return tokens;
}
(0, node_test_1.test)('lexer: keywords and identifiers', () => {
    const tokens = tokenize('let x = 5;');
    node_assert_1.default.strictEqual(tokens[0].type, lexer_1.TokenType.Keyword);
    node_assert_1.default.strictEqual(tokens[0].value, 'let');
    node_assert_1.default.strictEqual(tokens[1].type, lexer_1.TokenType.Identifier);
    node_assert_1.default.strictEqual(tokens[1].value, 'x');
    node_assert_1.default.strictEqual(tokens[2].type, lexer_1.TokenType.Equals);
});
(0, node_test_1.test)('lexer: numbers (int and float)', () => {
    const tokens = tokenize('3 3.14');
    node_assert_1.default.strictEqual(tokens[0].type, lexer_1.TokenType.Number);
    node_assert_1.default.strictEqual(tokens[0].value, '3');
    node_assert_1.default.strictEqual(tokens[1].type, lexer_1.TokenType.Number);
    node_assert_1.default.strictEqual(tokens[1].value, '3.14');
});
(0, node_test_1.test)('lexer: operators', () => {
    const tokens = tokenize('== != <= >= && || ->');
    node_assert_1.default.strictEqual(tokens[0].type, lexer_1.TokenType.EqualsEquals);
    node_assert_1.default.strictEqual(tokens[1].type, lexer_1.TokenType.NotEqual);
    node_assert_1.default.strictEqual(tokens[2].type, lexer_1.TokenType.LessEqual);
    node_assert_1.default.strictEqual(tokens[3].type, lexer_1.TokenType.GreaterEqual);
    node_assert_1.default.strictEqual(tokens[4].type, lexer_1.TokenType.AndAnd);
    node_assert_1.default.strictEqual(tokens[5].type, lexer_1.TokenType.OrOr);
    node_assert_1.default.strictEqual(tokens[6].type, lexer_1.TokenType.Arrow);
});
(0, node_test_1.test)('lexer: string with escape sequences', () => {
    const tokens = tokenize('"a\\"b\\\\c\\nd"');
    node_assert_1.default.strictEqual(tokens[0].type, lexer_1.TokenType.String);
    // 转义后应为 a"b\c 换行 d
    node_assert_1.default.strictEqual(tokens[0].value, 'a"b\\c\nd');
});
(0, node_test_1.test)('lexer: line/column tracking', () => {
    const tokens = tokenize('let x = 1;\nlet y = 2;');
    // 第二个 let 在第 2 行
    node_assert_1.default.strictEqual(tokens[5].line, 2);
});
(0, node_test_1.test)('lexer: throws on unknown character', () => {
    node_assert_1.default.throws(() => tokenize('#'));
});
//# sourceMappingURL=lexer.test.js.map