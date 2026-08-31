"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lexer = exports.TokenType = void 0;
var TokenType;
(function (TokenType) {
    TokenType["Let"] = "Let";
    TokenType["Function"] = "Function";
    TokenType["QlmInvoke"] = "QlmInvoke";
    TokenType["EncodeText"] = "EncodeText";
    TokenType["EncodeImage"] = "EncodeImage";
    TokenType["Allocate"] = "Allocate";
    TokenType["Keyword"] = "Keyword";
    TokenType["Identifier"] = "Identifier";
    TokenType["Number"] = "Number";
    TokenType["String"] = "String";
    TokenType["Equals"] = "Equals";
    TokenType["EqualsEquals"] = "EqualsEquals";
    TokenType["OpenBrace"] = "OpenBrace";
    TokenType["OpenParen"] = "OpenParen";
    TokenType["OpenBracket"] = "OpenBracket";
    TokenType["CloseBrace"] = "CloseBrace";
    TokenType["CloseParen"] = "CloseParen";
    TokenType["CloseBracket"] = "CloseBracket";
    TokenType["LessThan"] = "LessThan";
<<<<<<< HEAD
=======
    TokenType["LessEqual"] = "LessEqual";
    TokenType["GreaterThan"] = "GreaterThan";
    TokenType["GreaterEqual"] = "GreaterEqual";
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    TokenType["Plus"] = "Plus";
    TokenType["Minus"] = "Minus";
    TokenType["Star"] = "Star";
    TokenType["Slash"] = "Slash";
    TokenType["Dot"] = "Dot";
    TokenType["Comma"] = "Comma";
    TokenType["Semicolon"] = "Semicolon";
    TokenType["Colon"] = "Colon";
    TokenType["ColonColon"] = "ColonColon";
<<<<<<< HEAD
    TokenType["GreaterThan"] = "GreaterThan";
    TokenType["Ampersand"] = "Ampersand";
=======
    TokenType["Ampersand"] = "Ampersand";
    TokenType["AndAnd"] = "AndAnd";
    TokenType["OrOr"] = "OrOr";
    TokenType["NotEqual"] = "NotEqual";
    TokenType["Bang"] = "Bang";
    TokenType["Arrow"] = "Arrow";
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    TokenType["EOF"] = "EOF";
})(TokenType || (exports.TokenType = TokenType = {}));
class Lexer {
    constructor(input) {
        this.position = 0;
        this.line = 1;
        this.column = 1;
        this.input = '';
        this.input = input;
    }
    currentChar() {
        return this.position < this.input.length ? this.input[this.position] : '\0';
    }
    advance() {
        if (this.input[this.position] === '\n') {
            this.line++;
            this.column = 1;
        }
        else {
            this.column++;
        }
        this.position++;
    }
    skipWhitespaceAndComments() {
        while (this.position < this.input.length) {
            const ch = this.currentChar();
            if (/\s/.test(ch)) {
                this.advance();
            }
            else if (ch == '/' && this.input[this.position + 1] === '/') {
                while (this.currentChar() != '\n' && this.currentChar() !== '\0') {
                    this.advance();
                }
            }
            else {
                break;
            }
        }
    }
    getNextToken() {
        this.skipWhitespaceAndComments();
        const startLine = this.line;
        const startCol = this.column;
        const char = this.currentChar();
        if (char === '\0') {
            return { type: TokenType.EOF, value: '', line: startLine, column: startCol, length: 0 };
        }
        if (char === '=') {
            this.advance();
            if (this.currentChar() === '=') {
                this.advance();
                return { type: TokenType.EqualsEquals, value: '==', line: startLine, column: startCol, length: 2 };
            }
            return { type: TokenType.Equals, value: '=', line: startLine, column: startCol, length: 1 };
        }
<<<<<<< HEAD
=======
        if (char === '!') {
            this.advance();
            if (this.currentChar() === '=') {
                this.advance();
                return { type: TokenType.NotEqual, value: '!=', line: startLine, column: startCol, length: 2 };
            }
            return { type: TokenType.Bang, value: '!', line: startLine, column: startCol, length: 1 };
        }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
        if (char === '(') {
            this.advance();
            return { type: TokenType.OpenParen, value: '(', line: startLine, column: startCol, length: 1 };
        }
        if (char === ')') {
            this.advance();
            return { type: TokenType.CloseParen, value: ')', line: startLine, column: startCol, length: 1 };
        }
        if (char === '{') {
            this.advance();
            return { type: TokenType.OpenBrace, value: '{', line: startLine, column: startCol, length: 1 };
        }
        if (char === '}') {
            this.advance();
            return { type: TokenType.CloseBrace, value: '}', line: startLine, column: startCol, length: 1 };
        }
        if (char === '[') {
            this.advance();
            return { type: TokenType.OpenBracket, value: '[', line: startLine, column: startCol, length: 1 };
        }
        if (char === ']') {
            this.advance();
            return { type: TokenType.CloseBracket, value: ']', line: startLine, column: startCol, length: 1 };
        }
        if (char === '.') {
            this.advance();
            return { type: TokenType.Dot, value: '.', line: startLine, column: startCol, length: 1 };
        }
        if (char === ';') {
            this.advance();
            return { type: TokenType.Semicolon, value: ';', line: startLine, column: startCol, length: 1 };
        }
        if (char === ',') {
            this.advance();
            return { type: TokenType.Comma, value: ',', line: startLine, column: startCol, length: 1 };
        }
        if (char === '<') {
            this.advance();
<<<<<<< HEAD
=======
            if (this.currentChar() === '=') {
                this.advance();
                return { type: TokenType.LessEqual, value: '<=', line: startLine, column: startCol, length: 2 };
            }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
            return { type: TokenType.LessThan, value: '<', line: startLine, column: startCol, length: 1 };
        }
        if (char === '+') {
            this.advance();
            return { type: TokenType.Plus, value: '+', line: startLine, column: startCol, length: 1 };
        }
        if (char === '-') {
            this.advance();
<<<<<<< HEAD
=======
            if (this.currentChar() === '>') {
                this.advance();
                return { type: TokenType.Arrow, value: '->', line: startLine, column: startCol, length: 2 };
            }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
            return { type: TokenType.Minus, value: '-', line: startLine, column: startCol, length: 1 };
        }
        if (char === '*') {
            this.advance();
            return { type: TokenType.Star, value: '*', line: startLine, column: startCol, length: 1 };
        }
        if (char === '/') {
            this.advance();
            return { type: TokenType.Slash, value: '/', line: startLine, column: startCol, length: 1 };
        }
        if (char === '&') {
            this.advance();
<<<<<<< HEAD
            return { type: TokenType.Ampersand, value: '&', line: startLine, column: startCol, length: 1 };
        }
        if (char === '>') {
            this.advance();
=======
            if (this.currentChar() === '&') {
                this.advance();
                return { type: TokenType.AndAnd, value: '&&', line: startLine, column: startCol, length: 2 };
            }
            return { type: TokenType.Ampersand, value: '&', line: startLine, column: startCol, length: 1 };
        }
        if (char === '|') {
            this.advance();
            if (this.currentChar() === '|') {
                this.advance();
                return { type: TokenType.OrOr, value: '||', line: startLine, column: startCol, length: 2 };
            }
            throw new Error(`Lexer Error: Unknown character: |`);
        }
        if (char === '>') {
            this.advance();
            if (this.currentChar() === '=') {
                this.advance();
                return { type: TokenType.GreaterEqual, value: '>=', line: startLine, column: startCol, length: 2 };
            }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
            return { type: TokenType.GreaterThan, value: '>', line: startLine, column: startCol, length: 1 };
        }
        if (char === ':') {
            this.advance();
            if (this.currentChar() === ':') {
                this.advance();
                return { type: TokenType.ColonColon, value: '::', line: startLine, column: startCol, length: 2 };
            }
            return { type: TokenType.Colon, value: ':', line: startLine, column: startCol, length: 1 };
        }
        if (char === '"' || char === "'") {
            const quoteType = char;
            let strVal = '';
            this.advance();
            while (this.currentChar() !== quoteType && this.currentChar() !== '\0') {
<<<<<<< HEAD
                strVal += this.currentChar();
                this.advance();
=======
                if (this.currentChar() === '\\') {
                    // 转义序列:支持常见转义,使字符串字面量能安全容纳任意字符
                    this.advance();
                    const esc = this.currentChar();
                    if (esc === 'n')
                        strVal += '\n';
                    else if (esc === 't')
                        strVal += '\t';
                    else if (esc === 'r')
                        strVal += '\r';
                    else if (esc === '\\')
                        strVal += '\\';
                    else if (esc === '"')
                        strVal += '"';
                    else if (esc === "'")
                        strVal += "'";
                    else if (esc === '0')
                        strVal += '\0';
                    else
                        strVal += esc;
                    this.advance();
                }
                else {
                    strVal += this.currentChar();
                    this.advance();
                }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
            }
            this.advance();
            return {
                type: TokenType.String,
                value: strVal,
                line: startLine,
                column: startCol,
                length: strVal.length + 2
            };
        }
        if (/[0-9]/.test(char)) {
            let numStr = '';
            while (/[0-9\.]/.test(this.currentChar())) {
                numStr += this.currentChar();
                this.advance();
            }
            return {
                type: TokenType.Number,
                value: numStr,
                line: startLine,
                column: startCol,
                length: numStr.length
            };
        }
        if (/[\p{L}_]/u.test(char)) {
            let idStr = '';
            while (/[\p{L}\p{N}_]/u.test(this.currentChar())) {
                idStr += this.currentChar();
                this.advance();
            }
            const keywords = [
                'let', 'auto', 'int', 'new', 'return', 'if', 'else',
                'while', 'int8', 'int16', 'int32', 'int64',
                'uint8', 'uint16', 'uint32', 'uint64',
                'float', 'double', 'string', 'char', 'Qubit', 'QObject', 'QModel',
                'alloc', 'measure', 'encode_text', 'encode_image', 'qlm_invoke',
                'qlm_load', 'qk_encode_string', 'qlm_forward', 'qk_decode_string',
                'DiracState', 'BellState', 'QuantumRegister',
                'mind_read', 'mind_train', 'mind_feedback',
                'veda_qlm_train',
<<<<<<< HEAD
                'h', 'x', 'rz', 'cnot', 'toffoli', 'swap', 'qft', 'braid',
                'measure_x', 'measure_y',
                'mod', 'use', 'pub', 'form', 'impl', 'trait', 'template', 'rank', 'self', 'for',
                'export', 'import', 'requires', 'from',
                'surrogate', 'tanh_quantize', 'lif_step',
                'mellowmax2', 'logsumexp2', 'boltzmann2',
                'tnorm_luk', 'tnorm_prod', 'tnorm_godel',
                'polymer_weight', 'polymer_mix_bound'
=======
                // 量子门（h/x/rz/cnot/toffoli/swap/qft/braid/measure_x/measure_y）
                // 已从关键字表移除：它们在语句位置（h(q)）由 parser 的 Identifier
                // 分支识别为函数调用，在表达式位置（x * x）识别为普通标识符。
                'mod', 'use', 'pub', 'form', 'impl', 'trait', 'template', 'rank', 'self', 'for',
                'break', 'continue',
                'fn',
                'export', 'import', 'requires', 'ensures', 'invariant', 'result', 'from',
                'surrogate', 'tanh_quantize', 'lif_step',
                'mellowmax2', 'logsumexp2', 'boltzmann2',
                'tnorm_luk', 'tnorm_prod', 'tnorm_godel',
                'polymer_weight', 'polymer_mix_bound',
                // QCOS syscall ABI + 堆分配
                'make', 'qk_sys_call', 'qk_sys_calld', 'qk_sys_log', 'qk_sys_logi'
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
            ];
            if (keywords.includes(idStr)) {
                return { type: TokenType.Keyword, value: idStr, line: startLine, column: startCol, length: idStr.length };
            }
            return { type: TokenType.Identifier, value: idStr, line: startLine, column: startCol, length: idStr.length };
        }
        throw new Error(`Lexer Error: Unknown character: ${char}`);
    }
}
exports.Lexer = Lexer;
//# sourceMappingURL=lexer.js.map