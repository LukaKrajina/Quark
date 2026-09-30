import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionContext, window, OutputChannel} from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import {
    TargetProvider,
    ActionsProvider,
    PerformanceProvider,
    QuantumStateWebviewProvider,
    PerfSnapshot,
    CompileTarget
} from './quarkSidebar';

let client: LanguageClient;
let quarkConsole: OutputChannel;

export function activate(context: ExtensionContext) {
    quarkConsole = window.createOutputChannel('Quark Console');
    context.subscriptions.push(quarkConsole);

    const serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] }
        }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'quark' }],
    };

    client = new LanguageClient(
        'quarkLanguageServer',
        'Quark Language Server',
        serverOptions,
        clientOptions
    );

    client.start();

    client.onNotification('quark/printConsole', (message: string) => {
        quarkConsole.append(message);
    });

    client.onNotification('quark/showConsole', () => {
        quarkConsole.show(true); 
    });

    client.onNotification('quark/clearConsole', () => {
        quarkConsole.clear();
    });

    const runCommand = vscode.commands.registerCommand('quark.runScript', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const uri = editor.document.uri.toString();
            // Send the custom execution trigger to server.ts
            client.sendNotification('quark/runCode', { uri });
        }
    });

    const compileCommand = vscode.commands.registerCommand('quark.compileScript', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const uri = editor.document.uri.toString();
            // 编译目标（x32/x64/arm64）从侧边栏读取，透传给 server
            client.sendNotification('quark/compileCode', { uri, arch: targetProvider.getTarget() });
        }
    });

    const buildCommand = vscode.commands.registerCommand('quark.buildScript', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const uri = editor.document.uri.toString();
            client.sendNotification('quark/buildCode', { uri });
        }
    });

    // 迁移现有量子语言源码（OpenQASM/Q#/Quil/Silq）为 .qk：右键菜单触发。
    // 参数 uri 由 explorer/context 提供；编辑器右键时无参，回退到活动编辑器。
    const migrateCommand = vscode.commands.registerCommand('quark.migrateScript', (uri?: vscode.Uri) => {
        let target = uri;
        if (!target) {
            const editor = vscode.window.activeTextEditor;
            target = editor?.document.uri;
        }
        if (!target) {
            vscode.window.showWarningMessage('Quark: no file selected to migrate.');
            return;
        }
        client.sendNotification('quark/migrateCode', { fsPath: target.fsPath });
    });

    // ─── 侧边栏视图 ──────────
    const targetProvider = new TargetProvider(context);
    const actionsProvider = new ActionsProvider();
    const performanceProvider = new PerformanceProvider(context);
    const quantumProvider = new QuantumStateWebviewProvider();

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('quark.targetPlatform', targetProvider),
        vscode.window.registerTreeDataProvider('quark.actions', actionsProvider),
        vscode.window.registerWebviewViewProvider('quark.performance', performanceProvider, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
        vscode.window.registerWebviewViewProvider('quark.quantumState', quantumProvider, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
        quantumProvider,
    );

    // 编译目标切换命令（侧边栏 TargetItem 触发）
    const setTargetCmd = vscode.commands.registerCommand('quark.setCompileTarget', (t: CompileTarget) => {
        targetProvider.setTarget(t);
        vscode.window.showInformationMessage(`Quark 编译目标已切换为 ${t}`);
    });
    // 量子状态刷新命令（view/title 刷新按钮）
    const refreshQuantumCmd = vscode.commands.registerCommand('quark.refreshQuantumState', () => {
        quantumProvider.refresh();
    });
    // 清空性能历史命令（view/title 清空按钮）
    const clearPerfCmd = vscode.commands.registerCommand('quark.clearPerformance', () => {
        performanceProvider.clear();
        vscode.window.showInformationMessage('Quark 性能历史已清空');
    });
    context.subscriptions.push(setTargetCmd, refreshQuantumCmd, clearPerfCmd);

    // 性能回传：server → client，更新性能监测面板
    client.onNotification('quark/performance', (p: PerfSnapshot) => {
        performanceProvider.update(p);
    });

    context.subscriptions.push(runCommand);
    context.subscriptions.push(compileCommand);
    context.subscriptions.push(buildCommand);
    context.subscriptions.push(migrateCommand);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}