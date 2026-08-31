#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const net = __importStar(require("net"));
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const lexer_1 = require("./lexer");
const parser_1 = require("./parser");
const semantic_1 = require("./semantic");
const ir_1 = require("./ir");
const apiRouter_1 = require("./apiRouter");
<<<<<<< HEAD
const DAEMON_PORT = 50052;
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage:\n  qk run <script.qk>\n  qk compile <arch> <mode> <script.qk>");
        console.error("  qk compile <arch> <mode> <script.qk>   Compile to native binary (arch: x32|x64|arm64, mode: -e|-m)");
        console.error("  qk serve <model.qkm> [--port <port>]   Launch an HTTP/WebSocket server for model inference");
=======
const vcgen_1 = require("./vcgen");
const protocol_1 = require("./protocol");
const DAEMON_PORT = 50052;
const DAEMON_TIMEOUT_MS = 30000; // daemon 响应超时(收到数据即重置)
function expandIncludes(src, baseDir, stack) {
    const out = [];
    for (const line of src.split('\n')) {
        const m = line.match(/^\s*include\s+"([^"]+)"\s*;\s*$/);
        if (!m) {
            out.push(line);
            continue;
        }
        const incPath = path.resolve(baseDir, m[1]);
        if (stack.has(incPath))
            throw new Error(`[Quark CLI] Circular include: ${incPath}`);
        const incSrc = fs.readFileSync(incPath, 'utf-8');
        const next = new Set(stack);
        next.add(incPath);
        out.push(`// ===== include: ${m[1]} =====`);
        out.push(expandIncludes(incSrc, path.dirname(incPath), next));
        out.push(`// ===== end include: ${m[1]} =====`);
    }
    return out.join('\n');
}
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage:\n  qk run <script.qk>\n  qk verify <script.qk>\n  qk compile <arch> <mode> <script.qk>");
        console.error("  qk verify <script.qk>                  Statically verify contracts (requires/ensures/invariant)");
        console.error("  qk verify <script.qk> --smt [out.smt2] Export SMT-LIB for external solvers (Z3/cvc5)");
        console.error("  qk compile <arch> <mode> <script.qk>   Compile to native binary (arch: x32|x64|arm64, mode: -e|-m)");
        console.error("  qk serve <model.qkm> [--port <port>]   Launch an HTTP/WebSocket server for model inference");
        console.error("  qk ir <script.qk>                      Emit LLVM IR to stdout (no daemon connection)");
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
        process.exit(1);
    }
    const command = args[0];
    let filePath = "";
    let arch = "";
    let mode = "";
    let outputName = "";
<<<<<<< HEAD
=======
    let smtMode = false;
    let smtOutput = "";
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    if (command === 'run') {
        if (args.length < 2) {
            console.error("Usage: qk run <script.qk>");
            process.exit(1);
        }
        filePath = path.resolve(args[1]);
    }
<<<<<<< HEAD
=======
    else if (command === 'ir') {
        if (args.length < 2) {
            console.error("Usage: qk ir <script.qk>");
            process.exit(1);
        }
        filePath = path.resolve(args[1]);
    }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    else if (command === 'compile') {
        if (args.length < 4) {
            console.error("Usage: qk compile <x32|x64|arm64> <-e|-m> <script.qk>");
            process.exit(1);
        }
        arch = args[1];
        mode = args[2];
        filePath = path.resolve(args[3]);
        if (!['x32', 'x64', 'arm64'].includes(arch)) {
            console.error(`[Quark CLI] Error: Unsupported architecture '${arch}'. Use x32, x64, or arm64.`);
            process.exit(1);
        }
        if (!['-e', '-m'].includes(mode)) {
            console.error(`[Quark CLI] Error: Unsupported mode '${mode}'. Use -e (executable) or -m (hybrid library).`);
            process.exit(1);
        }
        outputName = path.parse(filePath).name;
    }
<<<<<<< HEAD
=======
    else if (command === 'verify') {
        if (args.length < 2) {
            console.error("Usage: qk verify <script.qk> [--smt [output.smt2]]");
            process.exit(1);
        }
        filePath = path.resolve(args[1]);
        const smtIdx = args.indexOf('--smt');
        if (smtIdx !== -1) {
            smtMode = true;
            const next = args[smtIdx + 1];
            if (next && !next.startsWith('--')) {
                smtOutput = path.resolve(next);
            }
        }
    }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    else if (command === 'serve') {
        if (args.length < 2) {
            console.error("Usage: qk serve <model.qkm> [--port <port>]");
            process.exit(1);
        }
        const modelPath = path.resolve(args[1]);
        if (!fs.existsSync(modelPath)) {
            console.error(`[Quark CLI] Error: Model file not found -> ${modelPath}`);
            process.exit(1);
        }
        let port = 9080;
        const portIdx = args.indexOf('--port');
        if (portIdx !== -1 && args[portIdx + 1]) {
            port = parseInt(args[portIdx + 1], 10);
        }
        console.log(`[Quark Serve] Pre-loading model '${path.basename(modelPath)}'...`);
        const router = new apiRouter_1.QuarkApiRouter(modelPath);
        const server = http.createServer((req, res) => router.handleRequest(req, res)); //
        server.listen(port, () => {
            console.log(`[Quark Serve] Inference server listening at http://localhost:${port}`);
            console.log(`[Quark Serve] API Router Endpoints active:`);
            console.log(`               - GET  http://localhost:${port}/v1/models`);
            console.log(`               - POST http://localhost:${port}/v1/chat/completions`);
            console.log(`               - POST http://localhost:${port}/v1/embeddings`);
        });
        return;
    }
    else {
        console.error(`[Quark CLI] Error: Unknown command '${command}'`);
        console.error("Usage:\n  qk run <script.qk>\n  qk compile <arch> <mode> <script.qk>");
        process.exit(1);
    }
    if (!fs.existsSync(filePath)) {
        console.error(`[Quark CLI] Error: File not found -> ${filePath}`);
        process.exit(1);
    }
