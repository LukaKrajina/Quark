#!/usr/bin/env node
import * as fs from 'fs';
import * as net from 'net';
import * as http from 'http';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { SemanticAnalyzer } from './semantic';
import { IRGenerator } from './ir';
import { QuarkApiRouter } from './apiRouter';
import { VCGenerator } from './vcgen';
import { Cmd, PROTOCOL_VERSION, encodeFrame, decodeFrames } from './protocol';
import { packMMI, collectModuleInfo, readMMIExports } from './mmi';

const DAEMON_PORT = 50052;
const DAEMON_TIMEOUT_MS = 30000; // daemon 响应超时(收到数据即重置)

function expandIncludes(src: string, baseDir: string, stack: Set<string>): string {
    const out: string[] = [];
    for (const line of src.split('\n')) {
        const m = line.match(/^\s*include\s+"([^"]+)"\s*;\s*$/);
        if (!m) { out.push(line); continue; }
        const incPath = path.resolve(baseDir, m[1]);
        if (stack.has(incPath)) throw new Error(`[Quark CLI] Circular include: ${incPath}`);
        const incSrc = fs.readFileSync(incPath, 'utf-8');
        const next = new Set(stack); next.add(incPath);
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
        process.exit(1);
    }

    const command = args[0];
    let filePath = "";
    let arch = "";
    let mode = "";
    let outputName = "";
    let smtMode = false;
    let smtOutput = "";
    let mmiOutput = "";
    let nativeLibs: string[] = [];
    
    if (command === 'run') {
        if (args.length < 2) {
            console.error("Usage: qk run <script.qk> [--native <lib> ...]");
            process.exit(1);
        }
        filePath = path.resolve(args[1]);
        // 解析 --native <path>：加载原生动态库
        const nIdx = args.indexOf('--native');
        if (nIdx !== -1) {
            for (let i = nIdx + 1; i < args.length; i++) {
                if (args[i].startsWith('-')) break;
                nativeLibs.push(path.resolve(args[i]));
            }
        }
    } else if (command === 'ir') {
        if (args.length < 2) {
            console.error("Usage: qk ir <script.qk>");
            process.exit(1);
        }
        filePath = path.resolve(args[1]);
    } else if (command === 'mmi') {
        if (args.length < 2) {
            console.error("Usage: qk mmi <script.qk> [-o <out.mmi>]");
            process.exit(1);
        }
        filePath = path.resolve(args[1]);
        const oIdx = args.indexOf('-o');
        if (oIdx !== -1 && args[oIdx + 1]) {
            mmiOutput = path.resolve(args[oIdx + 1]);
        } else {
            mmiOutput = path.join(path.dirname(filePath), path.parse(filePath).name + '.mmi');
        }
    } else if (command === 'compile') {
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
    } else if (command === 'verify') {
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
    } else if(command === 'serve'){
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

        const router = new QuarkApiRouter(modelPath);
        const server = http.createServer((req, res) => router.handleRequest(req, res)); //

        server.listen(port, () => {
            console.log(`[Quark Serve] Inference server listening at http://localhost:${port}`);
            console.log(`[Quark Serve] API Router Endpoints active:`);
            console.log(`               - GET  http://localhost:${port}/v1/models`);
            console.log(`               - POST http://localhost:${port}/v1/chat/completions`);
            console.log(`               - POST http://localhost:${port}/v1/embeddings`);
        });
        
        return;
    } else {
        console.error(`[Quark CLI] Error: Unknown command '${command}'`);
        console.error("Usage:\n  qk run <script.qk>\n  qk compile <arch> <mode> <script.qk>");
        process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
        console.error(`[Quark CLI] Error: File not found -> ${filePath}`);
        process.exit(1);
    }

    let sourceCode = fs.readFileSync(filePath, 'utf-8');

    try {
        sourceCode = expandIncludes(sourceCode, path.dirname(filePath), new Set([filePath]));
        const lexer = new Lexer(sourceCode);
        const parser = new Parser(lexer);
        const ast = parser.parse();

        const analyzer = new SemanticAnalyzer();
        analyzer.analyze(ast);

        if (analyzer.errors.length > 0) {
            analyzer.errors.forEach(err => console.error(`[Quark Semantic Error] Line ${err.line}: ${err.message}`));
            process.exit(1);
        }

        // 解析 import：读取 .mmi 导出签名，生成 importSignatures + importList
        const importSignatures = new Map<string, Map<string, { params: string[]; ret: string }>>();
        const importList: { alias: string; path: string }[] = [];
        for (const node of ast.body) {
            if ((node as any).type === 'ImportDecl') {
                const imp = node as any;
                const sigs = readMMIExports(imp.path, path.dirname(filePath));
                const funcs = new Map<string, { params: string[]; ret: string }>();
                for (const e of sigs) funcs.set(e.name, { params: e.params, ret: e.ret });
                importSignatures.set(imp.alias, funcs);
                importList.push({ alias: imp.alias, path: path.resolve(path.dirname(filePath), imp.path) });
            }
        }

        const irGen = new IRGenerator();
        const llvmIR = irGen.generate(ast, importSignatures.size > 0 ? importSignatures : undefined);

        // IR 导出模式：只输出 LLVM IR 到 stdout，不连接 daemon（供 C++ embedded JIT 消费）
        if (command === 'ir') {
            process.stdout.write(llvmIR);
            process.exit(0);
        }

        // MMI 打包模式：qk mmi <script.qk> [-o <out.mmi>]
        if (command === 'mmi') {
            const { exports, permissions, imports } = collectModuleInfo(ast);
            const header = { name: path.parse(filePath).name, version: '1.0.0', exports, permissions, imports };
            const buffer = packMMI(header, llvmIR);
            fs.writeFileSync(mmiOutput, buffer);
            console.log(`[Quark MMI] Packed ${exports.length} export(s) -> ${mmiOutput}`);
            process.exit(0);
        }

        const vcGen = new VCGenerator();
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
            } else {
                process.stdout.write(smtLib + "\n");
            }
            process.exit(0);
        }

        const client = net.createConnection({ port: DAEMON_PORT }, () => {
            client.write(encodeFrame(Cmd.HELLO, PROTOCOL_VERSION));
            if (command === 'run') {
                for (const lib of nativeLibs) {
                    client.write(encodeFrame(Cmd.LOAD_NATIVE, lib));
                }
                for (const imp of importList) {
                    client.write(encodeFrame(Cmd.BIND_MMI, `${imp.alias} ${imp.path}`));
                }
                client.write(encodeFrame(Cmd.COMPILE, llvmIR));
                if (vcProtocol) {
                    client.write(encodeFrame(Cmd.VERIFY, vcProtocol));
                }
                client.write(encodeFrame(Cmd.EXECUTE, 'int32 quark_main'));
            } else if (command === 'compile') {
                client.write(encodeFrame(Cmd.AOT_COMPILE, `${arch} ${mode} ${outputName}\n${llvmIR}`));
            } else if (command === 'verify') {
                if (vcProtocol) {
                    client.write(encodeFrame(Cmd.VERIFY, vcProtocol));
                } else {
                    console.log("[Quark Verify] No contracts (requires/ensures/invariant) found. Nothing to verify.");
                }
            }
            client.write(encodeFrame(Cmd.EXIT));
        });

        // daemon 响应超时:收到数据即重置从而避免挂起
        let timeout: NodeJS.Timeout | null = null;
        const resetTimeout = () => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                console.error(`[Quark CLI] Daemon response timeout. Is 'runtime --daemon' responsive?`);
                client.destroy();
                process.exit(1);
            }, DAEMON_TIMEOUT_MS);
        };
        resetTimeout();

        let recvBuffer: Buffer = Buffer.alloc(0);
        client.on('data', (data: Buffer) => {
            resetTimeout();
            recvBuffer = Buffer.concat([recvBuffer, data]);
            const { frames, rest } = decodeFrames(recvBuffer);
            recvBuffer = rest;
            for (const f of frames) process.stdout.write(f);
        });

        client.on('end', () => {
            if (timeout) clearTimeout(timeout);
            process.exit(0);
        });

        client.on('error', (err) => {
            if (timeout) clearTimeout(timeout);
            console.error(`[Quark CLI] Failed to connect to Quark Daemon on port ${DAEMON_PORT}. Is 'runtime --daemon' running?`);
            process.exit(1);
        });

    } catch (error: any) {
        console.error(`[Quark System Error] ${error.message}`);
        process.exit(1);
    }
}

main();