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
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { Lexer, TokenType } from './lexer';
import { Parser } from './parser';
import { SemanticAnalyzer } from './semantic';
import { IRGenerator } from './ir';
import { VCGenerator } from './vcgen';
import { KEYWORD_DOCS, TYPE_DOCS, FUNCTION_DOCS, ANNOTATION_DOCS, renderHover, Lang } from './hover-docs';
import { migrate, detectLang } from './migrate';
import { Cmd, PROTOCOL_VERSION, encodeFrame, decodeFrames } from './protocol';

const DAEMON_PORT = 50052;

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// 悬停提示语言：根据开发者系统语言（LSP Initialize 的 `locale`）自动选择中文或英文。
let hoverLang: Lang = 'zh';

// 悬停提示的分节 / 类别标签多语言文案
const HOVER_TEXT = {
    kind: {
        type: { zh: '类型', en: 'Type' },
        fn: { zh: '内置函数', en: 'Built-in function' },
        keyword: { zh: '关键字', en: 'Keyword' },
        annotation: { zh: '注解', en: 'Annotation' },
    },
    fallback: {
        keyword: { zh: '关键字', en: 'Keyword' },
        identifier: { zh: '标识符', en: 'Identifier' },
        number: { zh: '数字字面量', en: 'Number literal' },
        string: { zh: '字符串字面量', en: 'String literal' },
        annotation: { zh: '注解', en: 'Annotation' },
    },
} as const;

const t = (entry: { zh: string; en: string }): string => entry[hoverLang];

// 定位 runtime：优先扩展目录下的 bin/runtime（随 vsix 打包，开箱即用），
// 回退到 PATH 中的 quark 命令（用户自行安装的 runtime）。
// 这样一箭双雕。
function resolveRuntime(): { path: string; env?: NodeJS.ProcessEnv } {
    const extRoot = path.resolve(__dirname, '..', '..');
    // 合并打包：bin/ 下按平台分子目录（linux-x64 / win32-x64 / darwin-x64），
    // 一个 vsix 同时携带多个平台的 runtime，安装后按 process.platform 选择。
    const platformDir = process.platform === 'win32' ? 'win32-x64'
        : process.platform === 'darwin' ? 'darwin-x64' : 'linux-x64';
    const binDir = path.join(extRoot, 'bin', platformDir);
    const binName = process.platform === 'win32' ? 'runtime.exe' : 'runtime';
    const bundled = path.join(binDir, binName);
    if (!fs.existsSync(bundled)) return { path: 'quark' };

    // Linux / macOS：vsix（zip）不保留可执行位，安装后 runtime 往往是 0644，
    // 直接 spawn 会 EACCES；这里按需补上执行权限（失败不致命，回退到 PATH 里的 quark）。
    if (process.platform !== 'win32') {
        try { fs.chmodSync(bundled, 0o755); } catch { /* 忽略：只读 FS 等情形 */ }
    }

    // Linux / macOS：让动态链接器在 bin/<platform>/ 里找到随 vsix 打包的 libquark_rt.so，
    // 否则 spawn 时 `runtime` 会因缺依赖而启动失败。
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (process.platform !== 'win32') {
        const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
        const prev = process.env[key] || '';
        env[key] = prev ? `${binDir}${path.delimiter}${prev}` : binDir;
    }
    return { path: bundled, env };
}

// ─── daemon 执行（侧边栏与执行共享同一 QVM 快照）──────────────────────────

/** 尝试 ping daemon（连接成功即返回 true） */
function pingDaemon(timeoutMs = 500): Promise<boolean> {
    return new Promise(res => {
        const s = net.createConnection({ port: DAEMON_PORT, host: 'localhost' });
        const done = (ok: boolean) => { s.destroy(); res(ok); };
        s.on('connect', () => done(true));
        s.on('error', () => done(false));
        s.setTimeout(timeoutMs, () => done(false));
    });
}

/**
 * 确保 daemon 运行：先尝试连接，失败则 spawn `runtime --daemon` 并等待就绪。
 * 执行改走 daemon 后，用户代码的量子操作作用在 daemon 的共享 QVM 上，
 * 侧边栏通过 GET_SNAPSHOT 即可读到「刚执行代码」的量子对象 / 比特状态。
 */
async function ensureDaemon(): Promise<void> {
    if (await pingDaemon()) return;

    const rt = resolveRuntime();
    const daemon = spawn(rt.path, ['--daemon'], rt.env ? { env: rt.env } : {});
    daemon.stderr.on('data', d => connection.sendNotification('quark/printConsole', `[Quark Daemon] ${d.toString()}`));
    daemon.on('error', () => { /* 忽略，等待超时兜底 */ });

    for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 250));
        if (await pingDaemon()) return;
    }
    throw new Error(`Failed to start Quark daemon on port ${DAEMON_PORT}`);
}

