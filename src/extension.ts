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
    );
    const corgiTreeProvider = new CorgiTreeProvider();
    vscode.window.registerTreeDataProvider('corgiTreeView', corgiTreeProvider);

}

export function deactivate() { }
