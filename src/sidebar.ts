import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { readBots } from './agentBoard';
import { hiddenWorkspaces, type AgentBoardWatcher } from './agentStatus';
import { isCorgiInstalled } from './corgiCommands';
import { corgiBinary, isolateArgs, runCorgi } from './corgiExec';
import { page } from './sidebarHtml';
import { build, InboxNode, SessionNode } from './sidebarModel';
import { InboxItem, itemName, readInbox } from './watchInbox';

/**
 * The Corgi sidebar: usage, the tracker inbox and the agent sessions on one
 * webview page. It draws what the board watcher and the inbox poll already
 * read; nothing here polls on its own beyond the inbox's minute. State goes
 * to the page only when it changed and only while the page is showing; the
 * page asks for it again when it comes back.
 */

const POLL_MS = 60_000;
const DEBOUNCE_MS = 150;

/** What a row may ask the extension to run, by name. Anything else is dropped. */
const ALLOWED = new Set([
    'corgi.agent.focusNode', 'corgi.agent.chat', 'corgi.agent.answer', 'corgi.agent.deny', 'corgi.agent.fresh', 'corgi.agent.openPr',
    'corgi.agent.new', 'corgi.agent.newIsolated',
    'corgi.agent.inboxWorkOn', 'corgi.agent.inboxIgnore', 'corgi.agent.inboxUnblock',
    'corgi.sidebar.reload', 'corgi.installWithHomebrew',
]);

type Node = SessionNode | InboxNode;
type Message = { type: string; command?: string; node?: Node; url?: string };

