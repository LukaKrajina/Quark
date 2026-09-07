import { Token, TokenType, Lexer } from './lexer';
import {
    Program,
    Statement,
    Item,
    VariableDeclaration,
    Expression,
    WhileStatement,
    ForStatement,
    IfStatement,
    RouteStatement,
    RouteCase,
    SpinStatement,
    UnsafeBlock,
    BreakStatement,
    ContinueStatement,
    ReturnStatement,
    AssignmentStatement,
    ExpressionStatement,
    FunctionCall,
    NumberLiteral,
    NullLiteral,
    Dereference,
    AddressOf,
    NativeExpression,
    FuseExpression,
    FuseArm,
    Identifier,
    FunctionDeclaration,
    FunctionAttribute,
    BinaryExpression,
    LogicalExpression,
    UnaryExpression,
    ResultExpr,
    FunctionExpression,
    MemberExpression,
    StringLiteral,
    NewExpression,
    ModuleDecl,
    UseDecl,
    FormDecl,
    FlavorDecl,
    ImplDecl,
    TraitDecl,
    TemplateDecl,
    RankBlock,
    FieldDecl,
    FnDecl,
    Param,
    InheritClause,
    ImportDecl,
    RequiresDecl,
    SpawnStatement,
    EntangleStatement
} from './ast';

const ALLOWED_TYPES = [
    'let', 'auto', 'int', 'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'float', 'double', 'string', 'char', 'Qubit', 'QObject', 'QModel',
    'DiracState', 'BellState', 'QuantumRegister',
    'cap',
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
    'sync_load', 'sync_store', 'sync_add', 'sync_cas',
    'native', 'outb', 'inb', 'qk_gc_alloc', 'addr'
];

export class Parser {
    private lexer: Lexer;
    private currentToken: Token;
    private lookahead: Token | null = null;

    constructor(lexer: Lexer) {
        this.lexer = lexer;
        this.currentToken = this.lexer.getNextToken();
    }

    private advance(): Token {
        const token = this.currentToken;
        if (this.lookahead) {
            this.currentToken = this.lookahead;
            this.lookahead = null;
        } else {
            this.currentToken = this.lexer.getNextToken();
        }
        return token;
    }

    private peek(): Token {
        if (!this.lookahead) {
            this.lookahead = this.lexer.getNextToken();
        }
        return this.lookahead;
    }

    private eat(type: TokenType): Token {
        const token = this.currentToken;
        if (this.currentToken.type === type) {
            this.advance();
            return token;
        } else {
            throw new Error(`Parser Error: Expected ${type}, found ${this.currentToken.type} ('${this.currentToken.value}') at line ${this.currentToken.line}, col ${this.currentToken.column}`);
        }
    }

    private isKeyword(value: string): boolean {
        return this.currentToken.type === TokenType.Keyword && this.currentToken.value === value;
    }

    private eatKeyword(value: string): Token {
        if (!this.isKeyword(value)) {
            throw new Error(`Parser Error: Expected keyword '${value}', found '${this.currentToken.value}' at line ${this.currentToken.line}, col ${this.currentToken.column}`);
        }
        return this.advance();
    }

    private eatIdentifierOrKeyword(): Token {
        const token = this.currentToken;
        if (token.type === TokenType.Identifier || token.type === TokenType.Keyword) {
            this.advance();
            return token;
        }
        throw new Error(`Parser Error: Expected identifier, found ${token.type} ('${token.value}') at line ${token.line}, col ${token.column}`);
    }

    public parse(): Program {
        const startLine = this.currentToken.line;
        const startCol = this.currentToken.column;
        const program: Program = {
            type: 'Program',
            body: [],
            line: startLine,
            column: startCol,
            length: 0
        };
        while (this.currentToken.type !== TokenType.EOF) {
            program.body.push(this.parseTopLevelItem());
        }
        return program;
    }

    /**
     * 函数属性：@[name] 或 @[name("value")]，连续多个。
     * 用于系统级编程：@[section(".text.boot")] / @[naked] / @[no_gc] 等。
     */
    private parseAttributes(): FunctionAttribute[] {
        const attrs: FunctionAttribute[] = [];
        while (this.currentToken.type === TokenType.At) {
            this.eat(TokenType.At);
            this.eat(TokenType.OpenBracket);
            const name = this.eatIdentifierOrKeyword().value;
            let value: string | null = null;
            // `as` 断言打断 while 循环对 this.currentToken.type 的流式窄化
            const t = this.currentToken.type as TokenType;
            if (t === TokenType.OpenParen) {
                this.eat(TokenType.OpenParen);
                value = this.eat(TokenType.String).value;
                this.eat(TokenType.CloseParen);
            }
            this.eat(TokenType.CloseBracket);
            attrs.push({ name, value });
        }
        return attrs;
    }

