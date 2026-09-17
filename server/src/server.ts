import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    InitializeResult,
    CompletionItem,
    CompletionItemKind,
    Diagnostic,
    DiagnosticSeverity,
    SemanticTokensBuilder,
    Hover,
    MarkupKind,
    DocumentSymbol,
    SymbolKind,
    Location,
    Range,
    Position,
    SemanticTokensRequest,
    SemanticTokensParams
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { spawn } from 'child_process';
import { Lexer, TokenType } from './lexer';
import { Parser } from './parser';
import { SemanticAnalyzer } from './semantic';
import { IRGenerator } from './ir';
import { VCGenerator } from './vcgen';

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

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

connection.onInitialize((params: InitializeParams) => {
    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
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

connection.onNotification('quark/runCode', async (params: { uri: string }) => {
    const document = documents.get(params.uri);
    if (document) {
        await compileAndExecute(document);
    }
});

connection.onCompletion(
    (_textDocumentPosition): CompletionItem[] => {
        const items: CompletionItem[] = [];
        for (const kw of CONTROL_KEYWORDS) {
            items.push({ label: kw, kind: CompletionItemKind.Keyword, detail: 'Control-flow keyword' });
        }
        for (const kw of OTHER_KEYWORDS) {
            items.push({ label: kw, kind: CompletionItemKind.Keyword, detail: 'Declaration keyword' });
        }
        for (const t of TYPE_KEYWORDS) {
            items.push({ label: t, kind: CompletionItemKind.Class, detail: 'Type' });
        }
        for (const fn of BUILTIN_FUNCTIONS) {
            items.push({ label: fn, kind: CompletionItemKind.Function, detail: 'Built-in function' });
        }
        return items;
    }
);

connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        return item;
    }
);

// ─── 语义高亮（semantic tokens） ──────────
connection.onRequest(SemanticTokensRequest.type, (params: SemanticTokensParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return { data: [] };

    const builder = new SemanticTokensBuilder();
    const lexer = new Lexer(document.getText());

    const tokenTypeForKeyword = (value: string): number => {
        if (TYPE_KEYWORDS.has(value)) return 1; // type
        if (BUILTIN_FUNCTIONS.includes(value)) return 2; // function
        return 0; // keyword
    };

    const operatorTokenTypes = new Set<TokenType>([
        TokenType.Equals, TokenType.EqualsEquals, TokenType.Plus, TokenType.Minus,
        TokenType.Star, TokenType.Slash, TokenType.Percent, TokenType.LessThan,
        TokenType.LessEqual, TokenType.GreaterThan, TokenType.GreaterEqual,
        TokenType.AndAnd, TokenType.OrOr, TokenType.NotEqual, TokenType.Bang,
        TokenType.ShiftLeft, TokenType.ShiftRight, TokenType.Ampersand, TokenType.Pipe,
        TokenType.Caret, TokenType.Tilde, TokenType.Arrow, TokenType.ColonColon
    ]);

    let token = lexer.getNextToken();
    while (token.type !== TokenType.EOF) {
        const length = token.length > 0 ? token.length : token.value.length || 1;
        let typeIndex = 3; // variable 默认
        if (token.type === TokenType.Keyword) {
            typeIndex = tokenTypeForKeyword(token.value);
        } else if (token.type === TokenType.Number) {
            typeIndex = 4;
        } else if (token.type === TokenType.String) {
            typeIndex = 5;
        } else if (operatorTokenTypes.has(token.type)) {
            typeIndex = 6; // operator
        }

        builder.push(
            token.line - 1,
            token.column - 1,
            length,
            typeIndex,
            0
        );
        token = lexer.getNextToken();
    }

    return builder.build();
});

// ─── 悬停提示：关键字说明 / 标识符类型 / 内置函数说明 ──────────
connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const lexer = new Lexer(text);

    let token = lexer.getNextToken();
    while (token.type !== TokenType.EOF) {
        const start = document.offsetAt({ line: token.line - 1, character: token.column - 1 });
        const end = start + (token.length > 0 ? token.length : token.value.length || 1);
        if (offset >= start && offset <= end) {
            let content: string;
            if (token.type === TokenType.Keyword) {
                if (TYPE_KEYWORDS.has(token.value)) {
                    content = `**类型** \`${token.value}\``;
                } else if (BUILTIN_FUNCTIONS.includes(token.value)) {
                    content = `**内置函数** \`${token.value}()\``;
                } else {
                    content = `**关键字** \`${token.value}\``;
                }
            } else if (token.type === TokenType.Identifier) {
                content = `**标识符** \`${token.value}\``;
            } else if (token.type === TokenType.Number) {
                content = `**数字字面量** \`${token.value}\``;
            } else if (token.type === TokenType.String) {
                content = `**字符串字面量** \`${token.value}\``;
            } else {
                return null;
            }
            return { contents: { kind: MarkupKind.Markdown, value: content } };
        }
        token = lexer.getNextToken();
    }
    return null;
});