/** 通过 daemon 发送一串命令帧，读取响应并逐帧回调。 */
function daemonRequest(frames: Buffer[], onOutput: (text: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const sock = net.createConnection({ port: DAEMON_PORT, host: 'localhost' });
        let recv: Buffer = Buffer.alloc(0);
        sock.on('connect', () => {
            sock.write(encodeFrame(Cmd.HELLO, PROTOCOL_VERSION));
            for (const f of frames) sock.write(f);
            sock.write(encodeFrame(Cmd.EXIT));
        });
        sock.on('data', (d: Buffer) => {
            recv = Buffer.concat([recv, d]);
            const { frames: parsed, rest } = decodeFrames(recv);
            recv = rest;
            for (const f of parsed) onOutput(f);
        });
        sock.on('close', () => resolve());
        sock.on('error', reject);
    });
}

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
    'h', 'x', 'rz', 'cnot', 'toffoli', 'swap', 'qft', 'iqft', 'braid',
    'cx', 'ch', 'crz', 'cswap', 'c_toffoli', 'cqft', 'cbraid',
    'surrogate', 'tanh_quantize', 'lif_step', 'mellowmax2', 'logsumexp2', 'boltzmann2',
    'tnorm_luk', 'tnorm_prod', 'tnorm_godel', 'polymer_weight', 'polymer_mix_bound',
    'qk_sys_call', 'qk_sys_calld', 'qk_sys_log', 'qk_sys_logi', 'qk_sys_callp', 'qk_gc_free',
    'qk_qms_gap', 'qk_mix_bound', 'qk_qms_conc',
    'sync_load', 'sync_store', 'sync_add', 'sync_cas', 'sync_lock', 'sync_unlock',
    'outb', 'inb', 'outw', 'inw', 'outl', 'inl', 'qk_gc_alloc',
    'strlen', 'kglobals_addr',
    'qchain_wallet', 'qchain_mint', 'qchain_transfer', 'qchain_balance',
    'qchain_mine', 'qchain_height', 'qchain_verify', 'qchain_qkd', 'qchain_qdba',
    'qchain_coin_mint', 'qchain_coin_verify', 'qchain_sha3', 'qchain_hmac', 'qchain_hash_unicode',
    'qchain_sign', 'qchain_sign_verify', 'qchain_sign_pubkey', 'qchain_mlkem_encaps',
    'qchain_mlkem_decaps', 'qchain_causal_verify', 'qchain_cipher_encrypt', 'qchain_cipher_decrypt'
];

// 注解标签：多维拓扑调度（@layer）+ 可逆编织门合成 + 量子物理特性 + 经典编译属性
const ANNOTATION_KEYWORDS = [
    '@layer', '@[gate]', '@[undo]', '@[steer]', '@[unitary]', '@[measure]',
    '@[coherence]', '@[noise]', '@[basis]', '@[decoherence_free]', '@[error_correction]',
    '@[inline]', '@[noinline]', '@[pure]', '@[readonly]', '@[cold]', '@[hot]',
    '@[noreturn]', '@[export]', '@[section]', '@[naked]'
];

