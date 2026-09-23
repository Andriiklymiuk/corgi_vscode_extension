import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readBots } from './agentBoard';
import { hiddenWorkspaces, type AgentBoardWatcher } from './agentStatus';
import { isCorgiInstalled } from './corgiCommands';
import { corgiBinary, isolateArgs, runCorgi } from './corgiExec';
import { page } from './sidebarHtml';
import { build, DaemonInfo, InboxNode, KanbanCard, SessionNode, WatchedWorkspace, WorkspaceInfo } from './sidebarModel';
import { InboxItem, itemName, readInbox } from './watchInbox';

/**
 * The Corgi sidebar: the daemon line, usage, the tracker inbox, the kanban,
 * the sessions and the workspaces on one webview page. It draws what the
 * board watcher and one minute-poll read; state goes to the page only when
 * it changed and only while the page is showing; the page asks for it again
 * when it comes back.
 */

const POLL_MS = 60_000;
const DEBOUNCE_MS = 150;

/** What a row may ask the extension to run, by name. Anything else is dropped. */
const ALLOWED = new Set([
    'corgi.agent.focusNode', 'corgi.agent.chat', 'corgi.agent.why', 'corgi.agent.answer', 'corgi.agent.deny', 'corgi.agent.fresh', 'corgi.agent.openPr',
    'corgi.agent.new', 'corgi.agent.newIsolated',
    'corgi.agent.inboxWorkOn', 'corgi.agent.inboxIgnore', 'corgi.agent.inboxUnblock',
    'corgi.agent.mute', 'corgi.agent.unmute', 'corgi.agent.daemonRestart', 'corgi.agent.daemonStart',
    'corgi.agent.addAccount', 'corgi.agent.addWorkspace', 'corgi.agent.workspaceOpen',
    'corgi.agent.workspacePause', 'corgi.agent.workspaceResume', 'corgi.agent.watchEnable', 'corgi.agent.watchDisable',
    'corgi.sidebar.reload', 'corgi.installWithHomebrew',
]);

type WorkspaceNode = { kind: 'workspace'; id: string };
type Node = SessionNode | InboxNode | WorkspaceNode;
type Message = { type: string; command?: string; node?: Node; url?: string };

/** One read of everything the minute-poll fetches beside the inbox. */
interface Snapshot {
    items: InboxItem[];
    cards: KanbanCard[];
    workspaces: WorkspaceInfo[];
    watched: WatchedWorkspace[];
    running: string[];
    paused: string[];
}

