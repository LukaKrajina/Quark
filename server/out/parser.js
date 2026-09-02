"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = void 0;
const lexer_1 = require("./lexer");
const ALLOWED_TYPES = [
    'let', 'auto', 'int', 'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'float', 'double', 'string', 'char', 'Qubit', 'QObject', 'QModel',
    'DiracState', 'BellState', 'QuantumRegister'
];
const BUILTIN_FUNCTIONS = [
    'alloc', 'measure', 'encode_text', 'qlm_invoke',
    'qlm_load', 'qk_encode_string', 'qlm_forward', 'qk_decode_string',
    'mind_read', 'mind_train', 'mind_feedback',
    'veda_qlm_train',
    'surrogate', 'tanh_quantize', 'lif_step',
    'mellowmax2', 'logsumexp2', 'boltzmann2',
    'tnorm_luk', 'tnorm_prod', 'tnorm_godel',
    'polymer_weight', 'polymer_mix_bound',
    'qk_sys_call', 'qk_sys_calld', 'qk_sys_log', 'qk_sys_logi'
];
class Parser {
    constructor(lexer) {
        this.lookahead = null;
        this.lexer = lexer;
        this.currentToken = this.lexer.getNextToken();
    }
    advance() {
        const token = this.currentToken;
        if (this.lookahead) {
            this.currentToken = this.lookahead;
            this.lookahead = null;
        }
        else {
            this.currentToken = this.lexer.getNextToken();
        }
        return token;
    }
    peek() {
        if (!this.lookahead) {
            this.lookahead = this.lexer.getNextToken();
        }
        return this.lookahead;
    }
    eat(type) {
        const token = this.currentToken;
        if (this.currentToken.type === type) {
            this.advance();
            return token;
        }
        else {
            throw new Error(`Parser Error: Expected ${type}, found ${this.currentToken.type} ('${this.currentToken.value}') at line ${this.currentToken.line}, col ${this.currentToken.column}`);
        }
    }
    isKeyword(value) {
        return this.currentToken.type === lexer_1.TokenType.Keyword && this.currentToken.value === value;
    }
    eatKeyword(value) {
        if (!this.isKeyword(value)) {
            throw new Error(`Parser Error: Expected keyword '${value}', found '${this.currentToken.value}' at line ${this.currentToken.line}, col ${this.currentToken.column}`);
        }
        return this.advance();
    }
    eatIdentifierOrKeyword() {
        const token = this.currentToken;
        if (token.type === lexer_1.TokenType.Identifier || token.type === lexer_1.TokenType.Keyword) {
            this.advance();
            return token;
        }
        throw new Error(`Parser Error: Expected identifier, found ${token.type} ('${token.value}') at line ${token.line}, col ${token.column}`);
    }
    parse() {
        const startLine = this.currentToken.line;
        const startCol = this.currentToken.column;
        const program = {
            type: 'Program',
            body: [],
            line: startLine,
            column: startCol,
            length: 0
        };
        while (this.currentToken.type !== lexer_1.TokenType.EOF) {
            program.body.push(this.parseTopLevelItem());
        }
        return program;
    }
    parseTopLevelItem() {
        if (this.isKeyword('mod'))
            return this.parseModule();
        if (this.isKeyword('use'))
            return this.parseUse();
        if (this.isKeyword('form'))
            return this.parseForm(false, false);
        if (this.isKeyword('impl'))
            return this.parseImpl();
        if (this.isKeyword('trait'))
            return this.parseTrait(false, false);
        if (this.isKeyword('template'))
            return this.parseTemplate();
        if (this.isKeyword('import'))
            return this.parseImport();
        if (this.isKeyword('requires'))
            return this.parseRequires();
        if (this.isKeyword('export')) {
            this.eatKeyword('export');
            if (this.isKeyword('form'))
                return this.parseForm(false, true);
            if (this.isKeyword('trait'))
                return this.parseTrait(false, true);
            return this.parseDeclarationOrFunction(false, true);
        }
        if (this.isKeyword('pub')) {
            this.eatKeyword('pub');
            if (this.isKeyword('form'))
                return this.parseForm(true, false);
            if (this.isKeyword('trait'))
                return this.parseTrait(true, false);
            if (this.isKeyword('mod'))
                return this.parseModule();
            return this.parseDeclarationOrFunction(true, false);
        }
        return this.parseStatement();
    }
    parseImport() {
        const importToken = this.eatKeyword('import');
        const alias = this.eatIdentifierOrKeyword().value;
        this.eatKeyword('from');
        const pathToken = this.eat(lexer_1.TokenType.String);
        this.consumeOptionalSemicolon();
        return {
            type: 'ImportDecl',
            alias: alias,
            path: pathToken.value,
            line: importToken.line,
            column: importToken.column,
            length: pathToken.value.length + 2
        };
    }
    parseRequires() {
        const requiresToken = this.eatKeyword('requires');
        const segs = [this.eatIdentifierOrKeyword().value];
        while (this.currentToken.type === lexer_1.TokenType.Dot) {
            this.eat(lexer_1.TokenType.Dot);
            segs.push(this.eatIdentifierOrKeyword().value);
        }
        this.consumeOptionalSemicolon();
        const permission = segs.join('.');
        return {
            type: 'RequiresDecl',
            permission: permission,
            line: requiresToken.line,
            column: requiresToken.column,
            length: permission.length
        };
    }
    parseStatement() {
        const tokenType = this.currentToken.type;
        const tokenValue = this.currentToken.value;
        if (tokenType === lexer_1.TokenType.Keyword && ALLOWED_TYPES.includes(tokenValue)) {
            return this.parseDeclarationOrFunction(false);
        }
        if (tokenType === lexer_1.TokenType.Identifier && this.peek().type === lexer_1.TokenType.Identifier) {
            return this.parseDeclarationOrFunction(false);
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'while') {
            return this.parseWhileStatement();
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'for') {
            return this.parseForStatement();
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'break') {
            const breakToken = this.eat(lexer_1.TokenType.Keyword);
            this.consumeOptionalSemicolon();
            return {
                type: 'BreakStatement',
                line: breakToken.line,
                column: breakToken.column,
                length: breakToken.length
            };
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'continue') {
            const contToken = this.eat(lexer_1.TokenType.Keyword);
            this.consumeOptionalSemicolon();
            return {
                type: 'ContinueStatement',
                line: contToken.line,
                column: contToken.column,
                length: contToken.length
            };
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'return') {
            return this.parseReturnStatement();
        }
        const isBuiltinCall = tokenType === lexer_1.TokenType.Keyword && BUILTIN_FUNCTIONS.includes(tokenValue);
        if (tokenType === lexer_1.TokenType.Identifier || isBuiltinCall) {
            const expr = this.parseExpression();
            if (this.currentToken.type === lexer_1.TokenType.Equals) {
                this.eat(lexer_1.TokenType.Equals);
                const value = this.parseExpression();
                this.consumeOptionalSemicolon();
                return {
                    type: 'AssignmentStatement',
                    name: expr.type === 'MemberExpression' ? '' : expr.name,
                    target: expr.type === 'MemberExpression' ? expr : undefined,
                    value: value,
                    line: expr.line,
                    column: expr.column,
                    length: value.column + value.length - expr.column
                };
            }
            this.consumeOptionalSemicolon();
            return {
                type: 'ExpressionStatement',
                expression: expr,
                line: expr.line,
                column: expr.column,
                length: expr.length
            };
        }
        throw new Error(`Parser Error: Unexpected token '${this.currentToken.value}' at line ${this.currentToken.line}, col ${this.currentToken.column}`);
    }
    parseDeclarationOrFunction(isPub, isExport = false) {
        const typeToken = this.eatIdentifierOrKeyword();
        let varType = typeToken.value;
        if (varType === 'let' || varType === 'auto')
            varType = 'auto';
        const idToken = this.eatIdentifierOrKeyword();
        const identifier = idToken.value;
        if (this.currentToken.type === lexer_1.TokenType.OpenParen) {
            const { receiver, params } = this.parseFunctionParams();
            const requires = [];
            const ensures = [];
            while (this.isKeyword('requires') || this.isKeyword('ensures')) {
                const isEnsures = this.isKeyword('ensures');
                this.eat(lexer_1.TokenType.Keyword);
                const cond = this.parseExpression();
                this.consumeOptionalSemicolon();
                if (isEnsures)
                    ensures.push(cond);
                else
                    requires.push(cond);
            }
            this.eat(lexer_1.TokenType.OpenBrace);
            const body = this.parseBlock();
            return {
                type: 'FunctionDeclaration',
                returnType: varType,
                name: identifier,
                params: params,
                receiver: receiver,
                isPub: isPub,
                isExport: isExport,
                requires: requires,
                ensures: ensures,
                body: body,
                line: typeToken.line,
                column: typeToken.column,
                length: this.currentToken.column - typeToken.column
            };
        }
        this.eat(lexer_1.TokenType.Equals);
        const value = this.parseExpression();
        this.consumeOptionalSemicolon();
        return {
            type: 'VariableDeclaration',
            varType: varType,
            identifier: identifier,
            value: value,
            line: typeToken.line,
            column: typeToken.column,
            length: value.column + value.length - typeToken.column
        };
    }
    parseReturnStatement() {
        const retToken = this.eat(lexer_1.TokenType.Keyword);
        const value = this.parseExpression();
        this.consumeOptionalSemicolon();
        return {
            type: 'ReturnStatement',
            argument: value,
            line: retToken.line,
            column: retToken.column,
            length: value.column + value.length - retToken.column
        };
    }
    parseWhileStatement() {
        const whileToken = this.eat(lexer_1.TokenType.Keyword);
        this.eat(lexer_1.TokenType.OpenParen);
        const condition = this.parseExpression();
        this.eat(lexer_1.TokenType.CloseParen);
        const invariant = [];
        while (this.isKeyword('invariant')) {
            this.eat(lexer_1.TokenType.Keyword);
            invariant.push(this.parseExpression());
            this.consumeOptionalSemicolon();
        }
        this.eat(lexer_1.TokenType.OpenBrace);
        const body = this.parseBlock();
        const closeBrace = this.currentToken;
        let elseBody;
        if (this.isKeyword('else')) {
            this.eatKeyword('else');
            this.eat(lexer_1.TokenType.OpenBrace);
            elseBody = this.parseBlock();
        }
        return {
            type: 'WhileStatement',
            condition: condition,
            body: body,
            elseBody: elseBody,
            invariant: invariant,
            line: whileToken.line,
            column: whileToken.column,
            length: closeBrace.column - whileToken.column
        };
    }
    parseForStatement() {
        const forToken = this.eat(lexer_1.TokenType.Keyword);
        this.eat(lexer_1.TokenType.OpenParen);
        let init = null;
        if (this.currentToken.type !== lexer_1.TokenType.Semicolon) {
            init = this.parseForClauseStatement();
        }
        this.eat(lexer_1.TokenType.Semicolon);
        let condition = null;
        if (this.currentToken.type !== lexer_1.TokenType.Semicolon) {
            condition = this.parseExpression();
        }
        this.eat(lexer_1.TokenType.Semicolon);
        let update = null;
        if (this.currentToken.type !== lexer_1.TokenType.CloseParen) {
            update = this.parseForClauseStatement();
        }
        this.eat(lexer_1.TokenType.CloseParen);
        this.eat(lexer_1.TokenType.OpenBrace);
        const body = this.parseBlock();
        return {
            type: 'ForStatement',
            init: init,
            condition: condition,
            update: update,
            body: body,
            line: forToken.line,
            column: forToken.column,
            length: this.currentToken.column - forToken.column
        };
    }
    parseForClauseStatement() {
        const tokenType = this.currentToken.type;
        const tokenValue = this.currentToken.value;
        if (tokenType === lexer_1.TokenType.Keyword && ALLOWED_TYPES.includes(tokenValue)) {
            const typeToken = this.eatIdentifierOrKeyword();
            const varType = (typeToken.value === 'let' || typeToken.value === 'auto') ? 'auto' : typeToken.value;
            const idToken = this.eatIdentifierOrKeyword();
            this.eat(lexer_1.TokenType.Equals);
            const value = this.parseExpression();
            return {
                type: 'VariableDeclaration',
                varType: varType,
                identifier: idToken.value,
                value: value,
                line: typeToken.line,
                column: typeToken.column,
                length: value.column + value.length - typeToken.column
            };
        }
        const expr = this.parseExpression();
        this.eat(lexer_1.TokenType.Equals);
        const value = this.parseExpression();
        return {
            type: 'AssignmentStatement',
            name: expr.type === 'MemberExpression' ? '' : expr.name,
            target: expr.type === 'MemberExpression' ? expr : undefined,
            value: value,
            line: expr.line,
            column: expr.column,
            length: value.column + value.length - expr.column
        };
    }
    parseBlock() {
        const body = [];
        while (this.currentToken.type !== lexer_1.TokenType.CloseBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
            body.push(this.parseStatement());
        }
        this.eat(lexer_1.TokenType.CloseBrace);
        return body;
    }
    parseExpression() {
        return this.parseLogical();
    }
    parseLogical() {
        let left = this.parseAdditive();
        while (this.currentToken.type === lexer_1.TokenType.AndAnd ||
            this.currentToken.type === lexer_1.TokenType.OrOr) {
            const opToken = this.advance();
            const right = this.parseAdditive();
            left = {
                type: 'LogicalExpression',
                operator: opToken.value,
                left: left,
                right: right,
                line: left.line,
                column: left.column,
                length: right.column + right.length - left.column
            };
        }
        return left;
    }
    parseAdditive() {
        let left = this.parseMultiplicative();
        while (this.currentToken.type === lexer_1.TokenType.Plus ||
            this.currentToken.type === lexer_1.TokenType.Minus ||
            this.currentToken.type === lexer_1.TokenType.LessThan ||
            this.currentToken.type === lexer_1.TokenType.LessEqual ||
            this.currentToken.type === lexer_1.TokenType.GreaterThan ||
            this.currentToken.type === lexer_1.TokenType.GreaterEqual ||
            this.currentToken.type === lexer_1.TokenType.EqualsEquals ||
            this.currentToken.type === lexer_1.TokenType.NotEqual) {
            const opToken = this.advance();
            const right = this.parseMultiplicative();
            left = {
                type: 'BinaryExpression',
                operator: opToken.value,
                left: left,
                right: right,
                line: left.line,
                column: left.column,
                length: right.column + right.length - left.column
            };
        }
        return left;
    }
    parseMultiplicative() {
        let left = this.parseUnary();
        while (this.currentToken.type === lexer_1.TokenType.Star ||
            this.currentToken.type === lexer_1.TokenType.Slash) {
            const opToken = this.advance();
            const right = this.parseUnary();
            left = {
                type: 'BinaryExpression',
                operator: opToken.value,
                left: left,
                right: right,
                line: left.line,
                column: left.column,
                length: right.column + right.length - left.column
            };
        }
        return left;
    }
    parseUnary() {
        if (this.currentToken.type === lexer_1.TokenType.Bang ||
            this.currentToken.type === lexer_1.TokenType.Minus) {
            const opToken = this.advance();
            const argument = this.parseUnary();
            return {
                type: 'UnaryExpression',
                operator: opToken.value,
                argument: argument,
                line: opToken.line,
                column: opToken.column,
                length: argument.column + argument.length - opToken.column
            };
        }
        return this.parsePrimary();
    }
    parsePrimary() {
        const token = this.currentToken;
        let left;
        if (token.type === lexer_1.TokenType.OpenParen) {
            this.eat(lexer_1.TokenType.OpenParen);
            const inner = this.parseExpression();
            this.eat(lexer_1.TokenType.CloseParen);
            return inner;
        }
        if (token.type === lexer_1.TokenType.Number) {
            const numToken = this.eat(lexer_1.TokenType.Number);
            left = {
                type: 'NumberLiteral',
                value: Number(numToken.value),
                line: numToken.line,
                column: numToken.column,
                length: numToken.length
            };
        }
        else if (token.type === lexer_1.TokenType.String) {
            const strToken = this.eat(lexer_1.TokenType.String);
            left = {
                type: 'StringLiteral',
                value: strToken.value,
                line: strToken.line,
                column: strToken.column,
                length: strToken.length
            };
        }
        else if (token.type === lexer_1.TokenType.Keyword && token.value === 'new') {
            const newToken = this.eat(lexer_1.TokenType.Keyword);
            let className = this.eatIdentifierOrKeyword().value;
            while (this.currentToken.type === lexer_1.TokenType.ColonColon) {
                this.eat(lexer_1.TokenType.ColonColon);
                className += '::' + this.eatIdentifierOrKeyword().value;
            }
            if (this.currentToken.type === lexer_1.TokenType.LessThan) {
                this.eat(lexer_1.TokenType.LessThan);
                const typeArg = this.parseTypeRef();
                className += '<' + typeArg + '>';
                this.eat(lexer_1.TokenType.GreaterThan);
            }
            const args = this.parseArgs();
            const closeParen = this.currentToken;
            left = {
                type: 'NewExpression',
                className,
                arguments: args,
                line: newToken.line,
                column: newToken.column,
                length: closeParen.column - newToken.column
            };
        }
        else if (token.type === lexer_1.TokenType.Keyword && token.value === 'make') {
            const mkToken = this.eat(lexer_1.TokenType.Keyword);
            let className = this.eatIdentifierOrKeyword().value;
            while (this.currentToken.type === lexer_1.TokenType.ColonColon) {
                this.eat(lexer_1.TokenType.ColonColon);
                className += '::' + this.eatIdentifierOrKeyword().value;
            }
            if (this.currentToken.type === lexer_1.TokenType.LessThan) {
                this.eat(lexer_1.TokenType.LessThan);
                const typeArg = this.parseTypeRef();
                className += '<' + typeArg + '>';
                this.eat(lexer_1.TokenType.GreaterThan);
            }
            const args = this.parseArgs();
            const closeParen = this.currentToken;
            left = {
                type: 'NewExpression',
                className,
                arguments: args,
                heapAlloc: true,
                line: mkToken.line,
                column: mkToken.column,
                length: closeParen.column - mkToken.column
            };
        }
        else if (token.type === lexer_1.TokenType.Keyword && token.value === 'fn') {
            const fnToken = this.eat(lexer_1.TokenType.Keyword);
            this.eat(lexer_1.TokenType.OpenParen);
            const params = [];
            while (this.currentToken.type !== lexer_1.TokenType.CloseParen) {
                const type = this.parseTypeRef();
                const name = this.eatIdentifierOrKeyword().value;
                params.push({ name, type });
                if (this.currentToken.type === lexer_1.TokenType.Comma)
                    this.eat(lexer_1.TokenType.Comma);
            }
            this.eat(lexer_1.TokenType.CloseParen);
            let returnType = null;
            if (this.currentToken.type === lexer_1.TokenType.Arrow) {
                this.eat(lexer_1.TokenType.Arrow);
                returnType = this.parseTypeRef();
            }
            this.eat(lexer_1.TokenType.OpenBrace);
            const body = this.parseBlock();
            left = {
                type: 'FunctionExpression',
                params: params,
                returnType: returnType,
                body: body,
                line: fnToken.line,
                column: fnToken.column,
                length: this.currentToken.column - fnToken.column
            };
        }
        else if (token.type === lexer_1.TokenType.Keyword && BUILTIN_FUNCTIONS.includes(token.value)) {
            const funcToken = this.eat(lexer_1.TokenType.Keyword);
            const funcName = funcToken.value;
            const args = this.parseArgs();
            const closeParen = this.currentToken;
            left = {
                type: 'FunctionCall',
                name: funcName,
                arguments: args,
                line: funcToken.line,
                column: funcToken.column,
                length: closeParen.column - funcToken.column
            };
        }
        else if (token.type === lexer_1.TokenType.Keyword && token.value === 'self') {
            const idToken = this.eat(lexer_1.TokenType.Keyword);
            left = {
                type: 'Identifier',
                name: 'self',
                line: idToken.line,
                column: idToken.column,
                length: idToken.length
            };
        }
        else if (token.type === lexer_1.TokenType.Keyword && token.value === 'result') {
            const resultToken = this.eat(lexer_1.TokenType.Keyword);
            left = {
                type: 'ResultExpr',
                line: resultToken.line,
                column: resultToken.column,
                length: resultToken.length
            };
        }
        else if (token.type === lexer_1.TokenType.Identifier) {
            const idToken = this.eat(lexer_1.TokenType.Identifier);
            if (this.currentToken.type === lexer_1.TokenType.ColonColon) {
                const segs = [idToken.value];
                while (this.currentToken.type === lexer_1.TokenType.ColonColon) {
                    this.eat(lexer_1.TokenType.ColonColon);
                    segs.push(this.eatIdentifierOrKeyword().value);
                }
                if (this.currentToken.type === lexer_1.TokenType.OpenParen) {
                    const args = this.parseArgs();
                    const closeParen = this.currentToken;
                    left = {
                        type: 'FunctionCall',
                        name: segs.join('::'),
                        arguments: args,
                        line: idToken.line,
                        column: idToken.column,
                        length: closeParen.column - idToken.column
                    };
                }
                else {
                    left = {
                        type: 'Identifier',
                        name: segs.join('::'),
                        line: idToken.line,
                        column: idToken.column,
                        length: idToken.length
                    };
                }
            }
            else if (this.currentToken.type === lexer_1.TokenType.OpenParen) {
                const args = this.parseArgs();
                const closeParen = this.currentToken;
                left = {
                    type: 'FunctionCall',
                    name: idToken.value,
                    arguments: args,
                    line: idToken.line,
                    column: idToken.column,
                    length: closeParen.column - idToken.column
                };
            }
            else {
                left = {
                    type: 'Identifier',
                    name: idToken.value,
                    line: idToken.line,
                    column: idToken.column,
                    length: idToken.length
                };
            }
        }
        else {
            throw new Error(`Parser Error: Unexpected token '${this.currentToken.value}' at line ${token.line}, col ${token.column}`);
        }
        while (this.currentToken.type === lexer_1.TokenType.Dot) {
            this.eat(lexer_1.TokenType.Dot);
            const propToken = this.currentToken;
            if (this.currentToken.type === lexer_1.TokenType.Identifier || this.currentToken.type === lexer_1.TokenType.Keyword) {
                this.advance();
            }
            else {
                throw new Error(`Parser Error: Expected property name after dot at line ${this.currentToken.line}, col ${this.currentToken.column}`);
            }
            let isMethodCall = false;
            const args = [];
            let endCol = propToken.column + propToken.length;
            if (this.currentToken.type === lexer_1.TokenType.OpenParen) {
                isMethodCall = true;
                args.push(...this.parseArgs());
                endCol = this.currentToken.column;
            }
            left = {
                type: 'MemberExpression',
                object: left,
                property: propToken.value,
                isMethodCall,
                arguments: args,
                line: left.line,
                column: left.column,
                length: endCol - left.column
            };
        }
        return left;
    }
    parseArgs() {
        this.eat(lexer_1.TokenType.OpenParen);
        const args = [];
        while (this.currentToken.type !== lexer_1.TokenType.CloseParen) {
            args.push(this.parseExpression());
            if (this.currentToken.type === lexer_1.TokenType.Comma)
                this.eat(lexer_1.TokenType.Comma);
        }
        this.eat(lexer_1.TokenType.CloseParen);
        return args;
    }
    parseTypeRef() {
        let result = this.eatIdentifierOrKeyword().value;
        while (this.currentToken.type === lexer_1.TokenType.ColonColon) {
            this.eat(lexer_1.TokenType.ColonColon);
            result += '::' + this.eatIdentifierOrKeyword().value;
        }
        return result;
    }
    parsePath() {
        const segs = [this.eatIdentifierOrKeyword().value];
        while (this.currentToken.type === lexer_1.TokenType.ColonColon) {
            this.eat(lexer_1.TokenType.ColonColon);
            segs.push(this.eatIdentifierOrKeyword().value);
        }
        return segs;
    }
    parseFunctionParams() {
        this.eat(lexer_1.TokenType.OpenParen);
        let receiver = null;
        const params = [];
        if (this.currentToken.type === lexer_1.TokenType.Ampersand) {
            this.eat(lexer_1.TokenType.Ampersand);
            this.eatKeyword('self');
            receiver = '&self';
        }
        else if (this.isKeyword('self')) {
            this.eatKeyword('self');
            receiver = 'self';
        }
        if (receiver && this.currentToken.type === lexer_1.TokenType.Comma) {
            this.eat(lexer_1.TokenType.Comma);
        }
        while (this.currentToken.type !== lexer_1.TokenType.CloseParen) {
            const type = this.parseTypeRef();
            const name = this.eatIdentifierOrKeyword().value;
            params.push({ name, type });
            if (this.currentToken.type === lexer_1.TokenType.Comma)
                this.eat(lexer_1.TokenType.Comma);
        }
        this.eat(lexer_1.TokenType.CloseParen);
        return { receiver, params };
    }
    parseModule() {
        const modToken = this.eatKeyword('mod');
        const name = this.eatIdentifierOrKeyword().value;
        this.eat(lexer_1.TokenType.OpenBrace);
        const body = [];
        while (this.currentToken.type !== lexer_1.TokenType.CloseBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
            body.push(this.parseTopLevelItem());
        }
        const closeBrace = this.eat(lexer_1.TokenType.CloseBrace);
        return {
            type: 'ModuleDecl',
            name: name,
            body: body,
            line: modToken.line,
            column: modToken.column,
            length: closeBrace.column - modToken.column
        };
    }
    parseUse() {
        const useToken = this.eatKeyword('use');
        const path = this.parsePath();
        this.consumeOptionalSemicolon();
        return {
            type: 'UseDecl',
            path: path,
            line: useToken.line,
            column: useToken.column,
            length: path.join('::').length
        };
    }
    parseForm(isPub, isExport = false) {
        const formToken = this.eatKeyword('form');
        const name = this.eatIdentifierOrKeyword().value;
        const inherits = this.parseInheritClause();
        const ranks = this.parseFormBody();
        return {
            type: 'FormDecl',
            name: name,
            isPub: isPub,
            isExport: isExport,
            inherits: inherits,
            ranks: ranks,
            line: formToken.line,
            column: formToken.column,
            length: this.currentToken.column - formToken.column
        };
    }
    parseTrait(isPub, isExport = false) {
        const traitToken = this.eatKeyword('trait');
        const name = this.eatIdentifierOrKeyword().value;
        const inherits = this.parseInheritClause();
        const ranks = this.parseTraitBody();
        return {
            type: 'TraitDecl',
            name: name,
            isPub: isPub,
            inherits: inherits,
            ranks: ranks,
            line: traitToken.line,
            column: traitToken.column,
            length: this.currentToken.column - traitToken.column
        };
    }
    parseImpl() {
        const implToken = this.eatKeyword('impl');
        let traitName = null;
        let target;
        const first = this.parsePath();
        if (this.isKeyword('for')) {
            this.eatKeyword('for');
            traitName = first.join('::');
            target = this.parsePath().join('::');
        }
        else {
            target = first.join('::');
        }
        let rank = null;
        if (this.currentToken.type === lexer_1.TokenType.Dot) {
            this.eat(lexer_1.TokenType.Dot);
            rank = this.eatIdentifierOrKeyword().value;
        }
        this.eat(lexer_1.TokenType.OpenBrace);
        const methods = [];
        while (this.currentToken.type !== lexer_1.TokenType.CloseBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
            const mPub = this.isKeyword('pub');
            if (mPub)
                this.eatKeyword('pub');
            methods.push(this.parseMethod());
        }
        const closeBrace = this.eat(lexer_1.TokenType.CloseBrace);
        return {
            type: 'ImplDecl',
            target: target,
            traitName: traitName,
            rank: rank,
            methods: methods,
            line: implToken.line,
            column: implToken.column,
            length: closeBrace.column - implToken.column
        };
    }
    parseTemplate() {
        const templateToken = this.eatKeyword('template');
        this.eat(lexer_1.TokenType.LessThan);
        const params = [this.eatIdentifierOrKeyword().value];
        while (this.currentToken.type === lexer_1.TokenType.Comma) {
            this.eat(lexer_1.TokenType.Comma);
            params.push(this.eatIdentifierOrKeyword().value);
        }
        this.eat(lexer_1.TokenType.GreaterThan);
        let inner;
        if (this.isKeyword('form')) {
            inner = this.parseForm(false);
        }
        else if (this.isKeyword('impl')) {
            inner = this.parseImpl();
        }
        else {
            throw new Error(`Parser Error: template must be followed by 'form' or 'impl', found '${this.currentToken.value}' at line ${this.currentToken.line}, col ${this.currentToken.column}`);
        }
        return {
            type: 'TemplateDecl',
            params: params,
            inner: inner,
            line: templateToken.line,
            column: templateToken.column,
            length: inner.length
        };
    }
    parseInheritClause() {
        if (this.currentToken.type !== lexer_1.TokenType.Colon)
            return null;
        this.eat(lexer_1.TokenType.Colon);
        const base = this.parsePath().join('::');
        let ranks = [];
        if (this.currentToken.type === lexer_1.TokenType.Dot) {
            this.eat(lexer_1.TokenType.Dot);
            this.eat(lexer_1.TokenType.OpenBrace);
            ranks = this.parseRankNameList();
            this.eat(lexer_1.TokenType.CloseBrace);
        }
        return { base, ranks };
    }
    parseRankNameList() {
        const ranks = [this.eatIdentifierOrKeyword().value];
        while (this.currentToken.type === lexer_1.TokenType.Comma) {
            this.eat(lexer_1.TokenType.Comma);
            ranks.push(this.eatIdentifierOrKeyword().value);
        }
        return ranks;
    }
    parseFormBody() {
        this.eat(lexer_1.TokenType.OpenBrace);
        const ranks = [];
        const defaultRank = { name: 'classical', fields: [], methods: [] };
        while (this.currentToken.type !== lexer_1.TokenType.CloseBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
            if (this.isKeyword('rank')) {
                this.eatKeyword('rank');
                const rankName = this.eatIdentifierOrKeyword().value;
                ranks.push(this.parseRankBlockBody(rankName));
            }
            else {
                const isPub = this.isKeyword('pub');
                if (isPub)
                    this.eatKeyword('pub');
                this.parseFieldOrMethod(defaultRank, isPub);
            }
        }
        this.eat(lexer_1.TokenType.CloseBrace);
        if (defaultRank.fields.length > 0 || defaultRank.methods.length > 0) {
            ranks.unshift(defaultRank);
        }
        return ranks;
    }
    parseRankBlockBody(rankName) {
        this.eat(lexer_1.TokenType.OpenBrace);
        const block = { name: rankName, fields: [], methods: [] };
        while (this.currentToken.type !== lexer_1.TokenType.CloseBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
            const isPub = this.isKeyword('pub');
            if (isPub)
                this.eatKeyword('pub');
            this.parseFieldOrMethod(block, isPub);
        }
        this.eat(lexer_1.TokenType.CloseBrace);
        return block;
    }
    parseFieldOrMethod(rank, isPub) {
        const typeToken = this.parseTypeRef();
        const name = this.eatIdentifierOrKeyword().value;
        if (this.currentToken.type === lexer_1.TokenType.OpenParen) {
            const { receiver, params } = this.parseFunctionParams();
            this.eat(lexer_1.TokenType.OpenBrace);
            const body = this.parseBlock();
            rank.methods.push({
                name: name,
                receiver: receiver,
                params: params,
                returnType: typeToken,
                isPub: isPub,
                body: body,
                line: this.currentToken.line,
                column: this.currentToken.column,
                length: 0
            });
        }
        else {
            rank.fields.push({ name: name, type: typeToken, isPub: isPub });
            this.consumeOptionalSemicolon();
        }
    }
    parseMethod() {
        const returnType = this.parseTypeRef();
        const name = this.eatIdentifierOrKeyword().value;
        const { receiver, params } = this.parseFunctionParams();
        this.eat(lexer_1.TokenType.OpenBrace);
        const body = this.parseBlock();
        return {
            name: name,
            receiver: receiver,
            params: params,
            returnType: returnType,
            isPub: false,
            body: body,
            line: this.currentToken.line,
            column: this.currentToken.column,
            length: 0
        };
    }
    parseTraitBody() {
        this.eat(lexer_1.TokenType.OpenBrace);
        const ranks = [];
        const defaultRank = { name: 'classical', fields: [], methods: [] };
        while (this.currentToken.type !== lexer_1.TokenType.CloseBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
            if (this.isKeyword('rank')) {
                this.eatKeyword('rank');
                const rankName = this.eatIdentifierOrKeyword().value;
                ranks.push(this.parseTraitRankBody(rankName));
            }
            else {
                const isPub = this.isKeyword('pub');
                if (isPub)
                    this.eatKeyword('pub');
                this.parseTraitMethod(defaultRank, isPub);
            }
        }
        this.eat(lexer_1.TokenType.CloseBrace);
        if (defaultRank.methods.length > 0) {
            ranks.unshift(defaultRank);
        }
        return ranks;
    }
    parseTraitRankBody(rankName) {
        this.eat(lexer_1.TokenType.OpenBrace);
        const block = { name: rankName, fields: [], methods: [] };
        while (this.currentToken.type !== lexer_1.TokenType.CloseBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
            const isPub = this.isKeyword('pub');
            if (isPub)
                this.eatKeyword('pub');
            this.parseTraitMethod(block, isPub);
        }
        this.eat(lexer_1.TokenType.CloseBrace);
        return block;
    }
    parseTraitMethod(rank, isPub) {
        const returnType = this.parseTypeRef();
        const name = this.eatIdentifierOrKeyword().value;
        const { receiver, params } = this.parseFunctionParams();
        this.consumeOptionalSemicolon();
        rank.methods.push({
            name: name,
            receiver: receiver,
            params: params,
            returnType: returnType,
            isPub: isPub,
            body: null,
            line: this.currentToken.line,
            column: this.currentToken.column,
            length: 0
        });
    }
    consumeOptionalSemicolon() {
        if (this.currentToken.type === lexer_1.TokenType.Semicolon) {
            this.eat(lexer_1.TokenType.Semicolon);
        }
    }
}
exports.Parser = Parser;
//# sourceMappingURL=parser.js.map