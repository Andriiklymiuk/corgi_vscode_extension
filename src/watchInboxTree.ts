import * as vscode from 'vscode';
import { InboxItem, groupByWorkspace, itemDetail, itemName, openableUrl, readInbox } from './watchInbox';
import { corgiBinary, isolateArgs, runCorgi } from './corgiExec';

const POLL_MS = 60_000;

type InboxNode =
    | { kind: 'group'; workspace: string; items: InboxItem[] }
    | { kind: 'item'; item: InboxItem };

const ICONS: Record<string, string> = {
    'issue.new': 'issues',
    'issue.comment': 'comment',
    'pr.comment': 'comment-discussion',
    'pr.review': 'git-pull-request',
    'review.requested': 'git-pull-request',
    'ci.failed': 'error',
    routine: 'checklist',
};

const hiddenWorkspaces = (): string[] => vscode.workspace.getConfiguration('corgi').get<string[]>('agent.hiddenWorkspaces', []) ?? [];

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
        const itemOf = (node?: InboxNode): InboxItem | undefined => (node?.kind === 'item' ? node.item : undefined);
        // A ticket action runs corgi's own command, then the inbox re-reads.
        const act = async (args: string[], failure: string) => {
            const r = await runCorgi(['agent', 'watch', ...args]);
            if (!r.ok) {
                void vscode.window.showWarningMessage(`${failure}: ${r.stderr.trim() || r.stdout.trim()}`);
            }
            await this.refresh();
        };
        this.disposables.push(
            // The view's ↻ is a real reload: the daemon rescans and polls every
            // tracker now, then this list re-reads; `{quiet:true}` is the
            // re-read the sessions view's reload asks for after it.
            vscode.commands.registerCommand('corgi.agent.inboxRefresh', async (opts?: { quiet?: boolean }) => {
                if (!opts?.quiet) {
                    await runCorgi(['agent', 'refresh']);
                    setTimeout(() => void this.refresh(), 1500);
                }
                await this.refresh();
            }),
            vscode.commands.registerCommand('corgi.agent.inboxOpen', (node?: InboxNode) => {
                const url = node?.kind === 'item' ? openableUrl(node.item) : undefined;
                if (url) {
                    void vscode.env.openExternal(vscode.Uri.parse(url));
                }
            }),
            // Work on it: a real session on the ticket, with the prompt an
            // unattended run would have had — the page's and the phone's button.
            ...([['corgi.agent.inboxWorkOn', undefined], ['corgi.agent.inboxWorkOnIsolated', '--isolate']] as const).map(([id, flag]) =>
                vscode.commands.registerCommand(id, async (node?: InboxNode) => {
                    const item = itemOf(node);
                    if (!item?.key) {
                        return;
                    }
                    const r = await runCorgi(['agent', 'watch', 'work', item.key, '--from', 'editor', ...(flag ? [flag] : isolateArgs())]);
                    if (!r.ok) {
                        void vscode.window.showWarningMessage(`corgi could not start a session on ${itemName(item)}: ${r.stderr.trim() || r.stdout.trim()}`);
                        return;
                    }
                    void vscode.window.setStatusBarMessage(`corgi: opening a session on ${itemName(item)}${flag ? ' in its own worktree' : ''}…`, 5000);
                    setTimeout(() => void this.refresh(), 2500);
                }),
            ),
            // A pull request of mine, from the row: out of draft, merged, closed.
            ...(['ready', 'merge', 'close'] as const).map((verb) =>
                vscode.commands.registerCommand(`corgi.agent.inboxPr${verb[0].toUpperCase()}${verb.slice(1)}`, async (node?: InboxNode) => {
                    const item = itemOf(node);
                    if (!item?.key || !item.pr) {
                        return;
                    }
                    if (verb !== 'ready') {
                        const ok = await vscode.window.showWarningMessage(`${verb === 'merge' ? 'Merge' : 'Close without merging'} ${item.pr}?`, { modal: true }, verb === 'merge' ? 'Merge' : 'Close');
                        if (!ok) {
                            return;
                        }
                    }
                    const r = await runCorgi(['agent', 'watch', 'pr', verb, item.key]);
                    if (!r.ok) {
                        void vscode.window.showWarningMessage(`corgi could not change the pull request: ${r.stderr.trim() || r.stdout.trim()}`);
                    } else {
                        void vscode.window.setStatusBarMessage(`corgi: ${r.stdout.trim()}`, 5000);
                    }
                    await this.refresh();
                }),
            ),
            vscode.commands.registerCommand('corgi.agent.inboxIgnore', async (node?: InboxNode) => {
                const item = itemOf(node);
                if (item) {
                    this.items = this.items.filter((i) => i.key !== item.key);
                    this.changed.fire(undefined);
                    await act(['ignore', item.key], 'corgi could not ignore it');
                }
            }),
            vscode.commands.registerCommand('corgi.agent.inboxUnblock', async (node?: InboxNode) => {
                const item = itemOf(node);
                if (item?.ref) {
                    await act(['unblock', item.ref, ...(item.workspace ? ['--workspace', item.workspace] : [])], 'corgi could not unblock it');
                }
            }),
            vscode.commands.registerCommand('corgi.agent.inboxAssign', async (node?: InboxNode) => {
                const item = itemOf(node);
                if (item?.ref) {
                    await act(['assign', item.ref, ...(item.workspace ? ['--workspace', item.workspace] : [])], 'corgi could not assign it');
                }
            }),
            vscode.commands.registerCommand('corgi.agent.inboxMove', async (node?: InboxNode) => {
                const item = itemOf(node);
                if (!item?.ref) {
                    return;
                }
                // A task carries its own columns; a tracker ticket's come from the board.
                const columns = item.columns?.length ? item.columns : await this.columns(item.workspace);
                const status = columns.length
                    ? await vscode.window.showQuickPick(columns, { placeHolder: `Move ${itemName(item)} to` })
                    : await vscode.window.showInputBox({ prompt: `Move ${itemName(item)} to which column?` });
                if (status && item.kind === 'task') {
                    const r = await runCorgi(['agent', 'task', 'move', item.ref, status]);
                    if (!r.ok) {
                        void vscode.window.showWarningMessage(`corgi could not move it: ${r.stderr.trim() || r.stdout.trim()}`);
                    }
                    await this.refresh();
                } else if (status) {
                    await act(['move', item.ref, status, ...(item.workspace ? ['--workspace', item.workspace] : [])], 'corgi could not move it');
                }
            }),
        );
        this.timer = setInterval(() => void this.refresh(), POLL_MS);
        void this.refresh();
        return this;
    }

    async refresh(): Promise<void> {
        this.items = await readInbox(corgiBinary(), hiddenWorkspaces());
        this.changed.fire(undefined);
    }

    /** The tracker's columns for a workspace, from `corgi agent watch board --json`; empty when it cannot say. */
    private async columns(workspace?: string): Promise<string[]> {
        const r = await runCorgi(['agent', 'watch', 'board', '--json', ...(workspace ? ['--workspace', workspace] : [])]);
        if (!r.ok) {
            return [];
        }
        try {
            const parsed = JSON.parse(r.stdout) as { board?: { statuses?: { name?: string }[] } };
            return (parsed.board?.statuses ?? []).map((c) => c?.name ?? '').filter(Boolean);
        } catch {
            // not JSON: no columns
        }
        return [];
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
        el.tooltip = [item.title || itemName(item), item.author && item.body ? `\n${item.author}: ${item.body}` : '', item.blocked ? `\nblocked: ${item.blocked}` : ''].filter(Boolean).join('\n');
        el.iconPath = item.blocked
            ? new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('notificationsErrorIcon.foreground'))
            : item.session
              ? new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('notificationsWarningIcon.foreground'))
              : new vscode.ThemeIcon(ICONS[item.kind ?? ''] ?? 'circle-outline');
        // Markers the menus key on: Blocked shows Unblock, Issue shows Work on it.
        el.contextValue = `corgiInboxItem${item.blocked ? 'Blocked' : ''}${(item.kind ?? '').startsWith('issue.') || item.kind === 'task' ? 'Issue' : ''}${item.pr ? 'Pr' : ''}`;
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
