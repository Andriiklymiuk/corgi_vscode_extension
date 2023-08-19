/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import { CorgiCompletionProvider } from './completion';
import { validateYaml } from './validateYml';


const corgiPattern = /^corgi-.*\.(yml|yaml)$/;

export function activate(context: vscode.ExtensionContext) {
    const diagnostics = vscode.languages.createDiagnosticCollection('corgi');

    context.subscriptions.push(diagnostics);

    // vscode.window.showInformationMessage('Corgi extension activated!');
    console.log('Congratulations, your extension "corgi" is now active!');

    let disposable = vscode.commands.registerCommand('corgi.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from corgi!');
    });
    context.subscriptions.push(disposable);
    // Add event listener for document opening
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        const baseFileName = path.basename(document.fileName);
        if (corgiPattern.test(baseFileName)) {
            validateYaml(diagnostics, document);
        } else {
            console.log('baseFileName', baseFileName);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        const baseFileName = path.basename(document.fileName);
        if (corgiPattern.test(baseFileName)) {
            validateYaml(diagnostics, document);
        } else {
            console.log('baseFileName', baseFileName);
        }
    }));

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { pattern: '**/corgi-*.yml', language: 'yaml' },
            new CorgiCompletionProvider(),
            '.', ':', ' '  // Trigger character, you can adjust as needed
        )
    );
}
export function deactivate() { }

