"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const child_process_1 = require("child_process");
const lexer_1 = require("./lexer");
const parser_1 = require("./parser");
const semantic_1 = require("./semantic");
const ir_1 = require("./ir");
const vcgen_1 = require("./vcgen");
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
// ─── QK 关键字 / 内置函数 / 类型表（用于补全、悬停、语义高亮）──────────
const CONTROL_KEYWORDS = [
    'if', 'else', 'while', 'for', 'return', 'break', 'continue',
    'spawn', 'entangle', 'spin', 'route', 'fuse', 'fallback',
    'new', 'auto', 'let', 'fn', 'result', 'unsafe'
];
const OTHER_KEYWORDS = [
    'mod', 'use', 'pub', 'form', 'impl', 'trait', 'template', 'rank', 'self',
    'lattice', 'export', 'import', 'extern', 'requires', 'ensures', 'invariant',
    'from', 'make', 'cap', 'native', 'fixed', 'flavor', 'addr', 'basis_state', 'path'
];
const TYPE_KEYWORDS = new Set([
    'int', 'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'float', 'double', 'string', 'char', 'bool',
    'Qubit', 'QObject', 'QModel', 'QRegister', 'Result',
    'DiracState', 'BellState', 'QuantumRegister', 'QReservoir'
]);
const BUILTIN_FUNCTIONS = [
    'alloc', 'measure', 'measure_x', 'measure_y', 'encode_text', 'encode_image',
    'qlm_invoke', 'qlm_load', 'qk_encode_string', 'qlm_forward', 'qk_decode_string',
    'mind_read', 'mind_train', 'mind_feedback', 'veda_qlm_train',
    'h', 'x', 'rz', 'cnot', 'toffoli', 'swap', 'qft', 'braid',
    'surrogate', 'tanh_quantize', 'lif_step', 'mellowmax2', 'logsumexp2', 'boltzmann2',
    'tnorm_luk', 'tnorm_prod', 'tnorm_godel', 'polymer_weight', 'polymer_mix_bound',
    'qk_sys_call', 'qk_sys_calld', 'qk_sys_log', 'qk_sys_logi', 'qk_sys_callp', 'qk_gc_free',
    'qk_qms_gap', 'qk_mix_bound', 'qk_qms_conc',
    'sync_load', 'sync_store', 'sync_add', 'sync_cas', 'outb', 'inb', 'qk_gc_alloc',
    'qchain_wallet', 'qchain_mint', 'qchain_transfer', 'qchain_balance',
    'qchain_mine', 'qchain_height', 'qchain_verify', 'qchain_qkd', 'qchain_qdba',
    'qchain_coin_mint', 'qchain_coin_verify', 'qchain_sha3', 'qchain_hmac', 'qchain_hash_unicode',
    'qchain_sign', 'qchain_sign_verify', 'qchain_sign_pubkey', 'qchain_mlkem_encaps',
    'qchain_mlkem_decaps', 'qchain_causal_verify', 'qchain_cipher_encrypt', 'qchain_cipher_decrypt'
];
connection.onInitialize((params) => {
    const result = {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true
            },
            hoverProvider: true,
            definitionProvider: true,
            documentSymbolProvider: true,
            semanticTokensProvider: {
                legend: {
                    tokenTypes: ['keyword', 'type', 'function', 'variable', 'number', 'string', 'operator'],
                    tokenModifiers: []
                },
                full: true
            }
        }
    };
    return result;
});
connection.onNotification('quark/runCode', async (params) => {
    const document = documents.get(params.uri);
    if (document) {
        await compileAndExecute(document);
    }
});
connection.onCompletion((_textDocumentPosition) => {
    const items = [];
    for (const kw of CONTROL_KEYWORDS) {
        items.push({ label: kw, kind: node_1.CompletionItemKind.Keyword, detail: 'Control-flow keyword' });
    }
    for (const kw of OTHER_KEYWORDS) {
        items.push({ label: kw, kind: node_1.CompletionItemKind.Keyword, detail: 'Declaration keyword' });
    }
    for (const t of TYPE_KEYWORDS) {
        items.push({ label: t, kind: node_1.CompletionItemKind.Class, detail: 'Type' });
    }
    for (const fn of BUILTIN_FUNCTIONS) {
        items.push({ label: fn, kind: node_1.CompletionItemKind.Function, detail: 'Built-in function' });
    }
    return items;
});
connection.onCompletionResolve((item) => {
    return item;
});
// ─── 语义高亮（semantic tokens） ──────────
connection.onRequest(node_1.SemanticTokensRequest.type, (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return { data: [] };
    const builder = new node_1.SemanticTokensBuilder();
    const lexer = new lexer_1.Lexer(document.getText());
    const tokenTypeForKeyword = (value) => {
        if (TYPE_KEYWORDS.has(value))
            return 1; // type
        if (BUILTIN_FUNCTIONS.includes(value))
            return 2; // function
        return 0; // keyword
    };
    const operatorTokenTypes = new Set([
        lexer_1.TokenType.Equals, lexer_1.TokenType.EqualsEquals, lexer_1.TokenType.Plus, lexer_1.TokenType.Minus,
        lexer_1.TokenType.Star, lexer_1.TokenType.Slash, lexer_1.TokenType.Percent, lexer_1.TokenType.LessThan,
        lexer_1.TokenType.LessEqual, lexer_1.TokenType.GreaterThan, lexer_1.TokenType.GreaterEqual,
        lexer_1.TokenType.AndAnd, lexer_1.TokenType.OrOr, lexer_1.TokenType.NotEqual, lexer_1.TokenType.Bang,
        lexer_1.TokenType.ShiftLeft, lexer_1.TokenType.ShiftRight, lexer_1.TokenType.Ampersand, lexer_1.TokenType.Pipe,
        lexer_1.TokenType.Caret, lexer_1.TokenType.Tilde, lexer_1.TokenType.Arrow, lexer_1.TokenType.ColonColon
    ]);
    let token = lexer.getNextToken();
    while (token.type !== lexer_1.TokenType.EOF) {
        const length = token.length > 0 ? token.length : token.value.length || 1;
        let typeIndex = 3; // variable 默认
        if (token.type === lexer_1.TokenType.Keyword) {
            typeIndex = tokenTypeForKeyword(token.value);
        }
        else if (token.type === lexer_1.TokenType.Number) {
            typeIndex = 4;
        }
        else if (token.type === lexer_1.TokenType.String) {
            typeIndex = 5;
        }
        else if (operatorTokenTypes.has(token.type)) {
            typeIndex = 6; // operator
        }
        builder.push(token.line - 1, token.column - 1, length, typeIndex, 0);
        token = lexer.getNextToken();
    }
    return builder.build();
});
// ─── 悬停提示：关键字说明 / 标识符类型 / 内置函数说明 ──────────
connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return null;
    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const lexer = new lexer_1.Lexer(text);
    let token = lexer.getNextToken();
    while (token.type !== lexer_1.TokenType.EOF) {
        const start = document.offsetAt({ line: token.line - 1, character: token.column - 1 });
        const end = start + (token.length > 0 ? token.length : token.value.length || 1);
        if (offset >= start && offset <= end) {
            let content;
            if (token.type === lexer_1.TokenType.Keyword) {
                if (TYPE_KEYWORDS.has(token.value)) {
                    content = `**类型** \`${token.value}\``;
                }
                else if (BUILTIN_FUNCTIONS.includes(token.value)) {
                    content = `**内置函数** \`${token.value}()\``;
                }
                else {
                    content = `**关键字** \`${token.value}\``;
                }
            }
            else if (token.type === lexer_1.TokenType.Identifier) {
                content = `**标识符** \`${token.value}\``;
            }
            else if (token.type === lexer_1.TokenType.Number) {
                content = `**数字字面量** \`${token.value}\``;
            }
            else if (token.type === lexer_1.TokenType.String) {
                content = `**字符串字面量** \`${token.value}\``;
            }
            else {
                return null;
            }
            return { contents: { kind: node_1.MarkupKind.Markdown, value: content } };
        }
        token = lexer.getNextToken();
    }
    return null;
});
// ─── 文档大纲：函数 / 变量 / 模块声明 ──────────
connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return [];
    const symbols = [];
    try {
        const lexer = new lexer_1.Lexer(document.getText());
        const parser = new parser_1.Parser(lexer);
        const ast = parser.parse();
        const rangeOf = (node) => {
            const startLine = (node.line ?? 1) - 1;
            const startChar = (node.column ?? 1) - 1;
            const endLine = startLine;
            const endChar = startChar + (node.length ?? node.name?.length ?? 1);
            return node_1.Range.create(node_1.Position.create(startLine, startChar), node_1.Position.create(endLine, endChar));
        };
        const walk = (nodes) => {
            for (const node of nodes) {
                if (!node)
                    continue;
                if (node.type === 'FunctionDeclaration') {
                    symbols.push({
                        name: node.name,
                        kind: node_1.SymbolKind.Function,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                    walk(node.body);
                }
                else if (node.type === 'VariableDeclaration') {
                    symbols.push({
                        name: node.identifier,
                        kind: node_1.SymbolKind.Variable,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                }
                else if (node.type === 'FormDecl') {
                    symbols.push({
                        name: node.name,
                        kind: node_1.SymbolKind.Class,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                }
                else if (node.type === 'TraitDecl') {
                    symbols.push({
                        name: node.name,
                        kind: node_1.SymbolKind.Interface,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                }
                else if (node.type === 'ModuleDecl') {
                    symbols.push({
                        name: node.name,
                        kind: node_1.SymbolKind.Namespace,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                    walk(node.body);
                }
                else if (node.type === 'IfStatement') {
                    walk(node.consequent);
                    if (node.alternate)
                        walk(node.alternate);
                }
                else if (node.type === 'WhileStatement' || node.type === 'SpinStatement') {
                    walk(node.body);
                }
                else if (node.type === 'ForStatement') {
                    walk(node.body);
                }
            }
        };
        walk(ast.body);
    }
    catch {
        // 解析失败时返回空大纲，不打断编辑器
    }
    return symbols;
});
// ─── 定义跳转：查找函数 / 变量的定义位置 ──────────
connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return [];
    const results = [];
    try {
        const text = document.getText();
        const offset = document.offsetAt(params.position);
        const lexer = new lexer_1.Lexer(text);
        let token = lexer.getNextToken();
        let targetName = '';
        while (token.type !== lexer_1.TokenType.EOF) {
            const start = document.offsetAt({ line: token.line - 1, character: token.column - 1 });
            const end = start + (token.length > 0 ? token.length : token.value.length || 1);
            if (offset >= start && offset <= end && token.type === lexer_1.TokenType.Identifier) {
                targetName = token.value;
                break;
            }
            token = lexer.getNextToken();
        }
        if (!targetName)
            return [];
        const parser = new parser_1.Parser(new lexer_1.Lexer(text));
        const ast = parser.parse();
        const locationOf = (node) => ({
            uri: params.textDocument.uri,
            range: node_1.Range.create(node_1.Position.create((node.line ?? 1) - 1, (node.column ?? 1) - 1), node_1.Position.create((node.line ?? 1) - 1, (node.column ?? 1) - 1 + (node.length ?? node.name?.length ?? 1)))
        });
        const search = (nodes) => {
            for (const node of nodes) {
                if (!node)
                    continue;
                if (node.type === 'FunctionDeclaration' && node.name === targetName) {
                    results.push(locationOf(node));
                }
                if (node.type === 'VariableDeclaration' && node.identifier === targetName) {
                    results.push(locationOf(node));
                }
                if (node.type === 'FormDecl' && node.name === targetName) {
                    results.push(locationOf(node));
                }
                if (node.type === 'TraitDecl' && node.name === targetName) {
                    results.push(locationOf(node));
                }
                if (node.body && Array.isArray(node.body))
                    search(node.body);
                if (node.consequent)
                    search(node.consequent);
                if (node.alternate)
                    search(node.alternate);
            }
        };
        search(ast.body);
    }
    catch {
        // 解析失败时返回空
    }
    return results;
});
documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});
documents.listen(connection);
connection.listen();
async function validateTextDocument(textDocument) {
    const text = textDocument.getText();
    const diagnostics = [];
    try {
        const lexer = new lexer_1.Lexer(text);
        const parser = new parser_1.Parser(lexer);
        const ast = parser.parse();
        const analyzer = new semantic_1.SemanticAnalyzer();
        analyzer.analyze(ast);
        for (const err of analyzer.errors) {
            diagnostics.push({
                severity: node_1.DiagnosticSeverity.Error,
                range: {
                    start: { line: err.line - 1, character: err.column - 1 },
                    end: { line: err.line - 1, character: err.column - 1 + err.length }
                },
                message: err.message,
                source: 'Quark Semantic Analyzer'
            });
        }
        if (analyzer.errors.length === 0) {
            const vcGen = new vcgen_1.VCGenerator();
            const obligations = vcGen.generate(ast);
            for (const ob of obligations) {
                diagnostics.push({
                    severity: node_1.DiagnosticSeverity.Information,
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 1 }
                    },
                    message: `Contract obligation '${ob.id}' awaiting static verification. Run 'qk verify' to prove or refute.`,
                    source: 'Quark Verifier'
                });
            }
        }
    }
    catch (error) {
        let line = 0;
        let col = 0;
        let len = 10;
        const match = error.message.match(/line (\d+), col (\d+)/);
        if (match) {
            line = Math.max(0, parseInt(match[1]) - 1);
            col = Math.max(0, parseInt(match[2]) - 1);
            len = 1;
        }
        const diagnostic = {
            severity: node_1.DiagnosticSeverity.Error,
            range: {
                start: { line: line, character: col },
                end: { line: line, character: col + len }
            },
            message: error.message,
            source: 'Quark Compiler'
        };
        diagnostics.push(diagnostic);
    }
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}
async function compileAndExecute(textDocument) {
    const text = textDocument.getText();
    try {
        const lexer = new lexer_1.Lexer(text);
        const parser = new parser_1.Parser(lexer);
        const ast = parser.parse();
        const analyzer = new semantic_1.SemanticAnalyzer();
        analyzer.analyze(ast);
        if (analyzer.errors.length > 0) {
            connection.sendNotification('quark/showConsole');
            connection.sendNotification('quark/printConsole', "[Quark] Execution aborted due to semantic errors.\n");
            return;
        }
        const irGen = new ir_1.IRGenerator();
        const llvmIR = irGen.generate(ast);
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/clearConsole');
        connection.sendNotification('quark/printConsole', `[Quark JIT] Compiling target: ${textDocument.uri}\n`);
        connection.sendNotification('quark/printConsole', `[Quark JIT] Booting Quantum Hardware Abstraction Layer...\n`);
        connection.sendNotification('quark/printConsole', `--------------------------------------------------------\n`);
        const backend = (0, child_process_1.spawn)('quark', []);
        backend.on('error', (err) => {
            connection.sendNotification('quark/printConsole', `[Quark JIT] Failed to spawn runtime: ${err.message}\n`);
            connection.sendNotification('quark/printConsole', `[Quark JIT] Ensure 'quark' (Quark Runtime) is installed and on PATH.\n`);
        });
        backend.stdout.on('data', (data) => {
            connection.sendNotification('quark/printConsole', data.toString());
        });
        backend.stderr.on('data', (data) => {
            connection.sendNotification('quark/printConsole', `[QHAL ERROR] ${data.toString()}`);
        });
        backend.on('close', (code) => {
            connection.sendNotification('quark/printConsole', `--------------------------------------------------------\n`);
            connection.sendNotification('quark/printConsole', `[Quark JIT] Process terminated with exit code ${code}\n`);
        });
        if (backend.stdin) {
            backend.stdin.write("COMPILE\n");
            backend.stdin.write(llvmIR + "\n");
            backend.stdin.write("END_COMPILE\n");
            backend.stdin.write("EXECUTE int32 quark_main\n");
            backend.stdin.write("EXIT\n");
            backend.stdin.end();
        }
    }
    catch (error) {
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/printConsole', `\n[Quark System Error] ${error.message}\n`);
    }
}
//# sourceMappingURL=server.js.map