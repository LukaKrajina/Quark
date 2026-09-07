import * as assert from 'assert';
import * as vscode from 'vscode';

// Quark 扩展 smoke test:验证扩展能成功激活并注册命令。
// 运行于真实 VSCode 实例(通过 @vscode/test-electron 启动)。
suite('Quark Extension Smoke Test', () => {
    test('extension activates and registers runScript command', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('quark.runScript'),
            'quark.runScript command should be registered after activation'
        );
    });
});
