"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = void 0;
const lexer_1 = require("./lexer");
const ALLOWED_TYPES = [
    'let', 'auto', 'int', 'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'float', 'double', 'string', 'char', 'Qubit', 'QObject', 'QModel',
    'DiracState', 'BellState', 'QuantumRegister',
    'cap',
    'lattice',
    'fixed'
];
const BUILTIN_FUNCTIONS = [
    'alloc', 'measure', 'basis_state', 'encode_text', 'qlm_invoke',
    'qlm_load', 'qk_encode_string', 'qlm_forward', 'qk_decode_string',
    'mind_read', 'mind_train', 'mind_feedback',
    'veda_qlm_train',
    'surrogate', 'tanh_quantize', 'lif_step',
    'mellowmax2', 'logsumexp2', 'boltzmann2',
    'tnorm_luk', 'tnorm_prod', 'tnorm_godel',
    'polymer_weight', 'polymer_mix_bound',
    'qk_sys_call', 'qk_sys_calld', 'qk_sys_log', 'qk_sys_logi',
    'qk_sys_callp', 'qk_gc_free',
    'qk_qms_gap', 'qk_mix_bound', 'qk_qms_conc',
    'qchain_wallet', 'qchain_mint', 'qchain_transfer', 'qchain_balance',
    'qchain_mine', 'qchain_height', 'qchain_verify',
    'qchain_qkd', 'qchain_qdba', 'qchain_coin_mint', 'qchain_coin_verify',
    'qchain_sha3', 'qchain_hmac', 'qchain_hash_unicode',
    'qchain_sign', 'qchain_sign_verify', 'qchain_sign_pubkey',
    'qchain_mlkem_encaps', 'qchain_mlkem_decaps',
    'qchain_causal_verify', 'qchain_cipher_encrypt', 'qchain_cipher_decrypt',
    'sync_load', 'sync_store', 'sync_add', 'sync_cas',
    'native', 'outb', 'inb', 'qk_gc_alloc', 'addr'
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
    /**
     * 函数属性：@[name] 或 @[name("value")]，连续多个。
     * 用于系统级编程：@[section(".text.boot")] / @[naked] / @[no_gc] 等。
     */
    parseAttributes() {
        const attrs = [];
        while (this.currentToken.type === lexer_1.TokenType.At) {
            this.eat(lexer_1.TokenType.At);
            this.eat(lexer_1.TokenType.OpenBracket);
            const name = this.eatIdentifierOrKeyword().value;
            let value = null;
            // `as` 断言打断 while 循环对 this.currentToken.type 的流式窄化
            const t = this.currentToken.type;
            if (t === lexer_1.TokenType.OpenParen) {
                this.eat(lexer_1.TokenType.OpenParen);
                value = this.eat(lexer_1.TokenType.String).value;
                this.eat(lexer_1.TokenType.CloseParen);
            }
            this.eat(lexer_1.TokenType.CloseBracket);
            attrs.push({ name, value });
        }
        return attrs;
    }
    parseTopLevelItem() {
        // 函数属性（@[...]）作用于其后的顶层函数声明
        if (this.currentToken.type === lexer_1.TokenType.At) {
            const attributes = this.parseAttributes();
            const fn = this.parseDeclarationOrFunction(false, false);
            fn.attributes = attributes;
            return fn;
        }
        if (this.isKeyword('mod'))
            return this.parseModule();
        if (this.isKeyword('use'))
            return this.parseUse();
        if (this.isKeyword('form'))
            return this.parseForm(false, false);
        if (this.isKeyword('flavor'))
            return this.parseFlavor(false);
        if (this.isKeyword('impl'))
            return this.parseImpl();
        if (this.isKeyword('trait'))
            return this.parseTrait(false, false);
        if (this.isKeyword('template'))
            return this.parseTemplate();
        if (this.isKeyword('import'))
            return this.parseImport();
        if (this.isKeyword('extern'))
            return this.parseExtern();
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
    // extern <ret> <name>(<params>); —— 外部 C 符号声明（FFI）
    parseExtern() {
        const externToken = this.eatKeyword('extern');
        const returnType = this.parseTypeRef();
        const name = this.eatIdentifierOrKeyword().value;
        const { params } = this.parseFunctionParams();
        this.consumeOptionalSemicolon();
        return {
            type: 'ExternDecl',
            returnType: returnType,
            name: name,
            params: params,
            line: externToken.line,
            column: externToken.column,
            length: this.currentToken.column - externToken.column
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
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'if') {
            return this.parseIfStatement();
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'unsafe') {
            return this.parseUnsafeBlock();
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'route') {
            return this.parseRouteStatement();
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'spin') {
            return this.parseSpinStatement();
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'spawn') {
            return this.parseSpawnStatement();
        }
        if (tokenType === lexer_1.TokenType.Keyword && tokenValue === 'entangle') {
            return this.parseEntangleStatement();
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
        // `*p = v`：指针解引用赋值
        if (tokenType === lexer_1.TokenType.Star) {
            const expr = this.parseExpression();
            if (this.currentToken.type === lexer_1.TokenType.Equals) {
                this.eat(lexer_1.TokenType.Equals);
                const value = this.parseExpression();
                this.consumeOptionalSemicolon();
                return {
                    type: 'AssignmentStatement',
                    name: '',
                    target: expr,
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
        const isBuiltinCall = tokenType === lexer_1.TokenType.Keyword && BUILTIN_FUNCTIONS.includes(tokenValue);
        if (tokenType === lexer_1.TokenType.Identifier || isBuiltinCall) {
            const expr = this.parseExpression();
            if (this.currentToken.type === lexer_1.TokenType.Equals) {
                this.eat(lexer_1.TokenType.Equals);
                const value = this.parseExpression();
                this.consumeOptionalSemicolon();
                return {
                    type: 'AssignmentStatement',
                    name: (expr.type === 'MemberExpression' || expr.type === 'IndexExpression') ? '' : expr.name,
                    target: (expr.type === 'MemberExpression' || expr.type === 'IndexExpression') ? expr : undefined,
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
        // fixed 修饰符：编译期常量（确定型范式）
        let isFixed = false;
        if (varType === 'fixed') {
            isFixed = true;
            varType = this.eatIdentifierOrKeyword().value;
        }
        if (varType === 'let' || varType === 'auto')
            varType = 'auto';
        // 泛型类型：cap<T>（能力）/ lattice<T, B>（晶格数组）
        if ((varType === 'cap' || varType === 'lattice') && this.currentToken.type === lexer_1.TokenType.LessThan) {
            varType = this.parseGenericTypeRef(varType);
        }
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
            isFixed: isFixed,
            line: typeToken.line,
            column: typeToken.column,
            length: value.column + value.length - typeToken.column
        };
    }
    parseReturnStatement() {
        const retToken = this.eat(lexer_1.TokenType.Keyword);
        // void 空返回：return;
        if (this.currentToken.type === lexer_1.TokenType.Semicolon) {
            this.eat(lexer_1.TokenType.Semicolon);
            return {
                type: 'ReturnStatement',
                argument: {
                    type: 'NumberLiteral',
                    value: 0,
                    line: retToken.line,
                    column: retToken.column,
                    length: 0
                },
                isVoid: true,
                line: retToken.line,
                column: retToken.column,
                length: 7
            };
        }
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
    /**
     * if / else if / else
     *
     * `else if` 解析为「else 分支只含一个 IfStatement」，而非单独的
     * ElseIf 节点。这样 IR / MIR 的 lowering 只需处理一种分支形态，
     * 不必为链式 else-if 写特判。
     */
    parseIfStatement() {
        const ifToken = this.eat(lexer_1.TokenType.Keyword);
        this.eat(lexer_1.TokenType.OpenParen);
        const condition = this.parseExpression();
        this.eat(lexer_1.TokenType.CloseParen);
        this.eat(lexer_1.TokenType.OpenBrace);
        const consequent = this.parseBlock();
        let alternate = null;
        if (this.isKeyword('else')) {
            this.eatKeyword('else');
            if (this.isKeyword('if')) {
                // else if —— 递归解析，包成单元素数组
                alternate = [this.parseIfStatement()];
            }
            else {
                this.eat(lexer_1.TokenType.OpenBrace);
                alternate = this.parseBlock();
            }
        }
        return {
            type: 'IfStatement',
            condition: condition,
            consequent: consequent,
            alternate: alternate,
            line: ifToken.line,
            column: ifToken.column,
            length: ifToken.length
        };
    }
    /**
     * unsafe { ... } —— 系统级危险操作块（裸指针解引用 / MMIO / 内联汇编）。
     * 是"写内核"的显式危险边界；能力校验在语义层完成。
     */
    parseUnsafeBlock() {
        const unsafeToken = this.eat(lexer_1.TokenType.Keyword);
        this.eat(lexer_1.TokenType.OpenBrace);
        const body = this.parseBlock();
        return {
            type: 'UnsafeBlock',
            body: body,
            line: unsafeToken.line,
            column: unsafeToken.column,
            length: unsafeToken.length
        };
    }
    /**
     * route (discriminant) { path V: {...} fallback: {...} }
     * 路由分支：把判别值路由到若干路径之一。
     */
    parseRouteStatement() {
        const routeToken = this.eat(lexer_1.TokenType.Keyword);
        this.eat(lexer_1.TokenType.OpenParen);
        const discriminant = this.parseExpression();
        this.eat(lexer_1.TokenType.CloseParen);
        this.eat(lexer_1.TokenType.OpenBrace);
        const cases = [];
        let fallback = null;
        while (this.currentToken.type !== lexer_1.TokenType.CloseBrace) {
            if (this.isKeyword('path')) {
                this.eatKeyword('path');
                const value = this.parseExpression();
                this.eat(lexer_1.TokenType.Colon);
                this.eat(lexer_1.TokenType.OpenBrace);
                const body = this.parseBlock();
                cases.push({ value, body });
            }
            else if (this.isKeyword('fallback')) {
                this.eatKeyword('fallback');
                this.eat(lexer_1.TokenType.Colon);
                this.eat(lexer_1.TokenType.OpenBrace);
                fallback = this.parseBlock();
            }
            else {
                throw new Error(`Parser Error: expected 'path' or 'fallback' in route statement (line ${routeToken.line})`);
            }
        }
        this.eat(lexer_1.TokenType.CloseBrace);
        return {
            type: 'RouteStatement',
            discriminant,
            cases,
            fallback,
            line: routeToken.line,
            column: routeToken.column,
            length: routeToken.length
        };
    }
    /**
     * spin { body } while (cond);
     * 自旋循环：先执行循环体，再判断条件，至少执行一次。
     */
    parseSpinStatement() {
        const spinToken = this.eat(lexer_1.TokenType.Keyword);
        this.eat(lexer_1.TokenType.OpenBrace);
        const body = this.parseBlock();
        this.eatKeyword('while');
        this.eat(lexer_1.TokenType.OpenParen);
        const condition = this.parseExpression();
        this.eat(lexer_1.TokenType.CloseParen);
        this.consumeOptionalSemicolon();
        return {
            type: 'SpinStatement',
            body,
            condition,
            line: spinToken.line,
            column: spinToken.column,
            length: spinToken.length
        };
    }
    /**
     * spawn { ... } —— 派生并发线程（Q-Digest）。
     * 块体闭包继承外层作用域，是竞争检测的"线程"单元。
     */
    parseSpawnStatement() {
        const spawnToken = this.eat(lexer_1.TokenType.Keyword);
        this.eat(lexer_1.TokenType.OpenBrace);
        const body = this.parseBlock();
        return {
            type: 'SpawnStatement',
            body,
            line: spawnToken.line,
            column: spawnToken.column,
            length: spawnToken.length
        };
    }
    /**
     * entangle(q1, q2) —— 量子纠缠声明（Q-Digest）。
     * 纠缠具有传递性，竞争检测据此构建纠缠闭包。
     */
    parseEntangleStatement() {
        const entangleToken = this.eat(lexer_1.TokenType.Keyword);
        this.eat(lexer_1.TokenType.OpenParen);
        const left = this.parseExpression();
        this.eat(lexer_1.TokenType.Comma);
        const right = this.parseExpression();
        this.eat(lexer_1.TokenType.CloseParen);
        this.consumeOptionalSemicolon();
        return {
            type: 'EntangleStatement',
            left,
            right,
            line: entangleToken.line,
            column: entangleToken.column,
            length: entangleToken.length
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
        const invariant = [];
        while (this.isKeyword('invariant')) {
            this.eat(lexer_1.TokenType.Keyword);
            invariant.push(this.parseExpression());
            this.consumeOptionalSemicolon();
        }
        this.eat(lexer_1.TokenType.OpenBrace);
        const body = this.parseBlock();
        return {
            type: 'ForStatement',
            init: init,
            condition: condition,
            update: update,
            body: body,
            invariant: invariant,
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
        let left = this.parseComparison();
        while (this.currentToken.type === lexer_1.TokenType.AndAnd ||
            this.currentToken.type === lexer_1.TokenType.OrOr) {
            const opToken = this.advance();
            const right = this.parseComparison();
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
    // 比较层：< <= > >= == !=（优先级低于算术，高于逻辑）
    parseComparison() {
        let left = this.parseAdditive();
        while (this.currentToken.type === lexer_1.TokenType.LessThan ||
            this.currentToken.type === lexer_1.TokenType.LessEqual ||
            this.currentToken.type === lexer_1.TokenType.GreaterThan ||
            this.currentToken.type === lexer_1.TokenType.GreaterEqual ||
            this.currentToken.type === lexer_1.TokenType.EqualsEquals ||
            this.currentToken.type === lexer_1.TokenType.NotEqual) {
            const opToken = this.advance();
            const right = this.parseAdditive();
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
    // 加减层：+ -（优先级低于乘除，高于比较）
    parseAdditive() {
        let left = this.parseMultiplicative();
        while (this.currentToken.type === lexer_1.TokenType.Plus ||
            this.currentToken.type === lexer_1.TokenType.Minus) {
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
            this.currentToken.type === lexer_1.TokenType.Slash ||
            this.currentToken.type === lexer_1.TokenType.Percent ||
            this.currentToken.type === lexer_1.TokenType.Ampersand ||
            this.currentToken.type === lexer_1.TokenType.Pipe ||
            this.currentToken.type === lexer_1.TokenType.Caret ||
            this.currentToken.type === lexer_1.TokenType.ShiftLeft ||
            this.currentToken.type === lexer_1.TokenType.ShiftRight) {
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
            this.currentToken.type === lexer_1.TokenType.Minus ||
            this.currentToken.type === lexer_1.TokenType.Tilde ||
            this.currentToken.type === lexer_1.TokenType.Star ||
            this.currentToken.type === lexer_1.TokenType.Ampersand) {
            const opToken = this.advance();
            const argument = this.parseUnary();
            // `*` 是前缀解引用
            if (opToken.type === lexer_1.TokenType.Star) {
                return {
                    type: 'Dereference',
                    target: argument,
                    line: opToken.line,
                    column: opToken.column,
                    length: argument.column + argument.length - opToken.column
                };
            }
            // `&` 是取地址（函数指针）
            if (opToken.type === lexer_1.TokenType.Ampersand) {
                return {
                    type: 'AddressOf',
                    target: argument,
                    line: opToken.line,
                    column: opToken.column,
                    length: argument.column + argument.length - opToken.column
                };
            }
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
                isFloat: (!/^0[xX]/.test(numToken.value)) && (numToken.value.includes('.') || /[eE]/.test(numToken.value)),
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
        else if (token.type === lexer_1.TokenType.Keyword && token.value === 'null') {
            const nullToken = this.eat(lexer_1.TokenType.Keyword);
            left = {
                type: 'NullLiteral',
                line: nullToken.line,
                column: nullToken.column,
                length: nullToken.length
            };
        }
        else if (token.type === lexer_1.TokenType.Keyword && token.value === 'native') {
            this.eat(lexer_1.TokenType.Keyword);
            this.eat(lexer_1.TokenType.OpenParen);
            const tplToken = this.eat(lexer_1.TokenType.String);
            this.eat(lexer_1.TokenType.CloseParen);
            left = {
                type: 'NativeExpression',
                template: tplToken.value,
                line: token.line,
                column: token.column,
                length: tplToken.value.length + 6
            };
        }
        else if (token.type === lexer_1.TokenType.Keyword && token.value === 'fuse') {
            this.eat(lexer_1.TokenType.Keyword);
            this.eat(lexer_1.TokenType.OpenParen);
            const discriminant = this.parseExpression();
            this.eat(lexer_1.TokenType.CloseParen);
            this.eat(lexer_1.TokenType.OpenBrace);
            const arms = [];
            while (this.currentToken.type !== lexer_1.TokenType.CloseBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
                let pattern;
                if (this.currentToken.type === lexer_1.TokenType.Identifier && this.currentToken.value === '_') {
                    this.eat(lexer_1.TokenType.Identifier);
                    pattern = null;
                }
                else {
                    pattern = this.parseExpression();
                }
                this.eat(lexer_1.TokenType.Colon);
                const value = this.parseExpression();
                arms.push({ pattern, value });
                if (this.currentToken.type === lexer_1.TokenType.Comma) {
                    this.eat(lexer_1.TokenType.Comma);
                }
            }
            this.eat(lexer_1.TokenType.CloseBrace);
            left = {
                type: 'FuseExpression',
                discriminant,
                arms,
                line: token.line,
                column: token.column,
                length: this.currentToken.column - token.column
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
                className += this.parseGenericTypeSuffix();
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
                className += this.parseGenericTypeSuffix();
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
        // 晶格索引：board[x, y]（多维下标访问）
        while (this.currentToken.type === lexer_1.TokenType.OpenBracket) {
            const indices = this.parseIndexList();
            const col = this.currentToken.column;
            left = {
                type: 'IndexExpression',
                object: left,
                indices: indices,
                line: left.line,
                column: left.column,
                length: col - left.column
            };
        }
        return left;
    }
    // 解析 [i0, i1, ...] 下标表（含方括号，消费到 ']' 为止）
    parseIndexList() {
        this.eat(lexer_1.TokenType.OpenBracket);
        const indices = [];
        while (this.currentToken.type !== lexer_1.TokenType.CloseBracket && this.currentToken.type !== lexer_1.TokenType.EOF) {
            indices.push(this.parseExpression());
            if (this.currentToken.type === lexer_1.TokenType.Comma)
                this.eat(lexer_1.TokenType.Comma);
        }
        this.eat(lexer_1.TokenType.CloseBracket);
        return indices;
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
        // 泛型类型：cap<T> 与 lattice<T, B>
        if ((result === 'cap' || result === 'lattice') && this.currentToken.type === lexer_1.TokenType.LessThan) {
            result = this.parseGenericTypeRef(result);
        }
        return result;
    }
    /**
     * 解析 `<T1, T2, ...>` 泛型参数表（含尖括号，支持逗号分隔多参数）。
     * 前置条件：当前 token 为 '<'；消费到 '>' 为止。
     */
    parseGenericTypeSuffix() {
        this.eat(lexer_1.TokenType.LessThan);
        const parts = [];
        do {
            parts.push(this.parseTypeRef());
            if (this.currentToken.type === lexer_1.TokenType.Comma)
                this.eat(lexer_1.TokenType.Comma);
        } while (this.currentToken.type !== lexer_1.TokenType.GreaterThan && this.currentToken.type !== lexer_1.TokenType.EOF);
        this.eat(lexer_1.TokenType.GreaterThan);
        return '<' + parts.join(', ') + '>';
    }
    /** 解析 base<T...> 并返回完整类型字符串（如 cap<int32>、lattice<int32, open>）。 */
    parseGenericTypeRef(base) {
        return base + this.parseGenericTypeSuffix();
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
    /**
     * flavor Name { A, B, C }
     * 味：具名常量，自动按声明顺序赋值 0,1,2,...
     */
    parseFlavor(isPub) {
        const flavorToken = this.eatKeyword('flavor');
        const name = this.eatIdentifierOrKeyword().value;
        this.eat(lexer_1.TokenType.OpenBrace);
        const members = [];
        while (this.currentToken.type !== lexer_1.TokenType.CloseBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
            members.push(this.eatIdentifierOrKeyword().value);
            if (this.currentToken.type === lexer_1.TokenType.Comma) {
                this.eat(lexer_1.TokenType.Comma);
            }
        }
        this.eat(lexer_1.TokenType.CloseBrace);
        return {
            type: 'FlavorDecl',
            name,
            members,
            isPub,
            line: flavorToken.line,
            column: flavorToken.column,
            length: this.currentToken.column - flavorToken.column
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