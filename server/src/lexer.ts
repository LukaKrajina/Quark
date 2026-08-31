<<<<<<< HEAD
export enum TokenType {
    Let = "Let",
    Function = "Function",
    QlmInvoke = "QlmInvoke",
    EncodeText = "EncodeText",
    EncodeImage = "EncodeImage",
    Allocate = "Allocate",
    Keyword = 'Keyword',
    Identifier = 'Identifier',
    Number = 'Number',
    String = 'String',
    Equals = 'Equals',
    EqualsEquals = 'EqualsEquals',
    OpenBrace = 'OpenBrace',
    OpenParen = "OpenParen",
    OpenBracket = "OpenBracket",
    CloseBrace = 'CloseBrace',
    CloseParen = 'CloseParen',
    CloseBracket = "CloseBracket",
    LessThan = 'LessThan',
    Plus = 'Plus',
    Minus = 'Minus',
    Star = 'Star',
    Slash = 'Slash',
    Dot = 'Dot',
    Comma = 'Comma',
    Semicolon = 'Semicolon',
    Colon = 'Colon',
    ColonColon = 'ColonColon',
    GreaterThan = 'GreaterThan',
    Ampersand = 'Ampersand',
    EOF = 'EOF'
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
    length: number;
}

export class Lexer {
    private position: number = 0;
    private line: number = 1;
    private column: number = 1;
    private input: string = '';

    constructor(input: string) {
        this.input = input;
    }

    private currentChar(): string {
        return this.position < this.input.length ? this.input[this.position] : '\0';
    }

    private advance(): void {
        if (this.input[this.position] === '\n') {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
        this.position++;
    }

    private skipWhitespaceAndComments(): void {
        while (this.position < this.input.length){
            const ch = this.currentChar();
            if (/\s/.test(ch)){
                this.advance();
            } else if(ch == '/' && this.input[this.position + 1] === '/') {
                while (this.currentChar() != '\n' && this.currentChar() !== '\0'){
                    this.advance();
                }
            } else {
                break;
            }
        }
    }

    public getNextToken(): Token {
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
        
        if (char === '(') { this.advance(); return { type: TokenType.OpenParen, value: '(', line: startLine, column: startCol, length: 1 }; }
        if (char === ')') { this.advance(); return { type: TokenType.CloseParen, value: ')', line: startLine, column: startCol, length: 1 }; }
        if (char === '{') { this.advance(); return { type: TokenType.OpenBrace, value: '{', line: startLine, column: startCol, length: 1 }; }
        if (char === '}') { this.advance(); return { type: TokenType.CloseBrace, value: '}', line: startLine, column: startCol, length: 1 }; }
        if (char === '[') { this.advance(); return { type: TokenType.OpenBracket, value: '[', line: startLine, column: startCol, length: 1 }; }
        if (char === ']') { this.advance(); return { type: TokenType.CloseBracket, value: ']', line: startLine, column: startCol, length: 1 }; }
        if (char === '.') { this.advance(); return { type: TokenType.Dot, value: '.', line: startLine, column: startCol, length: 1 }; }
        if (char === ';') { this.advance(); return { type: TokenType.Semicolon, value: ';', line: startLine, column: startCol, length: 1 }; }
        if (char === ',') { this.advance(); return { type: TokenType.Comma, value: ',', line: startLine, column: startCol, length: 1 }; }
        if (char === '<') { this.advance(); return { type: TokenType.LessThan, value: '<', line: startLine, column: startCol, length: 1 }; }
        if (char === '+') { this.advance(); return { type: TokenType.Plus, value: '+', line: startLine, column: startCol, length: 1 }; }
        if (char === '-') { this.advance(); return { type: TokenType.Minus, value: '-', line: startLine, column: startCol, length: 1 }; }
        if (char === '*') { this.advance(); return { type: TokenType.Star, value: '*', line: startLine, column: startCol, length: 1 }; }
        if (char === '/') { this.advance(); return { type: TokenType.Slash, value: '/', line: startLine, column: startCol, length: 1 }; }
        if (char === '&') { this.advance(); return { type: TokenType.Ampersand, value: '&', line: startLine, column: startCol, length: 1 }; }
        if (char === '>') { this.advance(); return { type: TokenType.GreaterThan, value: '>', line: startLine, column: startCol, length: 1 }; }

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
                strVal += this.currentChar();
                this.advance();
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
                'h', 'x', 'rz', 'cnot', 'toffoli', 'swap', 'qft', 'braid',
                'measure_x', 'measure_y',
                'mod', 'use', 'pub', 'form', 'impl', 'trait', 'template', 'rank', 'self', 'for',
                'export', 'import', 'requires', 'from',
                'surrogate', 'tanh_quantize', 'lif_step',
                'mellowmax2', 'logsumexp2', 'boltzmann2',
                'tnorm_luk', 'tnorm_prod', 'tnorm_godel',
                'polymer_weight', 'polymer_mix_bound'
            ];

            if (keywords.includes(idStr)) {
                return { type: TokenType.Keyword, value: idStr, line: startLine, column: startCol, length: idStr.length };
            }
            return { type: TokenType.Identifier, value: idStr, line: startLine, column: startCol, length: idStr.length };
        }

        throw new Error(`Lexer Error: Unknown character: ${char}`);
    }
