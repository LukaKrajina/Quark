<<<<<<< HEAD
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { SemanticAnalyzer } from './semantic';
import { IRGenerator } from './ir';

const DAEMON_PORT = 50052;

export class QuarkApiRouter {
    private modelPath: string;
    private modelName: string;

    constructor(modelPath: string) {
        this.modelPath = modelPath;
        this.modelName = path.basename(modelPath);
    }

    public handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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

    private handleGetModels(res: http.ServerResponse): void {
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

    private handleCompletions(body: any, res: http.ServerResponse): void {
        let prompt = '';
        if (Array.isArray(body.messages)) {
            const lastMessage = body.messages[body.messages.length - 1];
            prompt = lastMessage ? lastMessage.content : '';
        } else if (typeof body.prompt === 'string') {
            prompt = body.prompt;
        } else {
            prompt = JSON.stringify(body);
        }

        const isStream = body.stream === true;
        const escapedModelPath = this.modelPath.replace(/\\/g, '/');
        const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, ' ');
        const qkScript = `
            let model = qlm_load("${escapedModelPath}");
            let input = qk_encode_string("${escapedPrompt}");
            qlm_forward(model, input);
            let result = qk_decode_string(input);
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
            } else {
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

    private handleEmbeddings(body: any, res: http.ServerResponse): void {
        const input = typeof body.input === 'string' ? body.input : JSON.stringify(body.input || '');
        const escapedInput = input.replace(/"/g, '\\"').replace(/\n/g, ' ');

        const qkScript = `
            let input_tensor = qk_encode_string("${escapedInput}");
            let result = qk_decode_string(input_tensor);
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

    private executeQkScript(sourceCode: string, callback: (err: string | null, output: string) => void): void {
        try {
            const lexer = new Lexer(sourceCode);
            const parser = new Parser(lexer);
            const ast = parser.parse();

            const analyzer = new SemanticAnalyzer();
            analyzer.analyze(ast);

            if (analyzer.errors.length > 0) {
                return callback(analyzer.errors.map(e => e.message).join('; '), '');
            }

            const irGen = new IRGenerator();
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

        } catch (e: any) {
            callback(`Pipeline Compilation Error: ${e.message}`, '');
        }
    }

    private parseJsonBody(req: http.IncomingMessage, res: http.ServerResponse, onParsed: (body: any) => void): void {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const parsed = JSON.parse(body || '{}');
                onParsed(parsed);
            } catch (err: any) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Invalid JSON payload', details: err.message } }));
            }
        });
    }
=======
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { SemanticAnalyzer } from './semantic';
import { IRGenerator } from './ir';
import { withRetry, withTimeout } from './resilience';
import { Cmd, PROTOCOL_VERSION, encodeFrame, decodeFrames } from './protocol';

const DAEMON_PORT = 50052;

export class QuarkApiRouter {
    private modelPath: string;
    private modelName: string;

    constructor(modelPath: string) {
        this.modelPath = modelPath;
        this.modelName = path.basename(modelPath);
    }

    public handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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

    private handleGetModels(res: http.ServerResponse): void {
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

    private handleCompletions(body: any, res: http.ServerResponse): void {
        let prompt = '';
        if (Array.isArray(body.messages)) {
            // 拼接多轮对话上下文，保留历史消息
            prompt = body.messages
                .map((m: any) => `${m.role}: ${m.content}`)
                .join('\n');
        } else if (typeof body.prompt === 'string') {
            prompt = body.prompt;
        } else {
            prompt = JSON.stringify(body);
        }

        const isStream = body.stream === true;
        // 用 JSON.stringify 生成带转义的字符串字面量,避免用户输入注入 .qk 代码。
        // 配合 lexer 的转义序列支持,任意字符(含引号/反斜杠/换行)都能安全编码。
        const qkScript = `
            let model = qlm_load(${JSON.stringify(this.modelPath)});
            let input = qk_encode_string(${JSON.stringify(prompt)});
            qlm_forward(model, input);
            let result = qk_decode_string(input);
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
            } else {
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

    private handleEmbeddings(body: any, res: http.ServerResponse): void {
        const input = typeof body.input === 'string' ? body.input : JSON.stringify(body.input || '');

        const qkScript = `
            let input_tensor = qk_encode_string(${JSON.stringify(input)});
            let result = qk_decode_string(input_tensor);
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

    private executeQkScriptAsync(sourceCode: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            try {
                const lexer = new Lexer(sourceCode);
                const parser = new Parser(lexer);
                const ast = parser.parse();

                const analyzer = new SemanticAnalyzer();
                analyzer.analyze(ast);

                if (analyzer.errors.length > 0) {
                    reject(new Error(analyzer.errors.map(e => e.message).join('; ')));
                    return;
                }

                const irGen = new IRGenerator();
                const llvmIR = irGen.generate(ast);

                const client = net.createConnection({ port: DAEMON_PORT }, () => {
                    client.write(encodeFrame(Cmd.HELLO, PROTOCOL_VERSION));
                    client.write(encodeFrame(Cmd.COMPILE, llvmIR));
                    client.write(encodeFrame(Cmd.EXECUTE, 'int32 quark_main'));
                    client.write(encodeFrame(Cmd.EXIT));
                });

                let responseData = '';
                let recvBuffer: Buffer = Buffer.alloc(0);
                client.on('data', (data: Buffer) => {
                    recvBuffer = Buffer.concat([recvBuffer, data]);
                    const { frames, rest } = decodeFrames(recvBuffer);
                    recvBuffer = rest;
                    for (const f of frames) responseData += f;
                });
                client.on('end', () => {
                    const cleanOutput = responseData.replace(/RESPONSE: SUCCESS[^\n]*\n/g, '');
                    resolve(cleanOutput.trim());
                });
                client.on('error', (err) => reject(new Error(`Daemon Connection Error: ${err.message}`)));

            } catch (e: any) {
                reject(new Error(`Pipeline Compilation Error: ${e.message}`));
            }
        });
    }

    private executeQkScript(sourceCode: string, callback: (err: string | null, output: string) => void): void {
        const robustExecute = withRetry(3, { delayMs: 500, backoff: 'exponential' })(
            withTimeout(10_000)((src: string) => this.executeQkScriptAsync(src))
        );
        robustExecute(sourceCode).then(
            (output) => callback(null, output),
            (err) => callback(err instanceof Error ? err.message : String(err), '')
        );
    }

    private parseJsonBody(req: http.IncomingMessage, res: http.ServerResponse, onParsed: (body: any) => void): void {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const parsed = JSON.parse(body || '{}');
                onParsed(parsed);
            } catch (err: any) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Invalid JSON payload', details: err.message } }));
            }
        });
    }
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}