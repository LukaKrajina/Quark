"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const child_process_1 = require("child_process");
const lexer_1 = require("./lexer");
const parser_1 = require("./parser");
const semantic_1 = require("./semantic");
const ir_1 = require("./ir");
<<<<<<< HEAD
=======
const vcgen_1 = require("./vcgen");
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
connection.onInitialize((params) => {
    const result = {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true
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
    return [
        {
            label: 'alloc',
            kind: node_1.CompletionItemKind.Function,
            data: 1,
            detail: 'Allocates a new Qubit',
            documentation: 'Allocates a strongly typed Qubit. Quark statically guarantees this cannot be cloned.'
        },
        {
            label: 'measure',
            kind: node_1.CompletionItemKind.Function,
            data: 2,
            detail: 'Measures a Qubit to a classical integer',
            documentation: 'Collapses the quantum state and automatically assigns the eigenvalue to a classical container.'
        },
        {
            label: 'encode_text',
            kind: node_1.CompletionItemKind.Function,
            data: 3,
            detail: 'Encodes text string directly into a Quantum State QObject',
            documentation: 'Translates natural language prompt text directly into basis state amplitudes.'
        },
        {
            label: 'qlm_invoke',
            kind: node_1.CompletionItemKind.Function,
            data: 4,
            detail: 'Invokes QLM Variational Quantum Circuit training',
            documentation: 'Executes ADM Spacetime Sliced optimization loops and returns a trained QModel.'
        },
        {
            label: 'mind_read',
            kind: node_1.CompletionItemKind.Function,
            data: 5,
            detail: 'Reads brain signals and encodes them into a quantum state',
            documentation: 'Acquires a neural signal (stream/spike/lfp/eeg/sensor) and encodes it into a QObject via the QBNS Transducer.'
        },
        {
            label: 'mind_train',
            kind: node_1.CompletionItemKind.Function,
            data: 6,
            detail: 'Trains the QLM from a brain-derived quantum state',
            documentation: 'Uses the encoded brain state as a dataset to train and export the Quantum Language Model.'
        },
        {
            label: 'mind_feedback',
            kind: node_1.CompletionItemKind.Function,
            data: 7,
            detail: 'Measures a brain state and closes the neurofeedback loop',
            documentation: 'Collapses the encoded brain state and simulates motor-cortex stimulation.'
        }
    ];
});
connection.onCompletionResolve((item) => {
    return item;
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
<<<<<<< HEAD
=======
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
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
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
<<<<<<< HEAD
=======
        backend.on('error', (err) => {
            connection.sendNotification('quark/printConsole', `[Quark JIT] Failed to spawn runtime: ${err.message}\n`);
            connection.sendNotification('quark/printConsole', `[Quark JIT] Ensure 'quark' (Quark Runtime) is installed and on PATH.\n`);
        });
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
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
<<<<<<< HEAD
        backend.stdin.write("COMPILE\n");
        backend.stdin.write(llvmIR + "\n");
        backend.stdin.write("END_COMPILE\n");
        backend.stdin.write("EXECUTE int32 quark_main\n");
        backend.stdin.write("EXIT\n");
        backend.stdin.end();
=======
        if (backend.stdin) {
            backend.stdin.write("COMPILE\n");
            backend.stdin.write(llvmIR + "\n");
            backend.stdin.write("END_COMPILE\n");
            backend.stdin.write("EXECUTE int32 quark_main\n");
            backend.stdin.write("EXIT\n");
            backend.stdin.end();
        }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    }
    catch (error) {
        connection.sendNotification('quark/showConsole');
        connection.sendNotification('quark/printConsole', `\n[Quark System Error] ${error.message}\n`);
    }
}
//# sourceMappingURL=server.js.map