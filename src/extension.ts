/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import { CorgiCompletionProvider } from './completion';
import { validateYaml } from './validateYml';
import { executeCorgiCommand } from './corgiCommands';
import { CorgiTreeProvider } from './corgiTreeProvider';

const corgiPattern = /^corgi-.*\.(yml|yaml)$/;

export function activate(context: vscode.ExtensionContext) {
    const diagnostics = vscode.languages.createDiagnosticCollection('corgi');

    context.subscriptions.push(diagnostics);
    console.log('Congratulations, your extension "corgi" is now active!');
    const statusBarItem = (() => {
        const statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarButton.text = "$(play) Run Corgi";
        statusBarButton.tooltip = "Run Corgi from Workspace Root";
        statusBarButton.command = 'corgi.runFromRoot';
        statusBarButton.show();
        return statusBarButton; // Return the status bar item for disposal
    })();
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (corgiPattern.test(path.basename(document.fileName))) {
                validateYaml(diagnostics, document);
            }
        }),
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (corgiPattern.test(path.basename(document.fileName))) {
                validateYaml(diagnostics, document);
            }
        }),
        vscode.languages.registerCompletionItemProvider(
            { pattern: '**/corgi-*.yml', language: 'yaml' },
            new CorgiCompletionProvider(),
            '.', ':', ' '
        ),
        vscode.commands.registerCommand('corgi.run', async () => {
            executeCorgiCommand('run');
        }),
        vscode.commands.registerCommand('corgi.init', async () => {
            executeCorgiCommand('init');
        }),
        vscode.commands.registerCommand('corgi.pull', async () => {
            executeCorgiCommand('pull');
        }),
        vscode.commands.registerCommand('corgi.docs', async () => {
            executeCorgiCommand('docs');
        }),
        vscode.commands.registerCommand('corgi.help', async () => {
            executeCorgiCommand('help');
        }),
        vscode.commands.registerCommand('corgi.doctor', async () => {
            executeCorgiCommand('doctor');
        }),
        vscode.commands.registerCommand('corgi.runFromRoot', async () => {
            executeCorgiCommand('run', true);
        }),
        vscode.commands.registerCommand('corgi.pullFromRoot', async () => {
            executeCorgiCommand('pull', true);
        }),
        vscode.commands.registerCommand('corgi.initFromRoot', async () => {
            executeCorgiCommand('init', true);
        }),
        vscode.commands.registerCommand('corgi.doctorFromRoot', async () => {
            executeCorgiCommand('doctor', true);
        }),
        vscode.commands.registerCommand('corgi.runFromStatusBar', async () => {
            executeCorgiCommand('run', true);
        }),
        vscode.commands.registerCommand('corgi.cancel', async () => {
            vscode.commands.executeCommand('workbench.action.terminal.kill');
        }),
        vscode.commands.registerCommand('corgi.stop', async () => {
            const activeTerminal = vscode.window.activeTerminal;
            if (activeTerminal) {
                // Send Ctrl+C key combination
                await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
                    text: '\u0003' // ASCII code for Ctrl+C
                });
            } else {
                vscode.window.showInformationMessage('No active terminal.');
            }
        }),
        statusBarItem
    );
    const corgiTreeProvider = new CorgiTreeProvider();
    vscode.window.registerTreeDataProvider('corgiTreeView', corgiTreeProvider);

}

export function deactivate() { }
