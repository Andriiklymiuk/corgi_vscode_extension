import * as vscode from 'vscode';
import { AgentNode, AgentSessionsTree } from './agentTree';
import { WatchInboxTree } from './watchInboxTree';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    Board, BoardSession, boardTooltip, botTitle, formatElapsed, hideWorkspaces, liveSessions, newlyNeedingInput, nextSession, readBoard, readBots,
    sessionName, sortForPick, statusBarText, statusWord,
} from './agentBoard';
import { isolateArgs, runCorgi } from './corgiExec';
import { revealClaudePanel } from './agentWindow';
import { AutoContinueWatcher } from './autoContinueWatcher';
import { WatchFixesWatcher } from './watchFixesWatcher';

/**
 * The board side of agent mode inside a VS Code window: a status bar item
 * that reads corgi's sessions.json, a session quick pick, and a toast when a
 * session in another window starts waiting. Everything acts through the
 * corgi binary (`corgi agent focus|new|send|answer`), the same commands a
 * Stream Deck key runs, so the daemon stays the only thing that reveals.
 */

const POLL_MS = 5000;
const DEBOUNCE_MS = 150;

/** Ctrl+Y: the byte Claude Code's push-to-talk keybinding reads in a terminal. */
export const TALK_CHORD = '\x19';