    private parseTopLevelItem(): Statement | Item {
        // 函数属性（@[...]）作用于其后的顶层函数声明
        if (this.currentToken.type === TokenType.At) {
            const attributes = this.parseAttributes();
            const fn = this.parseDeclarationOrFunction(false, false) as FunctionDeclaration;
            fn.attributes = attributes;
            return fn;
        }
        if (this.isKeyword('mod')) return this.parseModule();
        if (this.isKeyword('use')) return this.parseUse();
        if (this.isKeyword('form')) return this.parseForm(false, false);
        if (this.isKeyword('flavor')) return this.parseFlavor(false);
        if (this.isKeyword('impl')) return this.parseImpl();
        if (this.isKeyword('trait')) return this.parseTrait(false, false);
        if (this.isKeyword('template')) return this.parseTemplate();
        if (this.isKeyword('import')) return this.parseImport();
        if (this.isKeyword('requires')) return this.parseRequires();
        if (this.isKeyword('export')) {
            this.eatKeyword('export');
            if (this.isKeyword('form')) return this.parseForm(false, true);
            if (this.isKeyword('trait')) return this.parseTrait(false, true);
            return this.parseDeclarationOrFunction(false, true);
        }
        if (this.isKeyword('pub')) {
            this.eatKeyword('pub');
            if (this.isKeyword('form')) return this.parseForm(true, false);
            if (this.isKeyword('trait')) return this.parseTrait(true, false);
            if (this.isKeyword('mod')) return this.parseModule();
            return this.parseDeclarationOrFunction(true, false);
        }
        return this.parseStatement();
    }

    private parseImport(): ImportDecl {
        const importToken = this.eatKeyword('import');
        const alias = this.eatIdentifierOrKeyword().value;
        this.eatKeyword('from');
        const pathToken = this.eat(TokenType.String);
        this.consumeOptionalSemicolon();
        return {
            type: 'ImportDecl',
            alias: alias,
            path: pathToken.value,
            line: importToken.line,
            column: importToken.column,
            length: pathToken.value.length + 2
        } as ImportDecl;
    }

    private parseRequires(): RequiresDecl {
        const requiresToken = this.eatKeyword('requires');
        const segs = [this.eatIdentifierOrKeyword().value];
        while (this.currentToken.type === TokenType.Dot) {
            this.eat(TokenType.Dot);
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
        } as RequiresDecl;
    }

    private parseStatement(): Statement {
        const tokenType = this.currentToken.type;
        const tokenValue = this.currentToken.value;

        if (tokenType === TokenType.Keyword && ALLOWED_TYPES.includes(tokenValue)) {
            return this.parseDeclarationOrFunction(false);
        }

        if (tokenType === TokenType.Identifier && this.peek().type === TokenType.Identifier) {
            return this.parseDeclarationOrFunction(false);
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'while') {
            return this.parseWhileStatement();
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'for') {
            return this.parseForStatement();
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'if') {
            return this.parseIfStatement();
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'unsafe') {
            return this.parseUnsafeBlock();
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'route') {
            return this.parseRouteStatement();
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'spin') {
            return this.parseSpinStatement();
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'spawn') {
            return this.parseSpawnStatement();
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'entangle') {
            return this.parseEntangleStatement();
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'break') {
            const breakToken = this.eat(TokenType.Keyword);
            this.consumeOptionalSemicolon();
            return {
                type: 'BreakStatement',
                line: breakToken.line,
                column: breakToken.column,
                length: breakToken.length
            } as BreakStatement;
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'continue') {
            const contToken = this.eat(TokenType.Keyword);
            this.consumeOptionalSemicolon();
            return {
                type: 'ContinueStatement',
                line: contToken.line,
                column: contToken.column,
                length: contToken.length
            } as ContinueStatement;
        }

        if (tokenType === TokenType.Keyword && tokenValue === 'return') {
            return this.parseReturnStatement();
        }

        // `*p = v`：指针解引用赋值
        if (tokenType === TokenType.Star) {
            const expr = this.parseExpression();
            if (this.currentToken.type === TokenType.Equals) {
                this.eat(TokenType.Equals);
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
                } as AssignmentStatement;
            }
            this.consumeOptionalSemicolon();
            return {
                type: 'ExpressionStatement',
                expression: expr,
                line: expr.line,
                column: expr.column,
                length: expr.length
            } as ExpressionStatement;
        }

        const isBuiltinCall = tokenType === TokenType.Keyword && BUILTIN_FUNCTIONS.includes(tokenValue);

        if (tokenType === TokenType.Identifier || isBuiltinCall) {
            const expr = this.parseExpression();
            if (this.currentToken.type === TokenType.Equals) {
                this.eat(TokenType.Equals);
                const value = this.parseExpression();
                this.consumeOptionalSemicolon();

                return {
                    type: 'AssignmentStatement',
                    name: expr.type === 'MemberExpression' ? '' : (expr as Identifier).name,
                    target: expr.type === 'MemberExpression' ? expr : undefined,
                    value: value,
                    line: expr.line,
                    column: expr.column,
                    length: value.column + value.length - expr.column
                } as AssignmentStatement;
            }
            this.consumeOptionalSemicolon();
            return {
                type: 'ExpressionStatement',
                expression: expr,
                line: expr.line,
                column: expr.column,
                length: expr.length
            } as ExpressionStatement;
        }

