/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';

export async function isCorgiInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('corgi -v', (error) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export async function executeCorgiCommand(
  command: string,
  fromRoot: boolean = false,
  ignoreCorgiCompose = false,
  filePath?: string
) {
  if (filePath) {
    await runInTerminal(command, path.dirname(filePath), filePath);
    return;
  }

  let files = await vscode.workspace.findFiles('**/corgi-*.yml');

  if (!files.length && !ignoreCorgiCompose) {
    vscode.window.showErrorMessage('No corgi-compose.yml file found.');
    return;
  }

  let rootDirectory = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';

  if (fromRoot) {
    // If running from root, check if there's a corgi file in the root
    const rootCorgiFile = files.find(file => path.dirname(file.fsPath) === rootDirectory);
    if (rootCorgiFile || ignoreCorgiCompose) {
      await runInTerminal(command, rootDirectory, ignoreCorgiCompose ? undefined : rootCorgiFile?.fsPath);
      return;
    } else {
      vscode.window.showErrorMessage('No corgi-compose.yml file found in the workspace root.');
      return;
    }
  }

  // If there's only one file, use it
  if (files.length === 1) {
    await runInTerminal(command, path.dirname(files[0].fsPath), files[0].fsPath);
    return;
  }

  let fileItems = files.map(file => ({
    label: path.basename(file.fsPath),
    description: getLastFoldersFromPath(file.fsPath)
  }));

  let selectedFile = await vscode.window.showQuickPick(fileItems, {
    placeHolder: `Select a corgi yml file to ${command}`
  });

  if (selectedFile) {
    const fullFilePath = files.find(file => file.fsPath.endsWith(selectedFile!.description))?.fsPath;
    if (fullFilePath) {
      await runInTerminal(command, path.dirname(fullFilePath), fullFilePath);
    }
  } else {
    // Handle the case where no file was selected, if needed.
    vscode.window.showInformationMessage('No corgi-compose file was selected.');
  }
}

function getLastFoldersFromPath(filePath: string, count: number = 3): string {
  const segments = filePath.split(path.sep);
  return segments.slice(-count).join(path.sep);
}

export async function installCorgiWithHomebrew(): Promise<boolean> {
  return new Promise<boolean>(async (resolve) => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Installing Corgi...",
        cancellable: false
      },
      async (progress, token) => {
        exec('brew install andriiklymiuk/homebrew-tools/corgi', (error) => {
          if (error) {
            resolve(false);
          } else {
            resolve(true);
          }
        });
      }
    );
  });
}

let globalTerminal: vscode.Terminal | null = null;

const autoExecuteCommands = ['db -u', 'db -d', 'db -s', 'db --seedAll'];

function runInTerminal(command: string, directoryPath: string, filePath?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!globalTerminal) {
      globalTerminal = vscode.window.createTerminal({
        name: "Corgi Terminal",
        cwd: directoryPath,
      });
    }
    globalTerminal.show();
    let fullCommand = filePath ? `corgi ${command} -f ${path.basename(filePath)}` : `corgi ${command}`;
    globalTerminal.sendText(fullCommand);

    // custom timeout to wait for command execution. Not ideal, but for now it will do
    setTimeout(() => {
      resolve();
    }, 3000);

    if (autoExecuteCommands.includes(command)) {
      globalTerminal.sendText('\u000D');  // Send the enter key to the terminal.
    }
  });
}
