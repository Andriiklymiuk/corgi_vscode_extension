import * as vscode from 'vscode';
import { InboxItem, groupByWorkspace, itemDetail, itemName, openableUrl, readInbox } from './watchInbox';

const POLL_MS = 60_000;

type InboxNode =
    | { kind: 'group'; workspace: string; items: InboxItem[] }
    | { kind: 'item'; item: InboxItem };

const ICONS: Record<string, string> = {
    'issue.new': 'issues',
    'issue.comment': 'comment',
    'pr.comment': 'comment-discussion',
    'pr.review': 'git-pull-request',
    'ci.failed': 'error',
};

/**
 * The tracker inbox in the sidebar: the tickets, reviews and red builds the
 * watch has seen and nobody has dealt with. The phone has had this since the
 * tabs; the editor is where the day is actually spent.
 */
export class WatchInboxTree implements vscode.TreeDataProvider<InboxNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<InboxNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private readonly disposables: vscode.Disposable[] = [];
    private timer: NodeJS.Timeout | undefined;
    private items: InboxItem[] = [];

    start(): vscode.Disposable {
        this.disposables.push(
            vscode.commands.registerCommand('corgi.agent.inboxRefresh', () => this.refresh()),
            vscode.commands.registerCommand('corgi.agent.inboxOpen', (node?: InboxNode) => {
                const url = node?.kind === 'item' ? openableUrl(node.item) : undefined;
                if (url) {
                    void vscode.env.openExternal(vscode.Uri.parse(url));
                }
            }),
        );
        this.timer = setInterval(() => void this.refresh(), POLL_MS);
        void this.refresh();
        return this;
    }

    async refresh(): Promise<void> {
        this.items = await readInbox();
        this.changed.fire(undefined);
    }

    getChildren(node?: InboxNode): InboxNode[] {
        if (!node) {
            const groups = groupByWorkspace(this.items);
            if (groups.length === 1) {
                return groups[0].items.map((item) => ({ kind: 'item', item }));
            }
            return groups.map((g) => ({ kind: 'group', workspace: g.workspace, items: g.items }));
        }
        return node.kind === 'group' ? node.items.map((item) => ({ kind: 'item', item })) : [];
    }

    getTreeItem(node: InboxNode): vscode.TreeItem {
        if (node.kind === 'group') {
            const el = new vscode.TreeItem(node.workspace, vscode.TreeItemCollapsibleState.Expanded);
            el.description = String(node.items.length);
            el.iconPath = new vscode.ThemeIcon('folder');
            return el;
        }
        const { item } = node;
        const el = new vscode.TreeItem(itemName(item), vscode.TreeItemCollapsibleState.None);
        el.description = itemDetail(item, Date.now());
        el.tooltip = item.title || itemName(item);
        el.iconPath = new vscode.ThemeIcon(ICONS[item.kind ?? ''] ?? 'circle-outline');
        el.contextValue = 'corgiInboxItem';
        const url = openableUrl(item);
        if (url) {
            el.command = { command: 'corgi.agent.inboxOpen', title: 'Open', arguments: [node] };
        }
        return el;
    }

    dispose(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }
        this.changed.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
    }
}
