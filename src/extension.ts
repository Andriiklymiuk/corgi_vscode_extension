/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CorgiComposeCompletionProvider, CorgiJsonCompletionProvider } from './completion';
import { validateCorgiComposeYaml, validateCorgiExamplesJson } from './validate';
import { executeCorgiCommand, installCorgiWithHomebrew, isCorgiInstalled } from './corgiCommands';
import { CorgiTreeProvider } from './corgiTreeProvider';
import { downloadFile } from './utils/downloadFile';
import { convertToRawUrl } from './utils/convertToRawUrl';
import { CorgiExample } from './examples/exampleProjects';

const corgiPattern = /^(.*\.)?corgi(-compose\d*)?(\.\w+)?\.(yml|yaml)$/;
const corgiExamplesJsonPattern = /^(.*\.)?corgi(-[a-zA-Z0-9]*)?(\.\w+)?\.json$/;

async function checkCorgiInstallation(corgiTreeProvider: CorgiTreeProvider) {
    const isInstalled = await isCorgiInstalled();
    // If Corgi is not installed, set the context key so the welcome view can be shown
    vscode.commands.executeCommand('setContext', 'corgiNotInstalled', !isInstalled);
    corgiTreeProvider.refresh();
}

function registerCorgiCommands(context: vscode.ExtensionContext) {
    const specialCommands = [
        { name: 'corgi.run', cmd: 'run' },
        { name: 'corgi.init', cmd: 'init' },
        { name: 'corgi.pull', cmd: 'pull' },
        { name: 'corgi.db', cmd: 'db' },

        { name: 'corgi.create', cmd: 'create', fromRoot: false, ignoreCorgiCompose: true },
        { name: 'corgi.docs', cmd: 'docs', fromRoot: true, ignoreCorgiCompose: true },
        { name: 'corgi.help', cmd: 'help', fromRoot: true, ignoreCorgiCompose: true },

        { name: 'corgi.dbUp', cmd: 'db -u' },
        { name: 'corgi.dbDown', cmd: 'db -d' },
        { name: 'corgi.dbStop', cmd: 'db -s' },
        { name: 'corgi.dbSeed', cmd: 'db --seedAll' },
        { name: 'corgi.clean', cmd: 'clean -i all' },

        { name: 'corgi.runFromStatusBar', cmd: 'run', fromRoot: true },

        { name: 'corgi.runFromRoot', cmd: 'run', fromRoot: true },
        { name: 'corgi.pullFromRoot', cmd: 'pull', fromRoot: true },
        { name: 'corgi.initFromRoot', cmd: 'init', fromRoot: true },
        { name: 'corgi.doctorFromRoot', cmd: 'doctor', fromRoot: true },
        { name: 'corgi.createFromRoot', cmd: 'create', fromRoot: true, ignoreCorgiCompose: true },
        { name: 'corgi.dbFromRoot', cmd: 'db', fromRoot: true },
        { name: 'corgi.dbUpFromRoot', cmd: 'db -u', fromRoot: true },
        { name: 'corgi.dbDownFromRoot', cmd: 'db -d', fromRoot: true },
        { name: 'corgi.dbStopFromRoot', cmd: 'db -s', fromRoot: true },
        { name: 'corgi.dbSeedFromRoot', cmd: 'db --seedAll', fromRoot: true },
        { name: 'corgi.cleanFromRoot', cmd: 'clean -i all', fromRoot: true },
    ];

    for (const { name, cmd, fromRoot, ignoreCorgiCompose } of specialCommands) {
        const disposable = vscode.commands.registerCommand(name, async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const fileName = document.fileName;
                if (corgiPattern.test(path.basename(document.fileName))) {
                    executeCorgiCommand(cmd, false, false, fileName);
                    return;
                }
            }
            executeCorgiCommand(cmd, fromRoot, ignoreCorgiCompose);
        });
        context.subscriptions.push(disposable);
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const diagnostics = vscode.languages.createDiagnosticCollection('corgi');
    const corgiTreeProvider = new CorgiTreeProvider();
    vscode.window.registerTreeDataProvider('corgiTreeView', corgiTreeProvider);

    checkCorgiInstallation(corgiTreeProvider);

    context.subscriptions.push(diagnostics);
    console.log('Congratulations, your extension "corgi" is now active!');
    const runStatusBarItem = (() => {
        const statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarButton.text = "$(play) Run Corgi";
        statusBarButton.tooltip = "Run Corgi from Workspace Root";
        statusBarButton.command = 'corgi.runFromRoot';
        statusBarButton.show();
        return statusBarButton;
    })();

    const stopStatusBarItem = (() => {
        const stopButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        stopButton.text = "$(debug-stop) Corgi";
        stopButton.tooltip = "Stop Corgi in Active Terminal";
        stopButton.command = 'corgi.stop';
        stopButton.show();
        return stopButton;
    })();

    registerCorgiCommands(context);

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (corgiPattern.test(path.basename(document.fileName))) {
                validateCorgiComposeYaml(diagnostics, document);
            }
            if (corgiExamplesJsonPattern.test(path.basename(document.fileName))) {
                validateCorgiExamplesJson(diagnostics, document);
            }
        }),
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (corgiPattern.test(path.basename(document.fileName))) {
                validateCorgiComposeYaml(diagnostics, document);
            }
            if (corgiExamplesJsonPattern.test(path.basename(document.fileName))) {
                validateCorgiExamplesJson(diagnostics, document);
            }
        }),
        vscode.languages.registerCompletionItemProvider(
            { pattern: '**/*corgi-*.yml', language: 'yaml' },
            new CorgiComposeCompletionProvider(),
            '.', ':', ' '
        ),
        vscode.languages.registerCompletionItemProvider(
            { pattern: '**/*corgi*.json', language: 'json' },
            new CorgiJsonCompletionProvider(),
            '.', ':', ' '
        ),
        vscode.commands.registerCommand('corgi.reload', async () => {
            corgiTreeProvider.refresh();
            vscode.window.showInformationMessage('Corgi extension refreshed');
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
        vscode.commands.registerCommand('corgi.downloadExample', async (example: CorgiExample | any) => {
            if (example && example.args && example.args[0]) {
                example = example.args[0];
            }
            await downloadCorgiExample(example);
        }),
        vscode.commands.registerCommand('corgi.runExample', async (example: CorgiExample | any) => {
            if (example && example.args && example.args[0]) {
                example = example.args[0];
            }
            if (!example.link) {
                if (example.publicLink) {
                    vscode.env.openExternal(vscode.Uri.parse(example.publicLink));
                    return;
                }
                vscode.window.showErrorMessage('No links provided to run corgi or to show example in the web');
                return;
            }
            const downloadPath = await downloadCorgiExample(example);
            if (!downloadPath) {
                vscode.window.showErrorMessage('Example could not be downloaded. Aborting.');
                return;
            }
            await executeCorgiCommand('init', false, false, downloadPath);
            await executeCorgiCommand(`run${example.shouldSeed ? " --seed" : ""}`, false, false, downloadPath);
        }),
        vscode.commands.registerCommand('corgi.forkExample', async (example: CorgiExample | any) => {
            if (example && example.args && example.args[0]) {
                example = example.args[0];
            }
            const downloadPath = await downloadCorgiExample(example);
            if (!downloadPath) {
                vscode.window.showErrorMessage('Example could not be downloaded. Aborting.');
                return;
            }
            await executeCorgiCommand('fork --all', false, false, downloadPath);
        }),
        vscode.commands.registerCommand('corgi.openLink', async (example: CorgiExample | any) => {
            let url: string;
            if (example && example.args && example.args[0]) {
                url = example.args[0].publicLink;
            } else {
                url = example.publicLink;
            }
            vscode.env.openExternal(vscode.Uri.parse(url));
        }),
        runStatusBarItem,
        stopStatusBarItem
    );
}