        throw new Error(`Parser Error: Unexpected token '${this.currentToken.value}' at line ${this.currentToken.line}, col ${this.currentToken.column}`);
    }

    private parseDeclarationOrFunction(isPub: boolean, isExport: boolean = false): Statement {
        const typeToken = this.eatIdentifierOrKeyword();
        let varType = typeToken.value;
        // fixed 修饰符：编译期常量（确定型范式）
        let isFixed = false;
        if (varType === 'fixed') {
            isFixed = true;
            varType = this.eatIdentifierOrKeyword().value;
        }
        if (varType === 'let' || varType === 'auto') varType = 'auto';

        // 能力泛型类型：cap<T>（CHERI 式能力：地址 + 边界 + 权限 + 有效性）
        if (varType === 'cap' && this.currentToken.type === TokenType.LessThan) {
            this.eat(TokenType.LessThan);
            const inner = this.parseTypeRef();
            varType = 'cap<' + inner + '>';
            this.eat(TokenType.GreaterThan);
        }

        const idToken = this.eatIdentifierOrKeyword();
        const identifier = idToken.value;

        if (this.currentToken.type === TokenType.OpenParen) {
            const { receiver, params } = this.parseFunctionParams();

            const requires: Expression[] = [];
            const ensures: Expression[] = [];
            while (this.isKeyword('requires') || this.isKeyword('ensures')) {
                const isEnsures = this.isKeyword('ensures');
                this.eat(TokenType.Keyword);
                const cond = this.parseExpression();
                this.consumeOptionalSemicolon();
                if (isEnsures) ensures.push(cond);
                else requires.push(cond);
            }

            this.eat(TokenType.OpenBrace);
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
            } as FunctionDeclaration;
        }

        this.eat(TokenType.Equals);
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
        } as VariableDeclaration;
    }

    private parseReturnStatement(): ReturnStatement {
        const retToken = this.eat(TokenType.Keyword);
        const value = this.parseExpression();
        this.consumeOptionalSemicolon();

        return {
            type: 'ReturnStatement',
            argument: value,
            line: retToken.line,
            column: retToken.column,
            length: value.column + value.length - retToken.column
        } as ReturnStatement;
    }

    private parseWhileStatement(): WhileStatement {
        const whileToken = this.eat(TokenType.Keyword);
        this.eat(TokenType.OpenParen);
        const condition = this.parseExpression();
        this.eat(TokenType.CloseParen);

        const invariant: Expression[] = [];
        while (this.isKeyword('invariant')) {
            this.eat(TokenType.Keyword);
            invariant.push(this.parseExpression());
            this.consumeOptionalSemicolon();
        }

        this.eat(TokenType.OpenBrace);

        const body = this.parseBlock();
        const closeBrace = this.currentToken;

        let elseBody: Statement[] | undefined;
        if (this.isKeyword('else')) {
            this.eatKeyword('else');
            this.eat(TokenType.OpenBrace);
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
        } as WhileStatement;
    }

    /**
     * if / else if / else
     *
     * `else if` 解析为「else 分支只含一个 IfStatement」，而非单独的
     * ElseIf 节点。这样 IR / MIR 的 lowering 只需处理一种分支形态，
     * 不必为链式 else-if 写特判。
     */
    private parseIfStatement(): IfStatement {
        const ifToken = this.eat(TokenType.Keyword);
        this.eat(TokenType.OpenParen);
        const condition = this.parseExpression();
        this.eat(TokenType.CloseParen);

        this.eat(TokenType.OpenBrace);
        const consequent = this.parseBlock();

        let alternate: Statement[] | null = null;
        if (this.isKeyword('else')) {
            this.eatKeyword('else');
            if (this.isKeyword('if')) {
                // else if —— 递归解析，包成单元素数组
                alternate = [this.parseIfStatement()];
            } else {
                this.eat(TokenType.OpenBrace);
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
        } as IfStatement;
    }

    /**
     * unsafe { ... } —— 系统级危险操作块（裸指针解引用 / MMIO / 内联汇编）。
     * 是"写内核"的显式危险边界；能力校验在语义层完成。
     */
    private parseUnsafeBlock(): UnsafeBlock {
        const unsafeToken = this.eat(TokenType.Keyword);
        this.eat(TokenType.OpenBrace);
        const body = this.parseBlock();
        return {
            type: 'UnsafeBlock',
            body: body,
            line: unsafeToken.line,
            column: unsafeToken.column,
            length: unsafeToken.length
        } as UnsafeBlock;
    }

    /**
     * route (discriminant) { path V: {...} fallback: {...} }
     * 路由分支：把判别值路由到若干路径之一。
     */
    private parseRouteStatement(): RouteStatement {
        const routeToken = this.eat(TokenType.Keyword);
        this.eat(TokenType.OpenParen);
        const discriminant = this.parseExpression();
        this.eat(TokenType.CloseParen);
        this.eat(TokenType.OpenBrace);

        const cases: RouteCase[] = [];
        let fallback: Statement[] | null = null;

        while (this.currentToken.type !== TokenType.CloseBrace) {
            if (this.isKeyword('path')) {
                this.eatKeyword('path');
                const value = this.parseExpression();
                this.eat(TokenType.Colon);
                this.eat(TokenType.OpenBrace);
                const body = this.parseBlock();
                cases.push({ value, body });
            } else if (this.isKeyword('fallback')) {
                this.eatKeyword('fallback');
                this.eat(TokenType.Colon);
                this.eat(TokenType.OpenBrace);
                fallback = this.parseBlock();
            } else {
                throw new Error(`Parser Error: expected 'path' or 'fallback' in route statement (line ${routeToken.line})`);
            }
        }
        this.eat(TokenType.CloseBrace);

        return {
            type: 'RouteStatement',
            discriminant,
            cases,
            fallback,
            line: routeToken.line,
            column: routeToken.column,
            length: routeToken.length
        } as RouteStatement;
    }

    /**
     * spin { body } while (cond);
     * 自旋循环：先执行循环体，再判断条件，至少执行一次。
     */
    private parseSpinStatement(): SpinStatement {
        const spinToken = this.eat(TokenType.Keyword);
        this.eat(TokenType.OpenBrace);
        const body = this.parseBlock();
        this.eatKeyword('while');
        this.eat(TokenType.OpenParen);
        const condition = this.parseExpression();
        this.eat(TokenType.CloseParen);
        this.consumeOptionalSemicolon();

        return {
            type: 'SpinStatement',
            body,
            condition,
            line: spinToken.line,
            column: spinToken.column,
            length: spinToken.length
        } as SpinStatement;
    }

    /**
     * spawn { ... } —— 派生并发线程（Q-Digest）。
     * 块体闭包继承外层作用域，是竞争检测的"线程"单元。
     */
    private parseSpawnStatement(): SpawnStatement {
        const spawnToken = this.eat(TokenType.Keyword);
        this.eat(TokenType.OpenBrace);
        const body = this.parseBlock();
        return {
            type: 'SpawnStatement',
            body,
            line: spawnToken.line,
            column: spawnToken.column,
            length: spawnToken.length
        } as SpawnStatement;
    }

    /**
     * entangle(q1, q2) —— 量子纠缠声明（Q-Digest）。
     * 纠缠具有传递性，竞争检测据此构建纠缠闭包。
     */
    private parseEntangleStatement(): EntangleStatement {
        const entangleToken = this.eat(TokenType.Keyword);
        this.eat(TokenType.OpenParen);
        const left = this.parseExpression();
        this.eat(TokenType.Comma);
        const right = this.parseExpression();
        this.eat(TokenType.CloseParen);
        this.consumeOptionalSemicolon();
        return {
            type: 'EntangleStatement',
            left,
            right,
            line: entangleToken.line,
            column: entangleToken.column,
            length: entangleToken.length
        } as EntangleStatement;
    }

    private parseForStatement(): ForStatement {
        const forToken = this.eat(TokenType.Keyword);
        this.eat(TokenType.OpenParen);

        let init: Statement | null = null;
        if (this.currentToken.type !== TokenType.Semicolon) {
            init = this.parseForClauseStatement();
        }
        this.eat(TokenType.Semicolon);

        let condition: Expression | null = null;
        if (this.currentToken.type !== TokenType.Semicolon) {
            condition = this.parseExpression();
        }
        this.eat(TokenType.Semicolon);

        let update: Statement | null = null;
        if (this.currentToken.type !== TokenType.CloseParen) {
            update = this.parseForClauseStatement();
        }
        this.eat(TokenType.CloseParen);

        const invariant: Expression[] = [];
        while (this.isKeyword('invariant')) {
            this.eat(TokenType.Keyword);
            invariant.push(this.parseExpression());
            this.consumeOptionalSemicolon();
        }

        this.eat(TokenType.OpenBrace);
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
        } as ForStatement;
    }

    private parseForClauseStatement(): Statement {
        const tokenType = this.currentToken.type;
        const tokenValue = this.currentToken.value;
        if (tokenType === TokenType.Keyword && ALLOWED_TYPES.includes(tokenValue)) {
            const typeToken = this.eatIdentifierOrKeyword();
            const varType = (typeToken.value === 'let' || typeToken.value === 'auto') ? 'auto' : typeToken.value;
            const idToken = this.eatIdentifierOrKeyword();
            this.eat(TokenType.Equals);
            const value = this.parseExpression();
            return {
                type: 'VariableDeclaration',
                varType: varType,
                identifier: idToken.value,
                value: value,
                line: typeToken.line,
                column: typeToken.column,
                length: value.column + value.length - typeToken.column
            } as VariableDeclaration;
        }
        const expr = this.parseExpression();
        this.eat(TokenType.Equals);
        const value = this.parseExpression();
        return {
            type: 'AssignmentStatement',
            name: expr.type === 'MemberExpression' ? '' : (expr as Identifier).name,
            target: expr.type === 'MemberExpression' ? expr : undefined,
            value: value,
            line: expr.line,
            column: expr.column,
            length: value.column + value.length - expr.column
        } as AssignmentStatement;
    }

    private parseBlock(): Statement[] {
        const body: Statement[] = [];
        while (this.currentToken.type !== TokenType.CloseBrace && this.currentToken.type !== TokenType.EOF) {
            body.push(this.parseStatement());
        }
        this.eat(TokenType.CloseBrace);
        return body;
    }

    private parseExpression(): Expression {
        return this.parseLogical();
    }

    private parseLogical(): Expression {
        let left = this.parseAdditive();

        while (
            this.currentToken.type === TokenType.AndAnd ||
            this.currentToken.type === TokenType.OrOr
        ) {
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
            } as LogicalExpression;
        }
        return left;
    }

    private parseAdditive(): Expression {
        let left = this.parseMultiplicative();

        while (
            this.currentToken.type === TokenType.Plus ||
            this.currentToken.type === TokenType.Minus ||
            this.currentToken.type === TokenType.LessThan ||
            this.currentToken.type === TokenType.LessEqual ||
            this.currentToken.type === TokenType.GreaterThan ||
            this.currentToken.type === TokenType.GreaterEqual ||
            this.currentToken.type === TokenType.EqualsEquals ||
            this.currentToken.type === TokenType.NotEqual
        ) {
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
            } as BinaryExpression;
        }
        return left;
    }

    private parseMultiplicative(): Expression {
        let left = this.parseUnary();

        while (
            this.currentToken.type === TokenType.Star ||
            this.currentToken.type === TokenType.Slash ||
            this.currentToken.type === TokenType.Ampersand ||
            this.currentToken.type === TokenType.Pipe ||
            this.currentToken.type === TokenType.Caret ||
            this.currentToken.type === TokenType.ShiftLeft ||
            this.currentToken.type === TokenType.ShiftRight
        ) {
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
            } as BinaryExpression;
        }
        return left;
    }

    private parseUnary(): Expression {
        if (this.currentToken.type === TokenType.Bang ||
            this.currentToken.type === TokenType.Minus ||
            this.currentToken.type === TokenType.Tilde ||
            this.currentToken.type === TokenType.Star ||
            this.currentToken.type === TokenType.Ampersand) {
            const opToken = this.advance();
            const argument = this.parseUnary();
            // `*` 是前缀解引用
            if (opToken.type === TokenType.Star) {
                return {
                    type: 'Dereference',
                    target: argument,
                    line: opToken.line,
                    column: opToken.column,
                    length: argument.column + argument.length - opToken.column
                } as Dereference;
            }
            // `&` 是取地址（函数指针）
            if (opToken.type === TokenType.Ampersand) {
                return {
                    type: 'AddressOf',
                    target: argument,
                    line: opToken.line,
                    column: opToken.column,
                    length: argument.column + argument.length - opToken.column
                } as AddressOf;
            }
            return {
                type: 'UnaryExpression',
                operator: opToken.value,
                argument: argument,
                line: opToken.line,
                column: opToken.column,
                length: argument.column + argument.length - opToken.column
            } as UnaryExpression;
        }
        return this.parsePrimary();
    }

    private parsePrimary(): Expression {
        const token = this.currentToken;
        let left: Expression;

        if (token.type === TokenType.OpenParen) {
            this.eat(TokenType.OpenParen);
            const inner = this.parseExpression();
            this.eat(TokenType.CloseParen);
            return inner;
        }

        if (token.type === TokenType.Number) {
            const numToken = this.eat(TokenType.Number);
            left = {
                type: 'NumberLiteral',
                value: Number(numToken.value),
                isFloat: numToken.value.includes('.') || /[eE]/.test(numToken.value),
                line: numToken.line,
                column: numToken.column,
                length: numToken.length
            } as NumberLiteral;
        }
        else if (token.type === TokenType.String) {
            const strToken = this.eat(TokenType.String);
            left = {
                type: 'StringLiteral',
                value: strToken.value,
                line: strToken.line,
                column: strToken.column,
                length: strToken.length
            } as StringLiteral;
        }
        else if (token.type === TokenType.Keyword && token.value === 'null') {
            const nullToken = this.eat(TokenType.Keyword);
            left = {
                type: 'NullLiteral',
                line: nullToken.line,
                column: nullToken.column,
                length: nullToken.length
            } as NullLiteral;
        }
        else if (token.type === TokenType.Keyword && token.value === 'native') {
            this.eat(TokenType.Keyword);
            this.eat(TokenType.OpenParen);
            const tplToken = this.eat(TokenType.String);
            this.eat(TokenType.CloseParen);
            left = {
                type: 'NativeExpression',
                template: tplToken.value,
                line: token.line,
                column: token.column,
                length: tplToken.value.length + 6
            } as NativeExpression;
        }
        else if (token.type === TokenType.Keyword && token.value === 'fuse') {
            this.eat(TokenType.Keyword);
            this.eat(TokenType.OpenParen);
            const discriminant = this.parseExpression();
            this.eat(TokenType.CloseParen);
            this.eat(TokenType.OpenBrace);
            const arms: FuseArm[] = [];
            while (this.currentToken.type !== TokenType.CloseBrace && this.currentToken.type !== TokenType.EOF) {
                let pattern: Expression | null;
                if (this.currentToken.type === TokenType.Identifier && this.currentToken.value === '_') {
                    this.eat(TokenType.Identifier);
                    pattern = null;
                } else {
                    pattern = this.parseExpression();
                }
                this.eat(TokenType.Colon);
                const value = this.parseExpression();
                arms.push({ pattern, value });
                if (this.currentToken.type === TokenType.Comma) {
                    this.eat(TokenType.Comma);
                }
            }
            this.eat(TokenType.CloseBrace);

            left = {
                type: 'FuseExpression',
                discriminant,
                arms,
                line: token.line,
                column: token.column,
                length: this.currentToken.column - token.column
            } as FuseExpression;
        }
        else if (token.type === TokenType.Keyword && token.value === 'new') {
            const newToken = this.eat(TokenType.Keyword);
            let className = this.eatIdentifierOrKeyword().value;

            while (this.currentToken.type === TokenType.ColonColon) {
                this.eat(TokenType.ColonColon);
                className += '::' + this.eatIdentifierOrKeyword().value;
            }
            if (this.currentToken.type === TokenType.LessThan) {
                this.eat(TokenType.LessThan);
                const typeArg = this.parseTypeRef();
                className += '<' + typeArg + '>';
                this.eat(TokenType.GreaterThan);
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
            } as NewExpression;
        }
        else if (token.type === TokenType.Keyword && token.value === 'make') {
            const mkToken = this.eat(TokenType.Keyword);
            let className = this.eatIdentifierOrKeyword().value;

            while (this.currentToken.type === TokenType.ColonColon) {
                this.eat(TokenType.ColonColon);
                className += '::' + this.eatIdentifierOrKeyword().value;
            }
            if (this.currentToken.type === TokenType.LessThan) {
                this.eat(TokenType.LessThan);
                const typeArg = this.parseTypeRef();
                className += '<' + typeArg + '>';
                this.eat(TokenType.GreaterThan);
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
            } as NewExpression;
        }
        else if (token.type === TokenType.Keyword && token.value === 'fn') {
            const fnToken = this.eat(TokenType.Keyword);
            this.eat(TokenType.OpenParen);
            const params: Param[] = [];
            while (this.currentToken.type !== TokenType.CloseParen) {
                const type = this.parseTypeRef();
                const name = this.eatIdentifierOrKeyword().value;
                params.push({ name, type });
                if (this.currentToken.type === TokenType.Comma) this.eat(TokenType.Comma);
            }
            this.eat(TokenType.CloseParen);

            let returnType: string | null = null;
            if ((this.currentToken.type as TokenType) === TokenType.Arrow) {
                this.eat(TokenType.Arrow);
                returnType = this.parseTypeRef();
            }

            this.eat(TokenType.OpenBrace);
            const body = this.parseBlock();

            left = {
                type: 'FunctionExpression',
                params: params,
                returnType: returnType,
                body: body,
                line: fnToken.line,
                column: fnToken.column,
                length: this.currentToken.column - fnToken.column
            } as FunctionExpression;
        }
        else if (token.type === TokenType.Keyword && BUILTIN_FUNCTIONS.includes(token.value)) {
            const funcToken = this.eat(TokenType.Keyword);
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
            } as FunctionCall;
        }
        else if (token.type === TokenType.Keyword && token.value === 'self') {
            const idToken = this.eat(TokenType.Keyword);
            left = {
                type: 'Identifier',
                name: 'self',
                line: idToken.line,
                column: idToken.column,
                length: idToken.length
            } as Identifier;
        }
        else if (token.type === TokenType.Keyword && token.value === 'result') {
            const resultToken = this.eat(TokenType.Keyword);
            left = {
                type: 'ResultExpr',
                line: resultToken.line,
                column: resultToken.column,
                length: resultToken.length
            } as ResultExpr;
        }
        else if (token.type === TokenType.Identifier) {
            const idToken = this.eat(TokenType.Identifier);

            if (this.currentToken.type === TokenType.ColonColon) {
                const segs = [idToken.value];
                while (this.currentToken.type === TokenType.ColonColon) {
                    this.eat(TokenType.ColonColon);
                    segs.push(this.eatIdentifierOrKeyword().value);
                }
                if (this.currentToken.type === TokenType.OpenParen) {
                    const args = this.parseArgs();
                    const closeParen = this.currentToken;
                    left = {
                        type: 'FunctionCall',
                        name: segs.join('::'),
                        arguments: args,
                        line: idToken.line,
                        column: idToken.column,
                        length: closeParen.column - idToken.column
                    } as FunctionCall;
                } else {
                    left = {
                        type: 'Identifier',
                        name: segs.join('::'),
                        line: idToken.line,
                        column: idToken.column,
                        length: idToken.length
                    } as Identifier;
                }
            }
            else if (this.currentToken.type === TokenType.OpenParen) {
                const args = this.parseArgs();
                const closeParen = this.currentToken;
                left = {
                    type: 'FunctionCall',
                    name: idToken.value,
                    arguments: args,
                    line: idToken.line,
                    column: idToken.column,
                    length: closeParen.column - idToken.column
                } as FunctionCall;
            }
            else {
                left = {
                    type: 'Identifier',
                    name: idToken.value,
                    line: idToken.line,
                    column: idToken.column,
                    length: idToken.length
                } as Identifier;
            }
        }
        else {
            throw new Error(`Parser Error: Unexpected token '${this.currentToken.value}' at line ${token.line}, col ${token.column}`);
        }

        while (this.currentToken.type === TokenType.Dot) {
            this.eat(TokenType.Dot);
            const propToken = this.currentToken;
            if ((this.currentToken.type as TokenType) === TokenType.Identifier || (this.currentToken.type as TokenType) === TokenType.Keyword) {
                this.advance();
            } else {
                throw new Error(`Parser Error: Expected property name after dot at line ${this.currentToken.line}, col ${this.currentToken.column}`);
            }

            let isMethodCall = false;
            const args: Expression[] = [];
            let endCol = propToken.column + propToken.length;

            if ((this.currentToken.type as TokenType) === TokenType.OpenParen) {
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
            } as MemberExpression;
        }
        return left;
    }

    private parseArgs(): Expression[] {
        this.eat(TokenType.OpenParen);
        const args: Expression[] = [];
        while (this.currentToken.type !== TokenType.CloseParen) {
            args.push(this.parseExpression());
            if (this.currentToken.type === TokenType.Comma) this.eat(TokenType.Comma);
        }
        this.eat(TokenType.CloseParen);
        return args;
    }

    private parseTypeRef(): string {
        let result = this.eatIdentifierOrKeyword().value;
        while (this.currentToken.type === TokenType.ColonColon) {
            this.eat(TokenType.ColonColon);
            result += '::' + this.eatIdentifierOrKeyword().value;
        }
        return result;
    }

    private parsePath(): string[] {
        const segs = [this.eatIdentifierOrKeyword().value];
        while (this.currentToken.type === TokenType.ColonColon) {
            this.eat(TokenType.ColonColon);
            segs.push(this.eatIdentifierOrKeyword().value);
        }
        return segs;
    }

    private parseFunctionParams(): { receiver: string | null, params: Param[] } {
        this.eat(TokenType.OpenParen);
        let receiver: string | null = null;
        const params: Param[] = [];

        if (this.currentToken.type === TokenType.Ampersand) {
            this.eat(TokenType.Ampersand);
            this.eatKeyword('self');
            receiver = '&self';
        } else if (this.isKeyword('self')) {
            this.eatKeyword('self');
            receiver = 'self';
        }

        if (receiver && this.currentToken.type === TokenType.Comma) {
            this.eat(TokenType.Comma);
        }

        while (this.currentToken.type !== TokenType.CloseParen) {
            const type = this.parseTypeRef();
            const name = this.eatIdentifierOrKeyword().value;
            params.push({ name, type });
            if (this.currentToken.type === TokenType.Comma) this.eat(TokenType.Comma);
        }

        this.eat(TokenType.CloseParen);
        return { receiver, params };
    }

    private parseModule(): ModuleDecl {
        const modToken = this.eatKeyword('mod');
        const name = this.eatIdentifierOrKeyword().value;
        this.eat(TokenType.OpenBrace);

        const body: Item[] = [];
        while (this.currentToken.type !== TokenType.CloseBrace && this.currentToken.type !== TokenType.EOF) {
            body.push(this.parseTopLevelItem() as Item);
        }
        const closeBrace = this.eat(TokenType.CloseBrace);

        return {
            type: 'ModuleDecl',
            name: name,
            body: body,
            line: modToken.line,
            column: modToken.column,
            length: closeBrace.column - modToken.column
        };
    }

    private parseUse(): UseDecl {
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
    private parseFlavor(isPub: boolean): FlavorDecl {
        const flavorToken = this.eatKeyword('flavor');
        const name = this.eatIdentifierOrKeyword().value;
        this.eat(TokenType.OpenBrace);
        const members: string[] = [];
        while (this.currentToken.type !== TokenType.CloseBrace && this.currentToken.type !== TokenType.EOF) {
            members.push(this.eatIdentifierOrKeyword().value);
            if (this.currentToken.type === TokenType.Comma) {
                this.eat(TokenType.Comma);
            }
        }
        this.eat(TokenType.CloseBrace);

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

    private parseForm(isPub: boolean, isExport: boolean = false): FormDecl {
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

    private parseTrait(isPub: boolean, isExport: boolean = false): TraitDecl {
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

    private parseImpl(): ImplDecl {
        const implToken = this.eatKeyword('impl');
        let traitName: string | null = null;
        let target: string;

        const first = this.parsePath();
        if (this.isKeyword('for')) {
            this.eatKeyword('for');
            traitName = first.join('::');
            target = this.parsePath().join('::');
        } else {
            target = first.join('::');
        }

        let rank: string | null = null;
        if (this.currentToken.type === TokenType.Dot) {
            this.eat(TokenType.Dot);
            rank = this.eatIdentifierOrKeyword().value;
        }

        this.eat(TokenType.OpenBrace);
        const methods: FnDecl[] = [];
        while (this.currentToken.type !== TokenType.CloseBrace && this.currentToken.type !== TokenType.EOF) {
            const mPub = this.isKeyword('pub');
            if (mPub) this.eatKeyword('pub');
            methods.push(this.parseMethod());
        }
        const closeBrace = this.eat(TokenType.CloseBrace);

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

    private parseTemplate(): TemplateDecl {
        const templateToken = this.eatKeyword('template');
        this.eat(TokenType.LessThan);
        const params: string[] = [this.eatIdentifierOrKeyword().value];
        while (this.currentToken.type === TokenType.Comma) {
            this.eat(TokenType.Comma);
            params.push(this.eatIdentifierOrKeyword().value);
        }
        this.eat(TokenType.GreaterThan);

        let inner: FormDecl | ImplDecl;
        if (this.isKeyword('form')) {
            inner = this.parseForm(false);
        } else if (this.isKeyword('impl')) {
            inner = this.parseImpl();
        } else {
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

    private parseInheritClause(): InheritClause | null {
        if (this.currentToken.type !== TokenType.Colon) return null;
        this.eat(TokenType.Colon);
        const base = this.parsePath().join('::');
        let ranks: string[] = [];
        if ((this.currentToken.type as TokenType) === TokenType.Dot) {
            this.eat(TokenType.Dot);
            this.eat(TokenType.OpenBrace);
            ranks = this.parseRankNameList();
            this.eat(TokenType.CloseBrace);
        }
        return { base, ranks };
    }

    private parseRankNameList(): string[] {
        const ranks: string[] = [this.eatIdentifierOrKeyword().value];
        while (this.currentToken.type === TokenType.Comma) {
            this.eat(TokenType.Comma);
            ranks.push(this.eatIdentifierOrKeyword().value);
        }
        return ranks;
    }

    private parseFormBody(): RankBlock[] {
        this.eat(TokenType.OpenBrace);
        const ranks: RankBlock[] = [];
        const defaultRank: RankBlock = { name: 'classical', fields: [], methods: [] };

        while (this.currentToken.type !== TokenType.CloseBrace && this.currentToken.type !== TokenType.EOF) {
            if (this.isKeyword('rank')) {
                this.eatKeyword('rank');
                const rankName = this.eatIdentifierOrKeyword().value;
                ranks.push(this.parseRankBlockBody(rankName));
            } else {
                const isPub = this.isKeyword('pub');
                if (isPub) this.eatKeyword('pub');
                this.parseFieldOrMethod(defaultRank, isPub);
            }
        }
        this.eat(TokenType.CloseBrace);

        if (defaultRank.fields.length > 0 || defaultRank.methods.length > 0) {
            ranks.unshift(defaultRank);
        }
        return ranks;
    }

    private parseRankBlockBody(rankName: string): RankBlock {
        this.eat(TokenType.OpenBrace);
        const block: RankBlock = { name: rankName, fields: [], methods: [] };
        while (this.currentToken.type !== TokenType.CloseBrace && this.currentToken.type !== TokenType.EOF) {
            const isPub = this.isKeyword('pub');
            if (isPub) this.eatKeyword('pub');
            this.parseFieldOrMethod(block, isPub);
        }
        this.eat(TokenType.CloseBrace);
        return block;
    }

    private parseFieldOrMethod(rank: RankBlock, isPub: boolean): void {
        const typeToken = this.parseTypeRef();
        const name = this.eatIdentifierOrKeyword().value;

        if (this.currentToken.type === TokenType.OpenParen) {
            const { receiver, params } = this.parseFunctionParams();
            this.eat(TokenType.OpenBrace);
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
        } else {
            rank.fields.push({ name: name, type: typeToken, isPub: isPub });
            this.consumeOptionalSemicolon();
        }
    }

    private parseMethod(): FnDecl {
        const returnType = this.parseTypeRef();
        const name = this.eatIdentifierOrKeyword().value;
        const { receiver, params } = this.parseFunctionParams();
        this.eat(TokenType.OpenBrace);
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

    private parseTraitBody(): RankBlock[] {
        this.eat(TokenType.OpenBrace);
        const ranks: RankBlock[] = [];
        const defaultRank: RankBlock = { name: 'classical', fields: [], methods: [] };

        while (this.currentToken.type !== TokenType.CloseBrace && this.currentToken.type !== TokenType.EOF) {
            if (this.isKeyword('rank')) {
                this.eatKeyword('rank');
                const rankName = this.eatIdentifierOrKeyword().value;
                ranks.push(this.parseTraitRankBody(rankName));
            } else {
                const isPub = this.isKeyword('pub');
                if (isPub) this.eatKeyword('pub');
                this.parseTraitMethod(defaultRank, isPub);
            }
        }
        this.eat(TokenType.CloseBrace);

        if (defaultRank.methods.length > 0) {
            ranks.unshift(defaultRank);
        }
        return ranks;
    }

    private parseTraitRankBody(rankName: string): RankBlock {
        this.eat(TokenType.OpenBrace);
        const block: RankBlock = { name: rankName, fields: [], methods: [] };
        while (this.currentToken.type !== TokenType.CloseBrace && this.currentToken.type !== TokenType.EOF) {
            const isPub = this.isKeyword('pub');
            if (isPub) this.eatKeyword('pub');
            this.parseTraitMethod(block, isPub);
        }
        this.eat(TokenType.CloseBrace);
        return block;
    }

    private parseTraitMethod(rank: RankBlock, isPub: boolean): void {
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

    private consumeOptionalSemicolon(): void {
        if (this.currentToken.type === TokenType.Semicolon) {
            this.eat(TokenType.Semicolon);
        }
    }
}