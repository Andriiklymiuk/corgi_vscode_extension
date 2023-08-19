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
        new CorgiNode('Run from your location', vscode.TreeItemCollapsibleState.Collapsed),
        new CorgiNode('Info commands', vscode.TreeItemCollapsibleState.Collapsed),
      ]);
    }

    const generalCommands = [
      { id: "corgi.run", title: "Corgi run", icon: "play-circle" },
      { id: "corgi.init", title: "Corgi init", icon: "tools" },
      { id: "corgi.pull", title: "Corgi pull", icon: "cloud-download" },
      { id: "corgi.doctor", title: "Doctor corgi", icon: "info" },
    ];

    const rootCommands = [
      { id: "corgi.runFromRoot", title: "Corgi run", icon: "play-circle" },
      { id: "corgi.initFromRoot", title: "Corgi init", icon: "tools" },
      { id: "corgi.pullFromRoot", title: "Corgi pull", icon: "cloud-download" },
      { id: "corgi.doctorFromRoot", title: "Doctor corgi", icon: "info" },
    ];

    const infoCommands = [
      { id: "corgi.docs", title: "Show corgi docs", icon: "book" },
      { id: "corgi.help", title: "Show corgi help", icon: "question" },
    ];

    if (element.label === 'Run from your location') {
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

    return Promise.resolve([]);
  }


}
