import * as vscode from 'vscode';
import { isCorgiInstalled } from './corgiCommands';
import * as path from 'path';
import * as fs from 'fs';

export interface CorgiExample {
  title: string;
  link: string;
  publicLink?: string;
  path?: string;
}

async function getCustomExamples(): Promise<CorgiExample[]> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      const workspacePath = workspaceFolders[0].uri.fsPath;
      const exampleFilePath = path.join(workspacePath, 'corgi-examples.json');
      if (fs.existsSync(exampleFilePath)) {
        const rawData = fs.readFileSync(exampleFilePath, 'utf-8');
        if (!rawData) { return []; };
        const parsedData = JSON.parse(rawData);
        return parsedData;
      }
    }
  } catch (error) {
    console.error('Error reading corgi-examples.json:', error);
  }
  return [];
}

const exampleProjects: CorgiExample[] = [
  {
    title: '2 postgres databases',
    link: 'https://github.com/Andriiklymiuk/corgi/blob/main/examples/0example.corgi-compose.yml',
    publicLink: 'https://github.com/Andriiklymiuk/corgi/blob/main/examples/0example.corgi-compose.yml'
  }
];


export class CorgiNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly commandId?: string,
    private readonly iconName?: string,
    public readonly args: any[] = [],
    public readonly contextValue?: string,
  ) {
    super(label, collapsibleState);

    if (this.commandId) {
      this.command = {
        command: this.commandId,
        title: label,
        arguments: this.args
      };
    }

    if (this.iconName) {
      this.iconPath = new vscode.ThemeIcon(this.iconName);  // use ThemeIcon with codicon name
    }
    this.contextValue = contextValue;
  }
}

export class CorgiDividerNode extends CorgiNode {
  constructor() {
    super('', vscode.TreeItemCollapsibleState.None);
    this.description = '───────';
  }
}

export class CorgiTreeProvider implements vscode.TreeDataProvider<CorgiNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<CorgiNode | undefined | null | void> = new vscode.EventEmitter<CorgiNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<CorgiNode | undefined | null | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CorgiNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: CorgiNode): Promise<CorgiNode[]> {
    const isInstalled = await isCorgiInstalled();
    const customExamples = await getCustomExamples();
    console.log('customExamples', customExamples);

    if (!isInstalled) {
      return [];
    }
    if (!element) {
      const rootItems = [
        new CorgiNode('Run from workspace root', vscode.TreeItemCollapsibleState.Expanded),
        new CorgiDividerNode(),
        new CorgiNode('Run from chosen location', vscode.TreeItemCollapsibleState.Collapsed),
        new CorgiDividerNode(),
        new CorgiNode('Databases from workspace root', vscode.TreeItemCollapsibleState.Collapsed),
        new CorgiNode('Databases from chosen location', vscode.TreeItemCollapsibleState.Collapsed),
        new CorgiDividerNode(),
        new CorgiNode('Info commands', vscode.TreeItemCollapsibleState.Collapsed),
        new CorgiDividerNode(),
        new CorgiNode('Examples', vscode.TreeItemCollapsibleState.Collapsed),
      ];
      if (customExamples?.length > 0) {
        rootItems.push(new CorgiNode('Your Examples', vscode.TreeItemCollapsibleState.Collapsed));
      }
      return Promise.resolve(rootItems);
    }

    const generalCommands = [
      { id: "corgi.run", title: "Corgi run", icon: "debug-start" },
      { id: "corgi.stop", title: "Corgi stop", icon: "stop-circle" },
      { id: "corgi.init", title: "Initialize repos and databases", icon: "tools" },
      { id: "corgi.pull", title: "git pull all repos", icon: "cloud-download" },
      { id: "corgi.doctor", title: "Install required services", icon: "info" },
      { id: "corgi.create", title: "Corgi create", icon: "file-code" },
      { id: "corgi.clean", title: "Clean", icon: "trash" },
    ];

    const rootCommands = [
      { id: "corgi.runFromRoot", title: "Corgi run", icon: "debug-start" },
      { id: "corgi.stop", title: "Corgi stop", icon: "stop-circle" },
      { id: "corgi.initFromRoot", title: "Initialize repos and databases", icon: "tools" },
      { id: "corgi.pullFromRoot", title: "git pull all repos", icon: "cloud-download" },
      { id: "corgi.doctorFromRoot", title: "Install required services", icon: "info" },
      { id: "corgi.createFromRoot", title: "Corgi create", icon: "file-code" },
      { id: "corgi.cleanFromRoot", title: "Clean", icon: "trash" },
    ];

    const infoCommands = [
      { id: "corgi.docs", title: "Show corgi docs", icon: "book" },
      { id: "corgi.help", title: "Show corgi help", icon: "question" },
    ];

    const dbCommands = [
      { id: "corgi.db", title: "All databases", icon: "notebook" },
      { id: "corgi.dbUp", title: "Up all db`s", icon: "debug-start" },
      { id: "corgi.dbStop", title: "Stop all db`s", icon: "debug-stop" },
      { id: "corgi.dbDown", title: "Stop and remove all db`s", icon: "clear-all" },
      { id: "corgi.dbSeed", title: "Seed all db`s with you data", icon: "circuit-board" },
    ];
    const dbRootCommands = [
      { id: "corgi.dbFromRoot", title: "All databases", icon: "notebook" },
      { id: "corgi.dbUpFromRoot", title: "Up all db`s", icon: "debug-start" },
      { id: "corgi.dbStopFromRoot", title: "Stop all db`s", icon: "debug-stop" },
      { id: "corgi.dbDownFromRoot", title: "Stop and remove all db`s", icon: "clear-all" },
      { id: "corgi.dbSeedFromRoot", title: "Seed all db`s with you data", icon: "circuit-board" },
    ];

    if (element.label === 'Run from chosen location') {
      return Promise.resolve(
        generalCommands.map(command => new CorgiNode(command.title, vscode.TreeItemCollapsibleState.None, command.id, command.icon))
      );
    }

    if (element.label === 'Run from workspace root') {
      return Promise.resolve(
        rootCommands.map(command => new CorgiNode(command.title, vscode.TreeItemCollapsibleState.None, command.id, command.icon))
      );
    }

    if (element.label === 'Info commands') {
      return Promise.resolve(
        infoCommands.map(command => new CorgiNode(command.title, vscode.TreeItemCollapsibleState.None, command.id, command.icon))
      );
    }
    if (element.label === 'Databases from workspace root') {
      return Promise.resolve(
        dbRootCommands.map(command => new CorgiNode(command.title, vscode.TreeItemCollapsibleState.None, command.id, command.icon))
      );
    }
    if (element.label === 'Databases from chosen location') {
      return Promise.resolve(
        dbCommands.map(command => new CorgiNode(command.title, vscode.TreeItemCollapsibleState.None, command.id, command.icon))
      );
    }

    if (element.label === 'Examples') {
      return Promise.resolve(
        exampleProjects.map(project => new CorgiNode(
          project.title,
          vscode.TreeItemCollapsibleState.None,
          'corgi.runExample',
          undefined,
          [project],
          'example'
        ))
      );
    }
    if (element.label === 'Your Examples') {
      return Promise.resolve(customExamples.map(project =>
        new CorgiNode(
          project.title,
          vscode.TreeItemCollapsibleState.None,
          'corgi.runExample',
          undefined,
          [project],
          'example'
        )
      ));
    }

    return Promise.resolve([]);
  }


}