const downloadCorgiExample = async (example: CorgiExample | any): Promise<string | null> => {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Please open a workspace before downloading.');
        return null;
    }

    const basePath = vscode.workspace.workspaceFolders[0].uri.fsPath;

    let link = example.link;

    const rawUrl = convertToRawUrl(link);
    let fileName = rawUrl.split('/').pop() || 'corgi-compose.yml';

    let folderPath = '';

    // Add path to the fileName if path property is present in example object
    if (example.path) {
        folderPath = example.path;

        // Remove ./ from the path if it exists
        if (folderPath.startsWith('./')) {
            folderPath = folderPath.slice(2);
        }

        // If the path is not just '.', prepend it to the fileName
        if (folderPath !== '.') {
            fileName = path.join(folderPath, fileName);
        }
    }

    const downloadPath = path.join(basePath, fileName);

    // Check if the folder exists, if not, create it
    if (folderPath) {
        const folderFullPath = path.join(basePath, folderPath);
        if (!fs.existsSync(folderFullPath)) {
            fs.mkdirSync(folderFullPath, { recursive: true });
        }
    }

    if (fs.existsSync(downloadPath)) {
        const overwrite = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: `${fileName} already exists. Do you want to overwrite it?`,
        });

        if (overwrite !== 'Yes') {
            return null;
        }
    }

    try {
        await downloadFile(rawUrl, downloadPath);
        vscode.window.showInformationMessage('File downloaded successfully to ' + downloadPath);

        const mainFileDir = path.dirname(downloadPath);

        if (example.files && Array.isArray(example.files)) {
            for (const fileLink of example.files) {
                const fileRawUrl = convertToRawUrl(fileLink);
                const fileName = fileRawUrl.split('/').pop() || 'unknown_file';
                const fileDownloadPath = path.join(mainFileDir, fileName);
                try {
                    await downloadFile(fileRawUrl, fileDownloadPath);
                    vscode.window.showInformationMessage('Additional file downloaded successfully to ' + fileDownloadPath);
                } catch (fileError) {
                    console.log('File download error:', fileError);
                    vscode.window.showErrorMessage(`Failed to download additional file: ${fileLink}`);
                }
            }
        }

        return downloadPath;
    } catch (error) {
        console.log('error', error);
        vscode.window.showErrorMessage('Failed to download file.');
        return null;
    }
};
