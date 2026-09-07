import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionContext, window, OutputChannel} from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

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

    context.subscriptions.push(runCommand);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}