=======
export enum TokenType {
    Let = "Let",
    Function = "Function",
    QlmInvoke = "QlmInvoke",
    EncodeText = "EncodeText",
    EncodeImage = "EncodeImage",
    Allocate = "Allocate",
    Keyword = 'Keyword',
    Identifier = 'Identifier',
    Number = 'Number',
    String = 'String',
    Equals = 'Equals',
    EqualsEquals = 'EqualsEquals',
    OpenBrace = 'OpenBrace',
    OpenParen = "OpenParen",
    OpenBracket = "OpenBracket",
    CloseBrace = 'CloseBrace',
    CloseParen = 'CloseParen',
    CloseBracket = "CloseBracket",
    LessThan = 'LessThan',
    LessEqual = 'LessEqual',
    GreaterThan = 'GreaterThan',
    GreaterEqual = 'GreaterEqual',
    Plus = 'Plus',
    Minus = 'Minus',
    Star = 'Star',
    Slash = 'Slash',
    Dot = 'Dot',
    Comma = 'Comma',
    Semicolon = 'Semicolon',
    Colon = 'Colon',
    ColonColon = 'ColonColon',
    Ampersand = 'Ampersand',
    AndAnd = 'AndAnd',
    OrOr = 'OrOr',
    NotEqual = 'NotEqual',
    Bang = 'Bang',
    Arrow = 'Arrow',
    EOF = 'EOF'
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
    length: number;
}

export class Lexer {
    private position: number = 0;
    private line: number = 1;
    private column: number = 1;
    private input: string = '';

    constructor(input: string) {
        this.input = input;
    }

    private currentChar(): string {
        return this.position < this.input.length ? this.input[this.position] : '\0';
    }

    private advance(): void {
        if (this.input[this.position] === '\n') {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
        this.position++;
    }

    private skipWhitespaceAndComments(): void {
        while (this.position < this.input.length){
            const ch = this.currentChar();
            if (/\s/.test(ch)){
                this.advance();
            } else if(ch == '/' && this.input[this.position + 1] === '/') {
                while (this.currentChar() != '\n' && this.currentChar() !== '\0'){
                    this.advance();
                }
            } else {
                break;
            }
        }
    }

    public getNextToken(): Token {
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

        if (char === '!') {
            this.advance();
            if (this.currentChar() === '=') {
                this.advance();
                return { type: TokenType.NotEqual, value: '!=', line: startLine, column: startCol, length: 2 };
            }
            return { type: TokenType.Bang, value: '!', line: startLine, column: startCol, length: 1 };
        }
        
        if (char === '(') { this.advance(); return { type: TokenType.OpenParen, value: '(', line: startLine, column: startCol, length: 1 }; }
        if (char === ')') { this.advance(); return { type: TokenType.CloseParen, value: ')', line: startLine, column: startCol, length: 1 }; }
        if (char === '{') { this.advance(); return { type: TokenType.OpenBrace, value: '{', line: startLine, column: startCol, length: 1 }; }
        if (char === '}') { this.advance(); return { type: TokenType.CloseBrace, value: '}', line: startLine, column: startCol, length: 1 }; }
        if (char === '[') { this.advance(); return { type: TokenType.OpenBracket, value: '[', line: startLine, column: startCol, length: 1 }; }
        if (char === ']') { this.advance(); return { type: TokenType.CloseBracket, value: ']', line: startLine, column: startCol, length: 1 }; }
        if (char === '.') { this.advance(); return { type: TokenType.Dot, value: '.', line: startLine, column: startCol, length: 1 }; }
        if (char === ';') { this.advance(); return { type: TokenType.Semicolon, value: ';', line: startLine, column: startCol, length: 1 }; }
        if (char === ',') { this.advance(); return { type: TokenType.Comma, value: ',', line: startLine, column: startCol, length: 1 }; }
        if (char === '<') {
            this.advance();
            if (this.currentChar() === '=') {
                this.advance();
                return { type: TokenType.LessEqual, value: '<=', line: startLine, column: startCol, length: 2 };
            }
            return { type: TokenType.LessThan, value: '<', line: startLine, column: startCol, length: 1 };
        }
        if (char === '+') { this.advance(); return { type: TokenType.Plus, value: '+', line: startLine, column: startCol, length: 1 }; }
        if (char === '-') {
            this.advance();
            if (this.currentChar() === '>') {
                this.advance();
                return { type: TokenType.Arrow, value: '->', line: startLine, column: startCol, length: 2 };
            }
            return { type: TokenType.Minus, value: '-', line: startLine, column: startCol, length: 1 };
        }
        if (char === '*') { this.advance(); return { type: TokenType.Star, value: '*', line: startLine, column: startCol, length: 1 }; }
        if (char === '/') { this.advance(); return { type: TokenType.Slash, value: '/', line: startLine, column: startCol, length: 1 }; }
        if (char === '&') {
            this.advance();
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
                if (this.currentChar() === '\\') {
                    // 转义序列:支持常见转义,使字符串字面量能安全容纳任意字符
                    this.advance();
                    const esc = this.currentChar();
                    if (esc === 'n') strVal += '\n';
                    else if (esc === 't') strVal += '\t';
                    else if (esc === 'r') strVal += '\r';
                    else if (esc === '\\') strVal += '\\';
                    else if (esc === '"') strVal += '"';
                    else if (esc === "'") strVal += "'";
                    else if (esc === '0') strVal += '\0';
                    else strVal += esc;
                    this.advance();
                } else {
                    strVal += this.currentChar();
                    this.advance();
                }
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
            ];

            if (keywords.includes(idStr)) {
                return { type: TokenType.Keyword, value: idStr, line: startLine, column: startCol, length: idStr.length };
            }
            return { type: TokenType.Identifier, value: idStr, line: startLine, column: startCol, length: idStr.length };
        }

        throw new Error(`Lexer Error: Unknown character: ${char}`);
    }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}