<<<<<<< HEAD
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    try {
=======
    let sourceCode = fs.readFileSync(filePath, 'utf-8');
    try {
        sourceCode = expandIncludes(sourceCode, path.dirname(filePath), new Set([filePath]));
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
        const lexer = new lexer_1.Lexer(sourceCode);
        const parser = new parser_1.Parser(lexer);
        const ast = parser.parse();
        const analyzer = new semantic_1.SemanticAnalyzer();
        analyzer.analyze(ast);
        if (analyzer.errors.length > 0) {
            analyzer.errors.forEach(err => console.error(`[Quark Semantic Error] Line ${err.line}: ${err.message}`));
            process.exit(1);
        }
        const irGen = new ir_1.IRGenerator();
        const llvmIR = irGen.generate(ast);
<<<<<<< HEAD
        const client = net.createConnection({ port: DAEMON_PORT }, () => {
            if (command === 'run') {
                client.write("COMPILE\n");
                client.write(llvmIR + "\n");
                client.write("END_COMPILE\n");
                client.write("EXECUTE int32 quark_main\n");
            }
            else if (command === 'compile') {
                client.write(`AOT_COMPILE ${arch} ${mode} ${outputName}\n`);
                client.write(llvmIR + "\n");
                client.write("END_COMPILE\n");
            }
            client.write("EXIT\n");
        });
        client.on('data', (data) => {
            process.stdout.write(data.toString());
        });
        client.on('end', () => {
            process.exit(0);
        });
        client.on('error', (err) => {
=======
        // IR 导出模式：只输出 LLVM IR 到 stdout，不连接 daemon（供 C++ embedded JIT 消费）
        if (command === 'ir') {
            process.stdout.write(llvmIR);
            process.exit(0);
        }
        const vcGen = new vcgen_1.VCGenerator();
        const obligations = vcGen.generate(ast);
        const vcProtocol = obligations.length > 0 ? vcGen.toProtocol(obligations) : null;
        // SMT-LIB 导出模式：不连接 daemon，直接导出验证条件供外部求解器判定
        if (command === 'verify' && smtMode) {
            if (obligations.length === 0) {
                console.log("[Quark Verify] No contracts (requires/ensures/invariant) found. Nothing to export.");
                process.exit(0);
            }
            const smtLib = vcGen.toSmtLib(obligations);
            if (smtOutput) {
                fs.writeFileSync(smtOutput, smtLib);
                console.log(`[Quark Verify] SMT-LIB exported to ${smtOutput}`);
            }
            else {
                process.stdout.write(smtLib + "\n");
            }
            process.exit(0);
        }
        const client = net.createConnection({ port: DAEMON_PORT }, () => {
            client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.HELLO, protocol_1.PROTOCOL_VERSION));
            if (command === 'run') {
                client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.COMPILE, llvmIR));
                if (vcProtocol) {
                    client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.VERIFY, vcProtocol));
                }
                client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.EXECUTE, 'int32 quark_main'));
            }
            else if (command === 'compile') {
                client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.AOT_COMPILE, `${arch} ${mode} ${outputName}\n${llvmIR}`));
            }
            else if (command === 'verify') {
                if (vcProtocol) {
                    client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.VERIFY, vcProtocol));
                }
                else {
                    console.log("[Quark Verify] No contracts (requires/ensures/invariant) found. Nothing to verify.");
                }
            }
            client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.EXIT));
        });
        // daemon 响应超时:收到数据即重置从而避免挂起
        let timeout = null;
        const resetTimeout = () => {
            if (timeout)
                clearTimeout(timeout);
            timeout = setTimeout(() => {
                console.error(`[Quark CLI] Daemon response timeout. Is 'runtime --daemon' responsive?`);
                client.destroy();
                process.exit(1);
            }, DAEMON_TIMEOUT_MS);
        };
        resetTimeout();
        let recvBuffer = Buffer.alloc(0);
        client.on('data', (data) => {
            resetTimeout();
            recvBuffer = Buffer.concat([recvBuffer, data]);
            const { frames, rest } = (0, protocol_1.decodeFrames)(recvBuffer);
            recvBuffer = rest;
            for (const f of frames)
                process.stdout.write(f);
        });
        client.on('end', () => {
            if (timeout)
                clearTimeout(timeout);
            process.exit(0);
        });
        client.on('error', (err) => {
            if (timeout)
                clearTimeout(timeout);
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
            console.error(`[Quark CLI] Failed to connect to Quark Daemon on port ${DAEMON_PORT}. Is 'runtime --daemon' running?`);
            process.exit(1);
        });
    }
    catch (error) {
        console.error(`[Quark System Error] ${error.message}`);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=cli.js.map