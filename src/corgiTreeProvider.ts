import * as vscode from 'vscode';

export class CorgiNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly commandId?: string,
    private readonly iconName?: string
  ) {
    super(label, collapsibleState);

    if (this.commandId) {
      this.command = {
        command: this.commandId,
        title: label,
        arguments: []
      };
    }

    if (this.iconName) {
      this.iconPath = new vscode.ThemeIcon(this.iconName);  // use ThemeIcon with codicon name
    }
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

  getChildren(element?: CorgiNode): Thenable<CorgiNode[]> {
    if (!element) {
      return Promise.resolve([
        new CorgiNode('Run from workspace root', vscode.TreeItemCollapsibleState.Expanded),
        new CorgiDividerNode(),
        new CorgiNode('Run from chosen location', vscode.TreeItemCollapsibleState.Collapsed),
        new CorgiDividerNode(),
        new CorgiNode('Databases from workspace root', vscode.TreeItemCollapsibleState.Collapsed),
        new CorgiNode('Databases from chosen location', vscode.TreeItemCollapsibleState.Collapsed),
        new CorgiDividerNode(),
        new CorgiNode('Info commands', vscode.TreeItemCollapsibleState.Collapsed),
      ]);
    }

    const generalCommands = [
      { id: "corgi.run", title: "Corgi run", icon: "debug-start" },
      { id: "corgi.stop", title: "Corgi stop", icon: "stop-cirle" },
      { id: "corgi.init", title: "Corgi init", icon: "tools" },
      { id: "corgi.pull", title: "Corgi pull", icon: "cloud-download" },
      { id: "corgi.doctor", title: "Doctor corgi", icon: "info" },
      { id: "corgi.create", title: "Corgi create", icon: "file-code" },
    ];

    const rootCommands = [
      { id: "corgi.runFromRoot", title: "Corgi run", icon: "debug-start" },
      { id: "corgi.stop", title: "Corgi stop", icon: "stop-cirle" },
      { id: "corgi.initFromRoot", title: "Corgi init", icon: "tools" },
      { id: "corgi.pullFromRoot", title: "Corgi pull", icon: "cloud-download" },
      { id: "corgi.doctorFromRoot", title: "Doctor corgi", icon: "info" },
      { id: "corgi.createFromRoot", title: "Corgi create", icon: "file-code" },
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

    return Promise.resolve([]);
  }


}
