/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import { CorgiCompletionProvider } from './completion';
import { validateYaml } from './validateYml';
import { executeCorgiCommand, installCorgiWithHomebrew, isCorgiInstalled } from './corgiCommands';
import { CorgiTreeProvider } from './corgiTreeProvider';
import { downloadFile } from './utils/downloadFile';

const corgiPattern = /^corgi-.*\.(yml|yaml)$/;

async function checkCorgiInstallation(corgiTreeProvider: CorgiTreeProvider) {
    const isInstalled = await isCorgiInstalled();
    // If Corgi is not installed, set the context key so the welcome view can be shown
    vscode.commands.executeCommand('setContext', 'corgiNotInstalled', !isInstalled);
    corgiTreeProvider.refresh();
}

export async function activate(context: vscode.ExtensionContext) {
    const diagnostics = vscode.languages.createDiagnosticCollection('corgi');
    const corgiTreeProvider = new CorgiTreeProvider();
    vscode.window.registerTreeDataProvider('corgiTreeView', corgiTreeProvider);

    checkCorgiInstallation(corgiTreeProvider);

    context.subscriptions.push(diagnostics);
    console.log('Congratulations, your extension "corgi" is now active!');
    const statusBarItem = (() => {
        const statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarButton.text = "$(play) Run Corgi";
        statusBarButton.tooltip = "Run Corgi from Workspace Root";
        statusBarButton.command = 'corgi.runFromRoot';
        statusBarButton.show();
        return statusBarButton;
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
        vscode.commands.registerCommand('corgi.create', async () => {
            executeCorgiCommand('create', false, true);
        }),
        vscode.commands.registerCommand('corgi.init', async () => {
            executeCorgiCommand('init');
        }),
        vscode.commands.registerCommand('corgi.pull', async () => {
            executeCorgiCommand('pull');
        }),
        vscode.commands.registerCommand('corgi.docs', async () => {
            executeCorgiCommand('docs', true, true);
        }),
        vscode.commands.registerCommand('corgi.help', async () => {
            executeCorgiCommand('help', true, true);
        }),
        vscode.commands.registerCommand('corgi.doctor', async () => {
            executeCorgiCommand('doctor');
        }),
        vscode.commands.registerCommand('corgi.db', async () => {
            executeCorgiCommand('db');
        }),
        vscode.commands.registerCommand('corgi.dbUp', async () => {
            executeCorgiCommand('db -u');
        }),
        vscode.commands.registerCommand('corgi.dbDown', async () => {
            executeCorgiCommand('db -d');
        }),
        vscode.commands.registerCommand('corgi.dbStop', async () => {
            executeCorgiCommand('db -s');
        }),
        vscode.commands.registerCommand('corgi.dbSeed', async () => {
            executeCorgiCommand('db --seedAll');
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
        vscode.commands.registerCommand('corgi.createFromRoot', async () => {
            executeCorgiCommand('create', true, true);
        }),
        vscode.commands.registerCommand('corgi.runFromStatusBar', async () => {
            executeCorgiCommand('run', true);
        }),
        vscode.commands.registerCommand('corgi.dbFromRoot', async () => {
            executeCorgiCommand('db', true);
        }),
        vscode.commands.registerCommand('corgi.dbUpFromRoot', async () => {
            executeCorgiCommand('db -u', true);
        }),
        vscode.commands.registerCommand('corgi.dbDownFromRoot', async () => {
            executeCorgiCommand('db -d', true);
        }),
        vscode.commands.registerCommand('corgi.dbStopFromRoot', async () => {
            executeCorgiCommand('db -s', true);
        }),
        vscode.commands.registerCommand('corgi.dbSeedFromRoot', async () => {
            executeCorgiCommand('db --seedAll', true);
        }),
        vscode.commands.registerCommand('corgi.cancel', async () => {
            vscode.commands.executeCommand('workbench.action.terminal.kill');
        }),
        vscode.commands.registerCommand('corgi.installWithHomebrew', async () => {
            const installed = await installCorgiWithHomebrew();
            if (installed) {
                vscode.commands.executeCommand('setContext', 'corgiNotInstalled', false);
                corgiTreeProvider.refresh();
            } else {
                vscode.window.showErrorMessage('Failed to install Corgi. Please try again or install manually with brew install andriiklymiuk/homebrew-tools/corgi');
            }
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
        vscode.commands.registerCommand('corgi.downloadExample', async (url: string) => {
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('Please open a workspace before downloading.');
                return;
            }

            const basePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const fileName = url.split('/').pop() || 'corgi-compose.yml';
            const downloadPath = path.join(basePath, fileName);

            downloadFile(url, downloadPath, (error) => {
                if (error) {
                    console.log('error', error);
                    vscode.window.showErrorMessage('Failed to download file.');
                } else {
                    vscode.window.showInformationMessage('File downloaded successfully to ' + downloadPath);
                }
            });
        }),

        statusBarItem
    );
}

export function deactivate() { }
