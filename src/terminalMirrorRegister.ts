import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TerminalMirror } from './terminalMirror';

export function registerTerminalMirror(context: vscode.ExtensionContext, agentDir: string): void {
    const dir = path.join(agentDir, 'mirror');
    try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
        return;
    }
    const mirror = new TerminalMirror(dir);
    context.subscriptions.push({ dispose: () => mirror.dispose() }, vscode.window.onDidStartTerminalShellExecution((e) => void mirror.follow(e)));
}
