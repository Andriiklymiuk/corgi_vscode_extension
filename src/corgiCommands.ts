/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as path from 'path';

export async function executeCorgiCommand(command: string, fromRoot: boolean = false) {
  let files = await vscode.workspace.findFiles('**/corgi-*.yml');

  if (!files.length) {
    vscode.window.showErrorMessage('No corgi-compose.yml file found.');
    return;
  }

  let rootDirectory = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';

  if (fromRoot) {
    // If running from root, check if there's a corgi file in the root
    const rootCorgiFile = files.find(file => path.dirname(file.fsPath) === rootDirectory);
    if (rootCorgiFile) {
      runInTerminal(command, rootDirectory, rootCorgiFile.fsPath);
      return;
    } else {
      vscode.window.showErrorMessage('No corgi-compose.yml file found in the workspace root.');
      return;
    }
  }

  // If there's only one file, use it
  if (files.length === 1) {
    runInTerminal(command, path.dirname(files[0].fsPath), files[0].fsPath);
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
      runInTerminal(command, path.dirname(fullFilePath), fullFilePath);
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

export function installCorgiWithHomebrew() {
  let terminal = vscode.window.createTerminal("Corgi Terminal");
  terminal.show();
  terminal.sendText("brew tap andriiklymiuk/homebrew-tools");
  terminal.sendText("brew install corgi");
}

const autoExecuteCommands = ['db -u', 'db -d', 'db -s', 'db --seedAll'];

function runInTerminal(command: string, directoryPath: string, filePath?: string) {
  let terminal = vscode.window.createTerminal({
    name: "Corgi Terminal",
    cwd: directoryPath
  });
  terminal.show();
  if (command === 'run' && filePath) {
    terminal.sendText(`corgi ${command} -f ${path.basename(filePath)}`);
  } else {
    terminal.sendText(`corgi ${command}`);
  }

  if (autoExecuteCommands.includes(command)) {
    terminal.sendText('\u000D');  // Send the enter key to the terminal.
  }
}