// ─── 文档大纲：函数 / 变量 / 模块声明 ──────────
connection.onDocumentSymbol((params): DocumentSymbol[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const symbols: DocumentSymbol[] = [];
    try {
        const lexer = new Lexer(document.getText());
        const parser = new Parser(lexer);
        const ast = parser.parse();

        const rangeOf = (node: any): Range => {
            const startLine = (node.line ?? 1) - 1;
            const startChar = (node.column ?? 1) - 1;
            const endLine = startLine;
            const endChar = startChar + (node.length ?? node.name?.length ?? 1);
            return Range.create(Position.create(startLine, startChar), Position.create(endLine, endChar));
        };

        const walk = (nodes: any[]) => {
            for (const node of nodes) {
                if (!node) continue;
                if (node.type === 'FunctionDeclaration') {
                    symbols.push({
                        name: node.name,
                        kind: SymbolKind.Function,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                    walk(node.body);
                } else if (node.type === 'VariableDeclaration') {
                    symbols.push({
                        name: node.identifier,
                        kind: SymbolKind.Variable,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                } else if (node.type === 'FormDecl') {
                    symbols.push({
                        name: node.name,
                        kind: SymbolKind.Class,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                } else if (node.type === 'TraitDecl') {
                    symbols.push({
                        name: node.name,
                        kind: SymbolKind.Interface,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                } else if (node.type === 'ModuleDecl') {
                    symbols.push({
                        name: node.name,
                        kind: SymbolKind.Namespace,
                        range: rangeOf(node),
                        selectionRange: rangeOf(node)
                    });
                    walk(node.body);
                } else if (node.type === 'IfStatement') {
                    walk(node.consequent);
                    if (node.alternate) walk(node.alternate);
                } else if (node.type === 'WhileStatement' || node.type === 'SpinStatement') {
                    walk(node.body);
                } else if (node.type === 'ForStatement') {
                    walk(node.body);
                }
            }
        };
        walk(ast.body);
    } catch {
        // 解析失败时返回空大纲，不打断编辑器
    }
    return symbols;
});

// ─── 定义跳转：查找函数 / 变量的定义位置 ──────────
connection.onDefinition((params): Location[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const results: Location[] = [];
    try {
        const text = document.getText();
        const offset = document.offsetAt(params.position);
        const lexer = new Lexer(text);
        let token = lexer.getNextToken();
        let targetName = '';
        while (token.type !== TokenType.EOF) {
            const start = document.offsetAt({ line: token.line - 1, character: token.column - 1 });
            const end = start + (token.length > 0 ? token.length : token.value.length || 1);
            if (offset >= start && offset <= end && token.type === TokenType.Identifier) {
                targetName = token.value;
                break;
            }
            token = lexer.getNextToken();
        }

        if (!targetName) return [];

        const parser = new Parser(new Lexer(text));
        const ast = parser.parse();

        const locationOf = (node: any): Location => ({
            uri: params.textDocument.uri,
            range: Range.create(
                Position.create((node.line ?? 1) - 1, (node.column ?? 1) - 1),
                Position.create((node.line ?? 1) - 1, (node.column ?? 1) - 1 + (node.length ?? node.name?.length ?? 1))
            )
        });

        const search = (nodes: any[]) => {
            for (const node of nodes) {
                if (!node) continue;
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
                if (node.body && Array.isArray(node.body)) search(node.body);
                if (node.consequent) search(node.consequent);
                if (node.alternate) search(node.alternate);
            }
        };
        search(ast.body);
    } catch {
        // 解析失败时返回空
    }
    return results;
});

documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

documents.listen(connection);
connection.listen();

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];

    try {
        const lexer = new Lexer(text);
        const parser = new Parser(lexer);
        const ast = parser.parse();

        const analyzer = new SemanticAnalyzer();
        analyzer.analyze(ast);

        for (const err of analyzer.errors) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: { line: err.line - 1, character: err.column - 1 },
                    end: { line: err.line - 1, character: err.column - 1 + err.length }
                },
                message: err.message,
                source: 'Quark Semantic Analyzer'
            });
        }

        if (analyzer.errors.length === 0) {
            const vcGen = new VCGenerator();
            const obligations = vcGen.generate(ast);
            for (const ob of obligations) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Information,
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 1 }
                    },
                    message: `Contract obligation '${ob.id}' awaiting static verification. Run 'qk verify' to prove or refute.`,
                    source: 'Quark Verifier'
                });
            }
        }
    } catch (error: any) {
        let line = 0;
        let col = 0;
        let len = 10;

        const match = error.message.match(/line (\d+), col (\d+)/);
        if (match) {
            line = Math.max(0, parseInt(match[1]) - 1);
            col = Math.max(0, parseInt(match[2]) - 1);
            len = 1;
        }

        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
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

async function compileAndExecute(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();

    try {
        const lexer = new Lexer(text);
        const parser = new Parser(lexer);
        const ast = parser.parse();
        const analyzer = new SemanticAnalyzer();
        analyzer.analyze(ast);

        if (analyzer.errors.length > 0) {
            connection.sendNotification('quark/showConsole');
            connection.sendNotification('quark/printConsole', "[Quark] Execution aborted due to semantic errors.\n");
            return;
        }

        const irGen = new IRGenerator();
        const llvmIR = irGen.generate(ast);
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/clearConsole');
        connection.sendNotification('quark/printConsole', `[Quark JIT] Compiling target: ${textDocument.uri}\n`);
        connection.sendNotification('quark/printConsole', `[Quark JIT] Booting Quantum Hardware Abstraction Layer...\n`);
        connection.sendNotification('quark/printConsole', `--------------------------------------------------------\n`);
        const backend = spawn('quark', []);
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
    } catch (error: any) {
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/printConsole', `\n[Quark System Error] ${error.message}\n`);
    }
}