export class AgentBoardWatcher implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly item: vscode.StatusBarItem;
    private watcher: fs.FSWatcher | undefined;
    private poll: NodeJS.Timeout | undefined;
    private debounce: NodeJS.Timeout | undefined;
    private board: Board | undefined;
    private readonly boardChanged = new vscode.EventEmitter<Board | undefined>();
    /** Fires after every board read, for views that draw it. */
    readonly onDidChangeBoard = this.boardChanged.event;
    private lastMtimeMs = -1;
    private readonly toasted = new Set<string>();
    private disposed = false;

    constructor(private readonly agentDir: string, private readonly windowId: string) {
        this.item = vscode.window.createStatusBarItem('corgi.agentBoard', vscode.StatusBarAlignment.Left, 50);
        this.item.name = 'Corgi agent sessions';
        this.item.command = 'corgi.agent.sessions';
    }

    get boardFile(): string {
        return path.join(this.agentDir, 'sessions.json');
    }

    current(): Board | undefined {
        return this.board;
    }

    start(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('corgi.agentStatusBar')) {
                    this.render();
                }
                if (e.affectsConfiguration('corgi.agent.hiddenWorkspaces')) {
                    this.lastMtimeMs = -1;
                    this.refresh();
                }
            }),
        );
        this.poll = setInterval(() => this.refresh(), POLL_MS);
        this.watch();
        this.refresh();
    }

    private watch(): void {
        if (this.watcher || this.disposed) {
            return;
        }
        try {
            // The daemon renames a temp file over sessions.json; watching the
            // directory sees that, watching the file would lose the inode.
            this.watcher = fs.watch(this.agentDir, (_event, filename) => {
                if (!filename || filename.toString() === 'sessions.json') {
                    this.scheduleRefresh();
                }
            });
            this.watcher.on('error', () => {
                this.watcher?.close();
                this.watcher = undefined;
            });
        } catch {
            this.watcher = undefined;
        }
    }

    private scheduleRefresh(): void {
        if (this.debounce) {
            clearTimeout(this.debounce);
        }
        this.debounce = setTimeout(() => {
            this.debounce = undefined;
            this.refresh();
        }, DEBOUNCE_MS);
    }

    refresh(): void {
        if (this.disposed) {
            return;
        }
        this.watch();
        let mtimeMs: number;
        try {
            mtimeMs = fs.statSync(this.boardFile).mtimeMs;
        } catch {
            this.board = undefined;
            this.boardChanged.fire(undefined);
            this.lastMtimeMs = -1;
            this.render();
            return;
        }
        if (mtimeMs === this.lastMtimeMs) {
            // Elapsed times still move.
            this.render();
            return;
        }
        this.lastMtimeMs = mtimeMs;
        const previous = this.board;
        const next = hideWorkspaces(readBoard(this.boardFile), hiddenWorkspaces());
        if (!next) {
            return;
        }
        this.board = next;
        this.render();
        this.boardChanged.fire(next);
        this.toast(previous, next);
    }

    private render(): void {
        const config = vscode.workspace.getConfiguration('corgi');
        if (!config.get<boolean>('agentStatusBar', true) || !this.board) {
            this.item.hide();
            return;
        }
        const sessions = liveSessions(this.board);
        if (!sessions.length) {
            this.item.hide();
            return;
        }
        this.item.text = statusBarText(this.board);
        this.item.tooltip = boardTooltip(this.board);
        const needsInput = typeof this.board.needsInput === 'number'
            ? this.board.needsInput
            : sessions.filter((s) => s.status === 'needs_input').length;
        this.item.backgroundColor = undefined;
        this.item.color = needsInput > 0 ? new vscode.ThemeColor("statusBarItem.warningForeground") : undefined;
        this.item.show();
    }

    private toast(previous: Board | undefined, next: Board): void {
        if (!vscode.workspace.getConfiguration('corgi').get<boolean>('agentToasts', true)) {
            return;
        }
        const waiting = newlyNeedingInput(previous, next, this.windowId, this.toasted);
        // Every window reads the same file; only the one in front speaks.
        if (!waiting.length || !vscode.window.state.focused) {
            return;
        }
        for (const s of waiting) {
            const detail = s.pending?.tool ? `wants to run ${s.pending.tool}` : (s.detail || 'waiting for input');
            void vscode.window.showInformationMessage(`${sessionName(s)} needs you: ${detail}`, 'Go').then((choice) => {
                if (choice === 'Go') {
                    void focusSession(s.id);
                }
            });
        }
    }

    dispose(): void {
        this.disposed = true;
        if (this.poll) {
            clearInterval(this.poll);
        }
        if (this.debounce) {
            clearTimeout(this.debounce);
        }
        this.watcher?.close();
        this.item.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

async function corgiAgent(args: string[], failure: string): Promise<boolean> {
    const result = await runCorgi(['agent', ...args]);
    if (!result.ok) {
        const why = (result.stderr || result.stdout).trim().split('\n').pop() ?? '';
        void vscode.window.showWarningMessage(`${failure}${why ? `: ${why}` : ''}`);
    }
    return result.ok;
}

export function focusSession(id: string): Promise<boolean> {
    return corgiAgent(['focus', id], 'corgi could not focus the session');
}

interface SessionPick extends vscode.QuickPickItem {
    session: BoardSession;
}

/** Sessions grouped by workspace, a separator per workspace; needs-input first within each. */
function pickItems(board: Board | undefined, now = new Date()): (SessionPick | vscode.QuickPickItem)[] {
    const groups = new Map<string, BoardSession[]>();
    for (const s of sortForPick(liveSessions(board))) {
        const key = s.label || s.display || '?';
        groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    const out: (SessionPick | vscode.QuickPickItem)[] = [];
    for (const key of [...groups.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
        if (groups.size > 1) {
            out.push({ label: key, kind: vscode.QuickPickItemKind.Separator });
        }
        out.push(...sessionItems(groups.get(key) ?? [], now));
    }
    return out;
}

function sessionItems(sessions: BoardSession[], now: Date): SessionPick[] {
    return sessions.map((s) => {
        const meta: string[] = [statusWord(s.status)];
        if (s.pending?.tool) {
            meta.push(`asks ${s.pending.tool}`);
        }
        if (s.detail) {
            meta.push(s.detail);
        }
        if (typeof s.context?.percent === 'number') {
            meta.push(`ctx ${s.context.percent}%`);
        }
        const elapsed = formatElapsed(s.statusSince, now);
        if (elapsed) {
            meta.push(elapsed);
        }
        const icon = s.status === 'needs_input' ? '$(bell) ' : s.status === 'working' ? '$(pulse) ' : s.status === 'limited' ? '$(warning) ' : s.status === 'done' ? '$(check) ' : '';
        return {
            label: `${icon}${sessionName(s)}`,
            description: meta.join(' — '),
            detail: [s.profile, s.cwd, s.note ? `"${s.note}"` : ''].filter(Boolean).join('  ·  '),
            session: s,
        };
    });
}

export async function pickSession(board: Board | undefined, placeHolder: string): Promise<BoardSession | undefined> {
    const items = pickItems(board);
    if (!items.some((i) => 'session' in i)) {
        void vscode.window.showInformationMessage('corgi agent: no Claude Code sessions on the board.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true, matchOnDetail: true });
    return picked && 'session' in picked ? picked.session : undefined;
}

/** The session to act on without asking: the one in front when it is on the board. */
function frontSession(board: Board | undefined): BoardSession | undefined {
    return liveSessions(board).find((s) => s.id === board?.frontSession);
}

async function terminalForSession(s: BoardSession): Promise<vscode.Terminal | undefined> {
    if (!s.host?.shellPid) {
        return undefined;
    }
    for (const t of vscode.window.terminals) {
        if ((await t.processId) === s.host.shellPid) {
            return t;
        }
    }
    return undefined;
}

/**
 * Talk to the front session: focus it here and press the push-to-talk
 * chord. A terminal session takes Ctrl+Y as a byte; the panel has no
 * command for it, so the user gets told the key.
 */
export async function talkToSession(board: Board | undefined, windowId: string): Promise<void> {
    let s = frontSession(board);
    if (!s || s.host?.windowId !== windowId) {
        s = liveSessions(board).find((x) => x.host?.windowId === windowId && x.status !== 'done')
            ?? await pickSession(board, 'Session to talk to');
    }
    if (!s) {
        return;
    }
    if (s.host?.windowId !== windowId) {
        await focusSession(s.id);
        void vscode.window.showInformationMessage(`${sessionName(s)} is in another window; press its talk key there (Ctrl+Y in a terminal, Cmd+D in the panel).`);
        return;
    }
    if (s.host?.kind === 'vscode-terminal') {
        const terminal = await terminalForSession(s);
        if (!terminal) {
            void vscode.window.showWarningMessage(`${sessionName(s)}: its terminal tab is not in this window any more.`);
            return;
        }
        terminal.show(false);
        terminal.sendText(TALK_CHORD, false);
        return;
    }
    await revealClaudePanel();
    const commands = await vscode.commands.getCommands(true);
    const dictation = commands.find((id) => /^claude[-.]/i.test(id) && /dictat|voice|talk/i.test(id));
    if (dictation) {
        try {
            await vscode.commands.executeCommand(dictation);
            return;
        } catch {
            // Fall through to the hint.
        }
    }
    void vscode.window.showInformationMessage('Press Cmd+D (Ctrl+D) in the Claude Code panel to talk.');
}

/**
 * Registering a tree fails when the window still holds an older manifest of this
 * extension — an in-place upgrade does that until the window is reloaded. One
 * missing view must not take the rest of the board down with it.
 */
export function registerView(id: string, provider: vscode.TreeDataProvider<any>): vscode.Disposable {
    try {
        return vscode.window.registerTreeDataProvider(id, provider);
    } catch (err) {
        console.warn(`corgi: view ${id} is not available in this window (reload to get it back): ${err}`);
        return new vscode.Disposable(() => { });
    }
}

export function registerAgentBoard(context: vscode.ExtensionContext, agentDir: string, windowId: string): AgentBoardWatcher {
    const watcher = new AgentBoardWatcher(agentDir, windowId);
    watcher.start();
    const autoContinue = new AutoContinueWatcher();
    autoContinue.start();
    const watchFixes = new WatchFixesWatcher(agentDir);
    watchFixes.start();
    context.subscriptions.push(watchFixes);
    context.subscriptions.push(autoContinue, watcher.onDidChangeBoard((board) => autoContinue.update(board)));
    // The tracker inbox beside the sessions: tickets, reviews and red builds
    // the watch has seen and nobody has dealt with.
    const inbox = new WatchInboxTree();
    context.subscriptions.push(inbox, inbox.start(), registerView('corgiWatchInbox', inbox));
    const tree = new AgentSessionsTree(watcher);
    const sessionOf = (node: AgentNode | undefined): BoardSession | undefined => (node?.kind === 'session' ? node.session : undefined);
    const setHidden = (list: string[]) => vscode.workspace.getConfiguration('corgi').update('agent.hiddenWorkspaces', list, vscode.ConfigurationTarget.Global);
    context.subscriptions.push(
        watcher,
        tree,
        registerView('corgiAgentSessions', tree),
        vscode.commands.registerCommand('corgi.agent.focusNode', async (node: AgentNode) => {
            const s = sessionOf(node);
            if (s) {
                await focusSession(s.id);
            }
        }),
        vscode.commands.registerCommand('corgi.agent.interrupt', async (node: AgentNode) => {
            const s = sessionOf(node) ?? await pickSession(watcher.current(), 'Session to interrupt (Escape: the turn stops, the session waits)');
            if (s) {
                await corgiAgent(['interrupt', s.id], 'corgi could not interrupt the session');
            }
        }),
        vscode.commands.registerCommand('corgi.agent.dismiss', async (node: AgentNode) => {
            const s = sessionOf(node) ?? await pickSession(watcher.current(), 'Session to take off the board');
            if (s) {
                await corgiAgent(['dismiss', s.id], 'corgi could not dismiss the session');
            }
        }),
        vscode.commands.registerCommand('corgi.agent.note', async (node: AgentNode) => {
            const s = sessionOf(node) ?? await pickSession(watcher.current(), 'Session to put a note on');
            if (!s) {
                return;
            }
            const note = await vscode.window.showInputBox({ prompt: `Note under ${sessionName(s)} (empty clears it)`, value: s.note ?? '' });
            if (note === undefined) {
                return;
            }
            await corgiAgent(note.trim() ? ['note', s.id, note.trim()] : ['note', s.id, '--clear'], 'corgi could not set the note');
        }),
        vscode.commands.registerCommand('corgi.agent.answer', async (node: AgentNode, answer: 'allow' | 'deny' = 'allow') => {
            const s = sessionOf(node);
            if (s) {
                await corgiAgent(['answer', s.id, answer], 'corgi could not answer the prompt');
            }
        }),
        vscode.commands.registerCommand('corgi.agent.deny', async (node: AgentNode) => {
            await vscode.commands.executeCommand('corgi.agent.answer', node, 'deny');
        }),
        vscode.commands.registerCommand('corgi.agent.sessions', async () => {
            watcher.refresh();
            const s = await pickSession(watcher.current(), 'Claude Code session to bring forward');
            if (s) {
                await focusSession(s.id);
            }
        }),
        vscode.commands.registerCommand('corgi.agent.new', async () => {
            await corgiAgent(['new', '--window', windowId, ...isolateArgs()], 'corgi could not start a session');
        }),
        vscode.commands.registerCommand('corgi.agent.newIsolated', async () => {
            await corgiAgent(['new', '--window', windowId, '--isolate'], 'corgi could not start a session');
        }),
        // A bot: its workspace, its persona, its last conversation resumed.
        vscode.commands.registerCommand('corgi.agent.openBot', async () => {
            const bots = readBots(agentDir);
            if (!bots.length) {
                void vscode.window.showInformationMessage('No bots yet: corgi agent bot add reviewer --workspace api --soul "You review pull requests."');
                return;
            }
            const pick = await vscode.window.showQuickPick(
                bots.map((b) => ({ label: botTitle(b), description: [b.workspace, b.model, b.profile, b.isolate ? 'own worktree' : '', b.lastSession ? 'resumes' : ''].filter(Boolean).join(' · '), bot: b })),
                { placeHolder: 'Open a bot in this window' },
            );
            if (pick) {
                await corgiAgent(['bot', 'open', pick.bot.name, '--window', windowId], `corgi could not open ${pick.label}`);
            }
        }),
        // The chief: one question about the board, a few lines back.
        vscode.commands.registerCommand('corgi.agent.ask', async () => {
            const question = await vscode.window.showInputBox({ prompt: 'Ask the chief about the board', placeHolder: 'what should I look at first?', ignoreFocusOut: true });
            if (!question?.trim()) {
                return;
            }
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'corgi: asking the chief…' }, async () => {
                const r = await runCorgi(['agent', 'ask', question.trim()]);
                if (!r.ok) {
                    void vscode.window.showWarningMessage(`corgi could not ask: ${(r.stderr || r.stdout).trim()}`);
                    return;
                }
                const answer = r.stdout.trim();
                const choice = await vscode.window.showInformationMessage(answer, { modal: true, detail: question.trim() }, 'Copy');
                if (choice === 'Copy') {
                    await vscode.env.clipboard.writeText(answer);
                }
            });
        }),
        vscode.commands.registerCommand('corgi.agent.next', async () => {
            watcher.refresh();
            const s = nextSession(watcher.current());
            if (!s) {
                void vscode.window.showInformationMessage('corgi agent: nothing is waiting.');
                return;
            }
            await focusSession(s.id);
        }),
        vscode.commands.registerCommand('corgi.agent.send', async () => {
            watcher.refresh();
            const board = watcher.current();
            const s = frontSession(board) ?? await pickSession(board, 'Session to send to');
            if (!s) {
                return;
            }
            const text = await vscode.window.showInputBox({
                prompt: `Send to ${sessionName(s)}`,
                placeHolder: 'Typed into the session and sent with Enter',
                ignoreFocusOut: true,
            });
            if (!text?.trim()) {
                return;
            }
            await corgiAgent(['send', s.id, '--enter', '--', text], `corgi could not type into ${sessionName(s)}`);
        }),
        vscode.commands.registerCommand('corgi.agent.talk', async () => {
            watcher.refresh();
            await talkToSession(watcher.current(), windowId);
        }),
        // The reload button is a real reload: the daemon rescans and polls
        // every tracker now; this view, the phone and the menu bar all re-read.
        vscode.commands.registerCommand('corgi.agent.refresh', async () => {
            await corgiAgent(['refresh'], 'corgi could not refresh');
            setTimeout(() => {
                watcher.refresh();
                void vscode.commands.executeCommand('corgi.agent.inboxRefresh', { quiet: true });
            }, 1500);
        }),
        vscode.commands.registerCommand('corgi.agent.sendTo', async (node: AgentNode) => {
            const s = sessionOf(node) ?? await pickSession(watcher.current(), 'Session to send to');
            if (!s) {
                return;
            }
            const text = await vscode.window.showInputBox({ prompt: `Send to ${sessionName(s)}`, placeHolder: 'Typed into the session and sent with Enter', ignoreFocusOut: true });
            if (!text?.trim()) {
                return;
            }
            await corgiAgent(['send', s.id, '--enter', '--', text], `corgi could not type into ${sessionName(s)}`);
        }),
        vscode.commands.registerCommand('corgi.agent.always', async (node: AgentNode) => {
            const s = sessionOf(node);
            if (s) {
                await corgiAgent(['answer', s.id, 'always'], 'corgi could not answer the prompt');
            }
        }),
        // The way out of a drift: a clean session started from a handoff, same account.
        vscode.commands.registerCommand('corgi.agent.fresh', async (node: AgentNode) => {
            const s = sessionOf(node) ?? await pickSession(watcher.current(), 'Session to restart clean from a handoff');
            if (!s) {
                return;
            }
            const why = (s.drift ?? []).join('\n');
            const ok = await vscode.window.showWarningMessage(`Restart ${sessionName(s)} clean from a handoff?`, { modal: true, detail: why || 'It leaves a handoff first.' }, 'Fresh');
            if (ok === 'Fresh') {
                await corgiAgent(['carry', s.id, '--fresh'], 'corgi could not restart it');
            }
        }),
        vscode.commands.registerCommand('corgi.agent.openPr', async (node: AgentNode) => {
            const s = sessionOf(node);
            if (s?.pr && /^https:\/\//.test(s.pr)) {
                await vscode.env.openExternal(vscode.Uri.parse(s.pr));
            }
        }),
        vscode.commands.registerCommand('corgi.agent.copyId', async (node: AgentNode) => {
            const s = sessionOf(node);
            if (s) {
                await vscode.env.clipboard.writeText(s.id);
            }
        }),
        // Hidden workspaces: for showing the editor to someone. A group's
        // sessions, its inbox and its runs leave the views; nothing on the
        // machine changes.
        vscode.commands.registerCommand('corgi.agent.hideWorkspace', async (node?: AgentNode) => {
            const name = node?.kind === 'group' ? node.label : await vscode.window.showInputBox({ prompt: 'Workspace to hide (its id or session label)' });
            if (!name?.trim()) {
                return;
            }
            const cur = hiddenWorkspaces();
            if (!cur.includes(name.trim())) {
                await setHidden([...cur, name.trim()]);
            }
        }),
        vscode.commands.registerCommand('corgi.agent.hiddenWorkspaces', async () => {
            const cur = hiddenWorkspaces();
            if (!cur.length) {
                void vscode.window.showInformationMessage('corgi agent: no hidden workspaces. Right-click a workspace in the sessions view to hide it.');
                return;
            }
            const picked = await vscode.window.showQuickPick(cur.map((w) => ({ label: w, picked: true })), { canPickMany: true, placeHolder: 'Hidden workspaces — uncheck to show again' });
            if (picked) {
                await setHidden(picked.map((p) => p.label));
            }
        }),
    );
    return watcher;
}

/** The workspaces tucked away in this editor, from settings. */
export function hiddenWorkspaces(): string[] {
    const list = vscode.workspace.getConfiguration('corgi').get<string[]>('agent.hiddenWorkspaces', []);
    return Array.isArray(list) ? list.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim()) : [];
}