connection.onInitialize((params: InitializeParams) => {
    // 根据开发者系统语言选择悬停提示语言：中文（zh*）→ 中文，其余（en* 等）→ 英文。
    hoverLang = ((params.locale ?? '').toLowerCase().startsWith('zh')) ? 'zh' : 'en';

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

connection.onNotification('quark/compileCode', async (params: { uri: string; arch?: string }) => {
    const document = documents.get(params.uri);
    if (document) {
        await compileToBinary(document, params.arch ?? 'x64');
    }
});

connection.onNotification('quark/buildCode', async (params: { uri: string }) => {
    const document = documents.get(params.uri);
    if (document) {
        await buildIR(document);
    }
});

// 迁移现有量子语言源码（OpenQASM/Q#/Quil/Silq）为 .qk：右键菜单触发。
// 直接读文件系统（源语言非 quark 文档，不经 documents），迁移结果写到同名 .qk。
connection.onNotification('quark/migrateCode', async (params: { fsPath: string }) => {
    try {
        const src = fs.readFileSync(params.fsPath, 'utf-8');
        const lang = detectLang(src);
        if (!lang) {
            connection.sendNotification('quark/showConsole');
            connection.sendNotification('quark/printConsole', '[Quark Migrate] Cannot detect source language (expect OpenQASM/Q#/Quil/Silq).\n');
            return;
        }
        const qkSrc = migrate(src, lang);
        const outPath = params.fsPath.replace(/\.[^.]+$/, '.qk');
        fs.writeFileSync(outPath, qkSrc, 'utf-8');
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/printConsole', `[Quark Migrate] ${path.basename(params.fsPath)} (${lang}) -> ${outPath}\n`);
    } catch (e: any) {
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/printConsole', `[Quark Migrate] ${e.message}\n`);
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
        for (const ann of ANNOTATION_KEYWORDS) {
            items.push({ label: ann, kind: CompletionItemKind.Keyword, detail: 'Annotation tag' });
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

// ─── 悬停提示：关键字 / 类型 / 内置函数的详细说明（作用、语法、参数等）──────────
connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;

    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const lexer = new Lexer(text);

    // 悬停到注解标签（@layer / @[gate] / @[coherence] 等）时，按 '@name' / '@[name]' 键查找
    const annotationAt = (tokenStart: number): string | null => {
        if (tokenStart > 0 && text[tokenStart - 1] === '@') return '@';
        if (tokenStart > 1 && text[tokenStart - 1] === '[' && text[tokenStart - 2] === '@') return '@[';
        return null;
    };

    let token = lexer.getNextToken();
    while (token.type !== TokenType.EOF) {
        const start = document.offsetAt({ line: token.line - 1, character: token.column - 1 });
        const end = start + (token.length > 0 ? token.length : token.value.length || 1);
        if (offset >= start && offset <= end) {
            let content: string;
            if (token.type === TokenType.Keyword) {
                if (TYPE_DOCS[token.value]) {
                    content = renderHover(t(HOVER_TEXT.kind.type), token.value, TYPE_DOCS[token.value], hoverLang);
                } else if (FUNCTION_DOCS[token.value]) {
                    content = renderHover(t(HOVER_TEXT.kind.fn), token.value, FUNCTION_DOCS[token.value], hoverLang);
                } else if (KEYWORD_DOCS[token.value]) {
                    content = renderHover(t(HOVER_TEXT.kind.keyword), token.value, KEYWORD_DOCS[token.value], hoverLang);
                } else {
                    content = `**${t(HOVER_TEXT.fallback.keyword)}** \`${token.value}\``;
                }
            } else if (token.type === TokenType.Identifier) {
                const annPrefix = annotationAt(start);
                if (annPrefix) {
                    const key = annPrefix + token.value + (annPrefix === '@[' ? ']' : '');
                    if (ANNOTATION_DOCS[key]) {
                        content = renderHover(t(HOVER_TEXT.kind.annotation), key, ANNOTATION_DOCS[key], hoverLang);
                    } else {
                        content = `**${t(HOVER_TEXT.fallback.annotation)}** \`${key}\``;
                    }
                } else if (FUNCTION_DOCS[token.value]) {
                    // 门函数（h / x / rz / cnot 等）在词法上属标识符，仍展示内置函数说明
                    content = renderHover(t(HOVER_TEXT.kind.fn), token.value, FUNCTION_DOCS[token.value], hoverLang);
                } else if (TYPE_DOCS[token.value]) {
                    // 部分类型名（如 void）在词法上属标识符，仍展示类型说明
                    content = renderHover(t(HOVER_TEXT.kind.type), token.value, TYPE_DOCS[token.value], hoverLang);
                } else {
                    content = `**${t(HOVER_TEXT.fallback.identifier)}** \`${token.value}\``;
                }
            } else if (token.type === TokenType.Number) {
                content = `**${t(HOVER_TEXT.fallback.number)}** \`${token.value}\``;
            } else if (token.type === TokenType.String) {
                content = `**${t(HOVER_TEXT.fallback.string)}** \`${token.value}\``;
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
                } else if (node.type === 'VariableDeclarationList') {
                    for (const d of node.declarations) {
                        symbols.push({
                            name: d.identifier,
                            kind: SymbolKind.Variable,
                            range: rangeOf(d),
                            selectionRange: rangeOf(d)
                        });
                    }
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
                if (node.type === 'VariableDeclarationList') {
                    for (const d of node.declarations) {
                        if (d.identifier === targetName) results.push(locationOf(d));
                    }
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
        const t0 = Date.now();
        const lexer = new Lexer(text);
        const parser = new Parser(lexer);
        const ast = parser.parse();
        const analyzer = new SemanticAnalyzer();
        analyzer.analyze(ast);

        if (analyzer.errors.length > 0) {
            connection.sendNotification('quark/showConsole');
            connection.sendNotification('quark/printConsole', "[Quark] Execution aborted due to semantic errors.\n");
            connection.sendNotification('quark/performance', { action: 'run', compileMs: 0, execMs: 0, backend: '—', status: 'semantic-error', at: Date.now() });
            return;
        }

        const irGen = new IRGenerator();
        const llvmIR = irGen.generate(ast);
        // 多维标签函数（@layer）走拓扑入口 qk_topology_entry；否则脚本模式 quark_main
        const hasLayerFns = ast.body.some(n => (n as any).type === 'FunctionDeclaration' && (n as any).layer);
        const entryFunc = hasLayerFns ? 'qk_topology_entry' : 'quark_main';
        const compileMs = Date.now() - t0;

        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/clearConsole');
        connection.sendNotification('quark/printConsole', `[Quark JIT] Compiling target: ${textDocument.uri}\n`);
        connection.sendNotification('quark/printConsole', `[Quark JIT] Connecting to daemon (port ${DAEMON_PORT})...\n`);
        connection.sendNotification('quark/printConsole', `--------------------------------------------------------\n`);

        // 执行走 daemon：用户代码量子操作作用在 daemon 共享 QVM，侧边栏可读快照
        const execStart = Date.now();
        await ensureDaemon();
        await daemonRequest([
            encodeFrame(Cmd.COMPILE, llvmIR),
            encodeFrame(Cmd.EXECUTE, `int32 ${entryFunc}`),
        ], (out) => connection.sendNotification('quark/printConsole', out));
        const execMs = Date.now() - execStart;

        connection.sendNotification('quark/printConsole', `--------------------------------------------------------\n`);
        connection.sendNotification('quark/performance', { action: 'run', compileMs, execMs, backend: 'QVM', status: 'done', at: Date.now() });
    } catch (error: any) {
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/printConsole', `\n[Quark System Error] ${error.message}\n`);
        connection.sendNotification('quark/performance', { action: 'run', compileMs: 0, execMs: 0, backend: '—', status: 'error', at: Date.now() });
    }
}

// ─── 编译（AOT）：生成 IR + AOT 编译为指定架构原生二进制 ──────────
async function compileToBinary(textDocument: TextDocument, arch: string): Promise<void> {
    try {
        const t0 = Date.now();
        const text = textDocument.getText();
        const lexer = new Lexer(text);
        const parser = new Parser(lexer);
        const ast = parser.parse();
        const analyzer = new SemanticAnalyzer();
        analyzer.analyze(ast);
        if (analyzer.errors.length > 0) {
            connection.sendNotification('quark/showConsole');
            connection.sendNotification('quark/printConsole', "[Quark] Compilation aborted due to semantic errors.\n");
            return;
        }
        const irGen = new IRGenerator();
        const llvmIR = irGen.generate(ast);
        const filePath = textDocument.uri.replace(/^file:\/\//, '');
        const baseName = path.basename(filePath).replace(/\.[^.]+$/, '');
        const compileMs = Date.now() - t0;

        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/clearConsole');
        connection.sendNotification('quark/printConsole', `[Quark AOT] Compiling to native binary (${arch}): ${baseName}\n`);

        await ensureDaemon();
        await daemonRequest([
            encodeFrame(Cmd.AOT_COMPILE, `compile ${arch} ${baseName}\n${llvmIR}`),
        ], (out) => connection.sendNotification('quark/printConsole', out));

        connection.sendNotification('quark/performance', { action: 'compile', compileMs, execMs: 0, backend: '—', status: 'done', at: Date.now() });
    } catch (error: any) {
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/printConsole', `\n[Quark System Error] ${error.message}\n`);
        connection.sendNotification('quark/performance', { action: 'compile', compileMs: 0, execMs: 0, backend: '—', status: 'error', at: Date.now() });
    }
}

// ─── 构建（生成 IR）：生成 LLVM IR 保存到 .ll 文件 ──────────
async function buildIR(textDocument: TextDocument): Promise<void> {
    try {
        const text = textDocument.getText();
        const lexer = new Lexer(text);
        const parser = new Parser(lexer);
        const ast = parser.parse();
        const analyzer = new SemanticAnalyzer();
        analyzer.analyze(ast);
        if (analyzer.errors.length > 0) {
            connection.sendNotification('quark/showConsole');
            connection.sendNotification('quark/printConsole', "[Quark] Build aborted due to semantic errors.\n");
            return;
        }
        const irGen = new IRGenerator();
        const llvmIR = irGen.generate(ast);
        const filePath = textDocument.uri.replace(/^file:\/\//, '');
        const outPath = filePath.replace(/\.[^.]+$/, '.ll');
        fs.writeFileSync(outPath, llvmIR, 'utf-8');

        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/clearConsole');
        connection.sendNotification('quark/printConsole', `[Quark Build] LLVM IR generated.\n`);
        connection.sendNotification('quark/printConsole', `[Quark Build] Written to: ${outPath}\n`);
    } catch (error: any) {
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/printConsole', `\n[Quark System Error] ${error.message}\n`);
    }
}