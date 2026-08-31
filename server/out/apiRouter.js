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
exports.QuarkApiRouter = void 0;
const net = __importStar(require("net"));
const path = __importStar(require("path"));
const lexer_1 = require("./lexer");
const parser_1 = require("./parser");
const semantic_1 = require("./semantic");
const ir_1 = require("./ir");
<<<<<<< HEAD
=======
const resilience_1 = require("./resilience");
const protocol_1 = require("./protocol");
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
const DAEMON_PORT = 50052;
class QuarkApiRouter {
    constructor(modelPath) {
        this.modelPath = modelPath;
        this.modelName = path.basename(modelPath);
    }
    handleRequest(req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        const url = req.url || '';
        if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
            this.handleGetModels(res);
            return;
        }
        if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/completions' || url === '/v1/predict')) {
            this.parseJsonBody(req, res, (body) => this.handleCompletions(body, res));
            return;
        }
        if (req.method === 'POST' && url === '/v1/embeddings') {
            this.parseJsonBody(req, res, (body) => this.handleEmbeddings(body, res));
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Route ${req.method} ${url} not found.`, type: 'invalid_request_error' } }));
    }
    handleGetModels(res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            object: 'list',
            data: [{
                    id: this.modelName,
                    object: 'model',
                    created: Math.floor(Date.now() / 1000),
                    owned_by: 'quark-qml'
                }]
        }));
    }
    handleCompletions(body, res) {
        let prompt = '';
        if (Array.isArray(body.messages)) {
<<<<<<< HEAD
            const lastMessage = body.messages[body.messages.length - 1];
            prompt = lastMessage ? lastMessage.content : '';
=======
            // 拼接多轮对话上下文，保留历史消息
            prompt = body.messages
                .map((m) => `${m.role}: ${m.content}`)
                .join('\n');
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
        }
        else if (typeof body.prompt === 'string') {
            prompt = body.prompt;
        }
        else {
            prompt = JSON.stringify(body);
        }
        const isStream = body.stream === true;
<<<<<<< HEAD
        const escapedModelPath = this.modelPath.replace(/\\/g, '/');
        const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, ' ');
        const qkScript = `
            let model = qlm_load("${escapedModelPath}");
            let input = qk_encode_string("${escapedPrompt}");
            qlm_forward(model, input);
            let result = qk_decode_string(input);
=======
        // 用 JSON.stringify 生成带转义的字符串字面量,避免用户输入注入 .qk 代码。
        // 配合 lexer 的转义序列支持,任意字符(含引号/反斜杠/换行)都能安全编码。
        const qkScript = `
            let model = qlm_load(${JSON.stringify(this.modelPath)});
            let input = qk_encode_string(${JSON.stringify(prompt)});
            qlm_forward(model, input);
            let result = qk_decode_string(input);
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
        `;
        this.executeQkScript(qkScript, (err, daemonOutput) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: err, type: 'hardware_execution_error' } }));
                return;
            }
            if (isStream) {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });
                const chunk = {
                    id: 'chatcmpl-' + Date.now(),
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: this.modelName,
                    choices: [{ delta: { content: daemonOutput }, index: 0, finish_reason: null }]
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
            }
            else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    id: 'chatcmpl-' + Date.now(),
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: this.modelName,
                    choices: [{
                            message: { role: 'assistant', content: daemonOutput },
                            finish_reason: 'stop',
                            index: 0
                        }]
                }));
            }
        });
    }
    handleEmbeddings(body, res) {
        const input = typeof body.input === 'string' ? body.input : JSON.stringify(body.input || '');
<<<<<<< HEAD
        const escapedInput = input.replace(/"/g, '\\"').replace(/\n/g, ' ');
        const qkScript = `
            let input_tensor = qk_encode_string("${escapedInput}");
            let result = qk_decode_string(input_tensor);
=======
        const qkScript = `
            let input_tensor = qk_encode_string(${JSON.stringify(input)});
            let result = qk_decode_string(input_tensor);
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
        `;
        this.executeQkScript(qkScript, (err, daemonOutput) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: err } }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                object: 'list',
                data: [{ object: 'embedding', embedding: daemonOutput, index: 0 }],
                model: this.modelName
            }));
        });
    }
<<<<<<< HEAD
    executeQkScript(sourceCode, callback) {
        try {
            const lexer = new lexer_1.Lexer(sourceCode);
            const parser = new parser_1.Parser(lexer);
            const ast = parser.parse();
            const analyzer = new semantic_1.SemanticAnalyzer();
            analyzer.analyze(ast);
            if (analyzer.errors.length > 0) {
                return callback(analyzer.errors.map(e => e.message).join('; '), '');
            }
            const irGen = new ir_1.IRGenerator();
            const llvmIR = irGen.generate(ast);
            const client = net.createConnection({ port: DAEMON_PORT }, () => {
                client.write("COMPILE\n");
                client.write(llvmIR + "\n");
                client.write("END_COMPILE\n");
                client.write("EXECUTE int32 quark_main\n");
                client.write("EXIT\n");
            });
            let responseData = '';
            client.on('data', (data) => { responseData += data.toString(); });
            client.on('end', () => {
                let cleanOutput = responseData.replace(/RESPONSE: SUCCESS[^\n]*\n/g, '');
                callback(null, cleanOutput.trim());
            });
            client.on('error', (err) => callback(`Daemon Connection Error: ${err.message}`, ''));
        }
        catch (e) {
            callback(`Pipeline Compilation Error: ${e.message}`, '');
        }
=======
    executeQkScriptAsync(sourceCode) {
        return new Promise((resolve, reject) => {
            try {
                const lexer = new lexer_1.Lexer(sourceCode);
                const parser = new parser_1.Parser(lexer);
                const ast = parser.parse();
                const analyzer = new semantic_1.SemanticAnalyzer();
                analyzer.analyze(ast);
                if (analyzer.errors.length > 0) {
                    reject(new Error(analyzer.errors.map(e => e.message).join('; ')));
                    return;
                }
                const irGen = new ir_1.IRGenerator();
                const llvmIR = irGen.generate(ast);
                const client = net.createConnection({ port: DAEMON_PORT }, () => {
                    client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.HELLO, protocol_1.PROTOCOL_VERSION));
                    client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.COMPILE, llvmIR));
                    client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.EXECUTE, 'int32 quark_main'));
                    client.write((0, protocol_1.encodeFrame)(protocol_1.Cmd.EXIT));
                });
                let responseData = '';
                let recvBuffer = Buffer.alloc(0);
                client.on('data', (data) => {
                    recvBuffer = Buffer.concat([recvBuffer, data]);
                    const { frames, rest } = (0, protocol_1.decodeFrames)(recvBuffer);
                    recvBuffer = rest;
                    for (const f of frames)
                        responseData += f;
                });
                client.on('end', () => {
                    const cleanOutput = responseData.replace(/RESPONSE: SUCCESS[^\n]*\n/g, '');
                    resolve(cleanOutput.trim());
                });
                client.on('error', (err) => reject(new Error(`Daemon Connection Error: ${err.message}`)));
            }
            catch (e) {
                reject(new Error(`Pipeline Compilation Error: ${e.message}`));
            }
        });
    }
    executeQkScript(sourceCode, callback) {
        const robustExecute = (0, resilience_1.withRetry)(3, { delayMs: 500, backoff: 'exponential' })((0, resilience_1.withTimeout)(10000)((src) => this.executeQkScriptAsync(src)));
        robustExecute(sourceCode).then((output) => callback(null, output), (err) => callback(err instanceof Error ? err.message : String(err), ''));
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    }
    parseJsonBody(req, res, onParsed) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const parsed = JSON.parse(body || '{}');
                onParsed(parsed);
            }
            catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Invalid JSON payload', details: err.message } }));
            }
        });
    }
}
exports.QuarkApiRouter = QuarkApiRouter;
//# sourceMappingURL=apiRouter.js.map