export class CorgiSidebar implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = 'corgiSidebar';
    private view: vscode.WebviewView | undefined;
    private items: InboxItem[] = [];
    private installed = true;
    private timer: NodeJS.Timeout | undefined;
    private debounce: NodeJS.Timeout | undefined;
    private lastJson = '';
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly watcher: AgentBoardWatcher, private readonly agentDir: string) { }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [] };
        view.webview.html = page(crypto.randomBytes(16).toString('base64'));
        view.onDidChangeVisibility(() => {
            if (view.visible) {
                this.lastJson = '';
                this.push();
            }
        });
        view.onDidDispose(() => {
            if (this.view === view) {
                this.view = undefined;
            }
        });
        view.webview.onDidReceiveMessage((m: Message) => this.onMessage(m));
    }

    private onMessage(m: Message): void {
        if (m.type === 'ready') {
            this.lastJson = '';
            this.push();
        } else if (m.type === 'open' && typeof m.url === 'string' && /^https?:\/\//.test(m.url)) {
            void vscode.env.openExternal(vscode.Uri.parse(m.url));
        } else if (m.type === 'run' && typeof m.command === 'string' && ALLOWED.has(m.command)) {
            void vscode.commands.executeCommand(m.command, m.node);
        } else if (m.type === 'menu' && m.node) {
            void this.menu(m.node);
        }
    }

    /** Rebuild the state; post it when it changed and the page is showing. */
    push(): void {
        if (this.debounce) {
            clearTimeout(this.debounce);
        }
        this.debounce = setTimeout(() => {
            this.debounce = undefined;
            if (!this.view?.visible) {
                return;
            }
            const state = build(this.watcher.current(), this.items, hiddenWorkspaces(), readBots(this.agentDir), new Date(), this.installed);
            const json = JSON.stringify(state);
            if (json === this.lastJson) {
                return;
            }
            this.lastJson = json;
            void this.view.webview.postMessage({ type: 'state', state });
        }, DEBOUNCE_MS);
    }

    async refresh(): Promise<void> {
        this.installed = await isCorgiInstalled();
        this.items = this.installed ? await readInbox(corgiBinary(), hiddenWorkspaces()) : [];
        this.push();
    }

    /** The row's ⋯: everything the row can do that is not a hover button. */
    private async menu(node: Node): Promise<void> {
        type Pick = vscode.QuickPickItem & { command: string; args?: unknown[] };
        const items: Pick[] = [];
        if (node.kind === 'session') {
            const s = node.session;
            items.push({ label: '$(comment) Chat beside the code', command: 'corgi.agent.chat' }, { label: '$(arrow-right) Send…', command: 'corgi.agent.sendTo' }, { label: '$(note) Note…', command: 'corgi.agent.note' });
            if (s.pending) {
                items.push({ label: '$(check-all) Always allow', command: 'corgi.agent.always' });
            }
            if (s.drift?.length) {
                items.push({ label: '$(refresh) Fresh: restart clean from a handoff', command: 'corgi.agent.fresh' });
            }
            if (s.pr) {
                items.push({ label: '$(git-pull-request) Open pull request', command: 'corgi.agent.openPr' });
            }
            if (s.status === 'working') {
                items.push({ label: '$(debug-stop) Interrupt the turn', command: 'corgi.agent.interrupt' });
            }
            items.push(
                { label: '$(copy) Copy session id', command: 'corgi.agent.copyId' },
                { label: '$(close) Take off the board', command: 'corgi.agent.dismiss' },
                { label: '$(eye-closed) Hide this workspace', command: 'corgi.agent.hideWorkspace', args: [{ kind: 'group', label: s.label }] },
            );
        } else {
            const item = node.item;
            const issue = (item.kind ?? '').startsWith('issue.') || item.kind === 'task';
            if (issue) {
                items.push({ label: '$(play) Work on it', command: 'corgi.agent.inboxWorkOn' }, { label: '$(git-branch) Work on it in a worktree', command: 'corgi.agent.inboxWorkOnIsolated' });
            }
            if (item.url) {
                items.push({ label: '$(link-external) Open', command: 'corgi.agent.inboxOpen' });
            }
            if (item.blocked) {
                items.push({ label: '$(debug-continue) Unblock', command: 'corgi.agent.inboxUnblock' });
            }
            if (item.ref) {
                items.push({ label: '$(person) Assign to me', command: 'corgi.agent.inboxAssign' }, { label: '$(list-tree) Move to a column…', command: 'corgi.agent.inboxMove' });
            }
            if (item.pr) {
                items.push({ label: '$(git-pull-request) Mark ready', command: 'corgi.agent.inboxPrReady' }, { label: '$(git-merge) Merge', command: 'corgi.agent.inboxPrMerge' }, { label: '$(git-pull-request-closed) Close', command: 'corgi.agent.inboxPrClose' });
            }
            items.push({ label: '$(bell-slash) Ignore', command: 'corgi.agent.inboxIgnore' });
        }
        const title = node.kind === 'session' ? node.session.title || node.session.label || node.session.id : itemName(node.item);
        const pick = await vscode.window.showQuickPick(items, { placeHolder: title });
        if (pick) {
            await vscode.commands.executeCommand(pick.command, ...(pick.args ?? [node]));
        }
    }

    start(): vscode.Disposable {
        const itemOf = (node?: Node): InboxItem | undefined => (node?.kind === 'item' ? node.item : undefined);
        // A ticket action runs corgi's own command, then the inbox re-reads.
        const act = async (args: string[], failure: string) => {
            const r = await runCorgi(['agent', 'watch', ...args]);
            if (!r.ok) {
                void vscode.window.showWarningMessage(`${failure}: ${r.stderr.trim() || r.stdout.trim()}`);
            }
            await this.refresh();
        };
        this.disposables.push(
            this.watcher.onDidChangeBoard(() => this.push()),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('corgi.agent.hiddenWorkspaces')) {
                    void this.refresh();
                }
            }),
            // The title bar's ↻ is a real reload: the daemon rescans and polls
            // every tracker now; the board and this inbox re-read after it.
            vscode.commands.registerCommand('corgi.sidebar.reload', async () => {
                const r = await runCorgi(['agent', 'refresh']);
                if (!r.ok) {
                    void vscode.window.showWarningMessage(`corgi could not refresh: ${r.stderr.trim() || r.stdout.trim()}`);
                }
                this.watcher.refresh();
                await this.refresh();
                setTimeout(() => {
                    this.watcher.refresh();
                    void this.refresh();
                }, 1500);
            }),
            // Kept for corgi.agent.refresh and older keybindings: a quiet re-read.
            vscode.commands.registerCommand('corgi.agent.inboxRefresh', async (opts?: { quiet?: boolean }) => {
                if (!opts?.quiet) {
                    await runCorgi(['agent', 'refresh']);
                    setTimeout(() => void this.refresh(), 1500);
                }
                await this.refresh();
            }),
            vscode.commands.registerCommand('corgi.agent.inboxOpen', (node?: Node) => {
                const url = itemOf(node)?.url;
                if (url && /^https:\/\//.test(url)) {
                    void vscode.env.openExternal(vscode.Uri.parse(url));
                }
            }),
            // Work on it: a real session on the ticket, with the prompt an
            // unattended run would have had — the page's and the phone's button.
            ...([['corgi.agent.inboxWorkOn', undefined], ['corgi.agent.inboxWorkOnIsolated', '--isolate']] as const).map(([id, flag]) =>
                vscode.commands.registerCommand(id, async (node?: Node) => {
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
                vscode.commands.registerCommand(`corgi.agent.inboxPr${verb[0].toUpperCase()}${verb.slice(1)}`, async (node?: Node) => {
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
            vscode.commands.registerCommand('corgi.agent.inboxIgnore', async (node?: Node) => {
                const item = itemOf(node);
                if (item) {
                    this.items = this.items.filter((i) => i.key !== item.key);
                    this.push();
                    await act(['ignore', item.key], 'corgi could not ignore it');
                }
            }),
            vscode.commands.registerCommand('corgi.agent.inboxUnblock', async (node?: Node) => {
                const item = itemOf(node);
                if (item?.ref) {
                    await act(['unblock', item.ref, ...(item.workspace ? ['--workspace', item.workspace] : [])], 'corgi could not unblock it');
                }
            }),
            vscode.commands.registerCommand('corgi.agent.inboxAssign', async (node?: Node) => {
                const item = itemOf(node);
                if (item?.ref) {
                    await act(['assign', item.ref, ...(item.workspace ? ['--workspace', item.workspace] : [])], 'corgi could not assign it');
                }
            }),
            vscode.commands.registerCommand('corgi.agent.inboxMove', async (node?: Node) => {
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

    dispose(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }
        if (this.debounce) {
            clearTimeout(this.debounce);
        }
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
    }
}