export class CorgiSidebar implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = 'corgiSidebar';
    private view: vscode.WebviewView | undefined;
    private snap: Snapshot = { items: [], cards: [], workspaces: [], watched: [], running: [], paused: [] };
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

    /** The daemon's record and the mute, read from files: no process for a line of text. */
    private daemonInfo(): { daemon: DaemonInfo; mutedUntil: string } {
        let daemon: DaemonInfo = {};
        try {
            const info = JSON.parse(fs.readFileSync(path.join(this.agentDir, 'daemon.json'), 'utf8')) as DaemonInfo;
            if (info && typeof info.pid === 'number') {
                daemon = info;
            }
        } catch {
            // no record: the daemon is off
        }
        let mutedUntil = '';
        try {
            mutedUntil = fs.readFileSync(path.join(this.agentDir, 'muted-until'), 'utf8');
        } catch {
            // not muted
        }
        return { daemon, mutedUntil };
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
            const { daemon, mutedUntil } = this.daemonInfo();
            const state = build({
                board: this.watcher.current(), inbox: this.snap.items, hidden: hiddenWorkspaces(), bots: readBots(this.agentDir), now: new Date(),
                installed: this.installed, daemon, mutedUntil, cards: this.snap.cards,
                workspaces: this.snap.workspaces, watched: this.snap.watched, running: this.snap.running, paused: this.snap.paused,
            });
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
        if (!this.installed) {
            this.snap = { items: [], cards: [], workspaces: [], watched: [], running: [], paused: [] };
            this.push();
            return;
        }
        const hidden = hiddenWorkspaces();
        const [items, kanban, workspaces, watch, status] = await Promise.all([
            readInbox(corgiBinary(), hidden),
            corgiJSON<{ cards?: KanbanCard[] }>(['agent', 'kanban', '--json']),
            corgiJSON<WorkspaceInfo[]>(['agent', 'workspaces', '--json']),
            corgiJSON<{ workspaces?: WatchedWorkspace[] }>(['agent', 'watch', '--json']),
            corgiJSON<{ workspaces?: { workspaceId: string; running?: boolean }[] }>(['agent', 'status', '--json']),
        ]);
        const supervised = status?.workspaces ?? [];
        this.snap = {
            items,
            cards: (kanban?.cards ?? []).filter((c) => !hidden.includes(c.workspace ?? '')),
            workspaces: (Array.isArray(workspaces) ? workspaces : []).filter((w) => w && w.id && !hidden.includes(w.id)),
            watched: watch?.workspaces ?? [],
            running: supervised.filter((w) => w.running).map((w) => w.workspaceId),
            paused: (Array.isArray(workspaces) ? workspaces : []).filter((w) => w && w.id && !supervised.some((s) => s.workspaceId === w.id)).map((w) => w.id),
        };
        this.push();
    }

    /** The row's ⋯: everything the row can do that is not a hover button. */
    private async menu(node: Node): Promise<void> {
        type Pick = vscode.QuickPickItem & { command: string; args?: unknown[] };
        const items: Pick[] = [];
        let title = '';
        if (node.kind === 'session') {
            const s = node.session;
            title = s.title || s.label || s.id;
            items.push({ label: '$(comment) Chat beside the code', command: 'corgi.agent.chat' }, { label: '$(list-tree) Why: steps, tools and files', command: 'corgi.agent.why' }, { label: '$(arrow-right) Send…', command: 'corgi.agent.sendTo' }, { label: '$(note) Note…', command: 'corgi.agent.note' });
            if (s.pending) {
                items.push({ label: '$(check-all) Always allow', command: 'corgi.agent.always' });
            }
            if (s.drift?.length) {
                items.push({ label: '$(refresh) Fresh: restart clean from a handoff', command: 'corgi.agent.fresh' });
            }
            for (const profile of (this.watcher.current()?.accounts ?? []).map((a) => a.profile).filter((p) => p && p !== s.profile)) {
                items.push({ label: `$(account) Carry to ${profile}`, command: 'corgi.agent.carryTo', args: [node, profile] });
            }
            // The other agents its workspace lists: a fresh session there from a handoff.
            const own = s.agent || 'claude';
            for (const to of (this.snap.workspaces.find((w) => w.id === s.label)?.agents ?? []).filter((a) => a !== own)) {
                items.push({ label: `$(arrow-swap) Hand to ${to}`, command: 'corgi.agent.handTo', args: [node, to] });
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
        } else if (node.kind === 'item') {
            const item = node.item;
            title = itemName(item);
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
        } else {
            title = node.id;
            items.push(
                { label: '$(folder-opened) Open in a new window', command: 'corgi.agent.workspaceOpen' },
                { label: '$(add) New session here', command: 'corgi.agent.workspaceSession' },
            );
            const agents = this.snap.workspaces.find((w) => w.id === node.id)?.agents ?? [];
            if (agents.length > 1) {
                for (const a of agents) {
                    items.push({ label: `$(terminal) New ${a} session here`, command: 'corgi.agent.workspaceSessionAs', args: [node, a] });
                }
            }
            items.push(
                { label: '$(eye-closed) Hide from the sidebar', command: 'corgi.agent.hideWorkspace', args: [{ kind: 'group', label: node.id }] },
                { label: '$(trash) Forget this workspace', command: 'corgi.agent.workspaceForget' },
            );
        }
        const pick = await vscode.window.showQuickPick(items, { placeHolder: title });
        if (pick) {
            await vscode.commands.executeCommand(pick.command, ...(pick.args ?? [node]));
        }
    }

    start(): vscode.Disposable {
        const itemOf = (node?: Node): InboxItem | undefined => (node?.kind === 'item' ? node.item : undefined);
        const workspaceOf = (node?: Node): string => (node?.kind === 'workspace' ? node.id : '');
        // A ticket action runs corgi's own command, then the inbox re-reads.
        const act = async (args: string[], failure: string) => {
            const r = await runCorgi(['agent', 'watch', ...args]);
            if (!r.ok) {
                void vscode.window.showWarningMessage(`${failure}: ${r.stderr.trim() || r.stdout.trim()}`);
            }
            await this.refresh();
        };
        // A daemon action, then a re-read once it has had a moment.
        const agent = async (args: string[], failure: string, delayMs = 1500) => {
            const r = await runCorgi(['agent', ...args]);
            if (!r.ok) {
                void vscode.window.showWarningMessage(`${failure}: ${r.stderr.trim() || r.stdout.trim()}`);
            }
            this.watcher.refresh();
            await this.refresh();
            setTimeout(() => {
                this.watcher.refresh();
                void this.refresh();
            }, delayMs);
            return r.ok;
        };
        this.disposables.push(
            this.watcher.onDidChangeBoard(() => this.push()),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('corgi.agent.hiddenWorkspaces')) {
                    void this.refresh();
                }
            }),
            // The title bar's ↻ is a real reload: the daemon rescans and polls
            // every tracker now; the board and this page re-read after it.
            vscode.commands.registerCommand('corgi.sidebar.reload', () => agent(['refresh'], 'corgi could not refresh')),
            // Kept for corgi.agent.refresh and older keybindings: a quiet re-read.
            vscode.commands.registerCommand('corgi.agent.inboxRefresh', async (opts?: { quiet?: boolean }) => {
                if (!opts?.quiet) {
                    await runCorgi(['agent', 'refresh']);
                    setTimeout(() => void this.refresh(), 1500);
                }
                await this.refresh();
            }),
            vscode.commands.registerCommand('corgi.agent.daemonRestart', () => agent(['restart'], 'corgi could not restart the daemon', 4000)),
            vscode.commands.registerCommand('corgi.agent.daemonStart', () => agent(['up'], 'corgi could not start the daemon', 4000)),
            vscode.commands.registerCommand('corgi.agent.mute', async () => {
                const pick = await vscode.window.showQuickPick(['30m', '1h', '2h', '4h'], { placeHolder: 'Nothing rings for…' });
                if (pick) {
                    await agent(['mute', pick], 'corgi could not mute', 300);
                }
            }),
            vscode.commands.registerCommand('corgi.agent.unmute', () => agent(['mute', 'off'], 'corgi could not unmute', 300)),
            vscode.commands.registerCommand('corgi.agent.addAccount', async () => {
                const name = await vscode.window.showInputBox({ prompt: 'Account (profile) name', placeHolder: 'work', validateInput: (v) => (/^[a-z0-9][a-z0-9-]*$/i.test(v.trim()) ? undefined : 'letters, digits and dashes') });
                if (!name?.trim()) {
                    return;
                }
                const dir = await vscode.window.showInputBox({ prompt: `Claude config directory for ${name.trim()}`, value: `~/.claude-${name.trim()}`, placeHolder: '~/.claude-work' });
                if (!dir?.trim()) {
                    return;
                }
                if (await agent(['profile', 'add', name.trim(), '--config-dir', dir.trim()], 'corgi could not add the account')) {
                    void vscode.window.showInformationMessage(`corgi: account ${name.trim()} added. Log in once with: corgi agent claude --profile ${name.trim()}`);
                }
            }),
            vscode.commands.registerCommand('corgi.agent.carryTo', async (node?: Node, profile?: string) => {
                if (node?.kind !== 'session' || !profile) {
                    return;
                }
                await agent(['carry', node.session.id, '--profile', profile], `corgi could not carry it to ${profile}`, 3000);
            }),
            vscode.commands.registerCommand('corgi.agent.handTo', async (node?: Node, to?: string) => {
                if (node?.kind !== 'session' || !to) {
                    return;
                }
                await agent(['carry', node.session.id, '--to', to], `corgi could not hand it to ${to}`, 3000);
            }),
            vscode.commands.registerCommand('corgi.agent.workspaceSessionAs', async (node?: Node, as?: string) => {
                const id = workspaceOf(node);
                if (id && as) {
                    await agent(['new', '--workspace', id, '--agent', as], `corgi could not start a ${as} session there`, 3000);
                }
            }),
            vscode.commands.registerCommand('corgi.agent.addWorkspace', async () => {
                const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Opt this stack into agent mode', defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
                const folder = picked?.[0]?.fsPath;
                if (!folder) {
                    return;
                }
                // init asks questions; a terminal is where those belong.
                const term = vscode.window.createTerminal({ name: 'corgi agent init', cwd: folder });
                term.show();
                term.sendText('corgi agent init');
                setTimeout(() => void this.refresh(), 8000);
            }),
            vscode.commands.registerCommand('corgi.agent.workspacePause', (node?: Node) => agent(['workspaces', 'pause', workspaceOf(node)], 'corgi could not pause it')),
            vscode.commands.registerCommand('corgi.agent.workspaceResume', (node?: Node) => agent(['workspaces', 'resume', workspaceOf(node)], 'corgi could not resume it')),
            vscode.commands.registerCommand('corgi.agent.workspaceForget', async (node?: Node) => {
                const id = workspaceOf(node);
                const ok = id && await vscode.window.showWarningMessage(`Forget workspace ${id}? Nothing on disk changes.`, { modal: true }, 'Forget');
                if (ok) {
                    await agent(['workspaces', 'forget', id], 'corgi could not forget it');
                }
            }),
            vscode.commands.registerCommand('corgi.agent.workspaceOpen', async (node?: Node) => {
                const w = this.snap.workspaces.find((x) => x.id === workspaceOf(node));
                if (w?.absPath) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(w.absPath), { forceNewWindow: true });
                }
            }),
            vscode.commands.registerCommand('corgi.agent.workspaceSession', async (node?: Node) => {
                const id = workspaceOf(node);
                if (id) {
                    await agent(['session', 'start', id], 'corgi could not start a session there', 3000);
                }
            }),
            // The watch reads its rules at start, so a change restarts the daemon, as the bar does.
            vscode.commands.registerCommand('corgi.agent.watchEnable', async (node?: Node) => {
                const id = workspaceOf(node);
                const mode = id && await vscode.window.showQuickPick([{ label: 'Tell me', description: 'notify: tickets and reviews land in the inbox', value: 'notify' }, { label: 'Fix it', description: 'fix: an unattended session works each new ticket', value: 'fix' }], { placeHolder: `Watch ${id}: what should corgi do with what it finds?` });
                if (mode && await agent(['watch', 'enable', '--workspace', id, '--action', mode.value], 'corgi could not enable the watch')) {
                    await agent(['restart'], 'corgi could not restart the daemon', 4000);
                }
            }),
            vscode.commands.registerCommand('corgi.agent.watchDisable', async (node?: Node) => {
                const id = workspaceOf(node);
                if (id && await agent(['watch', 'disable', '--workspace', id], 'corgi could not disable the watch')) {
                    await agent(['restart'], 'corgi could not restart the daemon', 4000);
                }
            }),
            vscode.commands.registerCommand('corgi.agent.inboxOpen', (node?: Node) => {
                const url = itemOf(node)?.url;
                if (url && /^https:\/\//.test(url)) {
                    void vscode.env.openExternal(vscode.Uri.parse(url));
                }
            }),
            // Work on it: a real session on the ticket, with the prompt an
            // unattended run would have had - the page's and the phone's button.
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
                    this.snap.items = this.snap.items.filter((i) => i.key !== item.key);
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
        const parsed = await corgiJSON<{ board?: { statuses?: { name?: string }[] } }>(['agent', 'watch', 'board', '--json', ...(workspace ? ['--workspace', workspace] : [])]);
        return (parsed?.board?.statuses ?? []).map((c) => c?.name ?? '').filter(Boolean);
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

/** corgi's JSON for a read command, or undefined when it failed or was not JSON. */
async function corgiJSON<T>(args: string[]): Promise<T | undefined> {
    const r = await runCorgi(args);
    if (!r.ok) {
        return undefined;
    }
    try {
        return JSON.parse(r.stdout) as T;
    } catch {
        return undefined;
    }
}
