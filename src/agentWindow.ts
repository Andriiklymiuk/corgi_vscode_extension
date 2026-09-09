import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { matchTabByTitle } from './agentBoard';

/**
 * Session tracking companion for `corgi agent track`.
 *
 * corgi's daemon knows which Claude Code sessions are running and what they
 * are doing, but nothing outside a VS Code window can reveal a specific
 * terminal tab in it. This module is the piece that runs inside the window:
 *
 *  1. It injects CORGI_VSCODE_WINDOW into every integrated terminal, so a
 *     `claude` started there tells the daemon exactly which window it is in.
 *  2. It writes a window record (extension-host pid, folders, terminals and
 *     their shell pids) to <agent dir>/windows/<id>.json whenever a terminal
 *     opens or closes, so the daemon can join a session to its tab — or, for
 *     the Claude Code panel, to this window through the extension-host pid.
 *  3. It watches <agent dir>/reveal/<id>.json for the daemon's "show this
 *     tab" request and calls terminal.show() on the right terminal.
 *
 * Everything is a file under corgi's owner-only agent directory: no port, no
 * token. It does nothing at all unless corgi's agent directory exists, so a
 * machine that never ran `corgi agent` sees no files appear.
 */

interface WindowRecord {
    id: string;
    app: string;
    extHostPid: number;
    folders: string[];
    terminals: { name: string; shellPid: number }[];
    /** When this window last came to the front, and the shell of its active terminal tab. */
    focusedAt?: string;
    activeShellPid?: number;
    /** True while the Claude Code panel is the active editor tab, and how many Claude Code tabs are open. */
    panelActive?: boolean;
    claudeTabs?: number;
    updatedAt: string;
}

interface RevealRequest {
    windowId: string;
    sessionId?: string;
    shellPid?: number;
    panel?: boolean;
    /** Open a fresh terminal in folder and run claude: the deck's "+" key. */
    new?: boolean;
    folder?: string;
    /** What that terminal runs (corgi agent claude, which picks the folder's account); else the claudeCommand setting. */
    command?: string;
    /** Type text into the session's terminal after showing it (`corgi agent send`); enter adds Return. */
    text?: string;
    enter?: boolean;
    /** Which Claude Code chat tab to bring up when the window has several; the tab label. */
    title?: string;
}

/** Where corgi keeps agent-mode state: the same rules as corgi's NativeDataDir. */
export function corgiAgentDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): string {
    const override = (env.CORGI_DATA_DIR || '').trim();
    if (override) {
        return path.join(override, 'agent');
    }
    switch (platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'corgi', 'agent');
        case 'win32':
            return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'corgi', 'agent');
        default: {
            const xdg = (env.XDG_DATA_HOME || '').trim();
            return path.join(xdg || path.join(home, '.local', 'share'), 'corgi', 'agent');
        }
    }
}

/** A window id as a file name. VS Code's ids are plain, but they are data from elsewhere. */
export function safeFileName(id: string): string {
    return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Candidate command ids that reveal the Claude Code extension's panel, tried in order. */
export const claudePanelCommands = [
    'claude-vscode.focus',
    'claude-vscode.open',
    'claude-code.focus',
    'workbench.view.extension.claude-code',
];

/**
 * A window id that survives a restart. The environment variable collection
 * is persistent: VS Code applies last run's value to the terminals it
 * restores before this extension activates. An id that changed every launch
 * would leave those terminals pointing at a window that no longer exists,
 * so the id lives in workspaceState and is reused. An empty window has no
 * workspace of its own to remember it in and falls back to the launch id.
 */
export function stableWindowId(context: vscode.ExtensionContext): string {
    if (!(vscode.workspace.workspaceFolders ?? []).length) {
        return vscode.env.sessionId;
    }
    const key = 'corgi.windowId';
    const saved = context.workspaceState.get<string>(key);
    if (saved) {
        return saved;
    }
    const id = 'w-' + randomUUID();
    void context.workspaceState.update(key, id);
    return id;
}

/** VS Code's setting that decides whether an OSC title reaches the tab. */
const TAB_TITLE_SETTING = 'terminal.integrated.tabs.title';
const TAB_TITLE_ASKED = 'corgi.tabTitleAsked';

/**
 * corgi's tab-title hook writes "▲ repo NEEDS YOU" as the terminal title,
 * but VS Code's default tab title is ${process} — the word "claude". Offer
 * ${sequence} once, only when corgi agent mode is in use, and remember the
 * answer either way.
 */
export async function offerTabTitles(context: vscode.ExtensionContext): Promise<void> {
    if (context.globalState.get<boolean>(TAB_TITLE_ASKED)) {
        return;
    }
    const config = vscode.workspace.getConfiguration();
    const inspected = config.inspect<string>(TAB_TITLE_SETTING);
    if (inspected?.globalValue !== undefined || inspected?.workspaceValue !== undefined) {
        await context.globalState.update(TAB_TITLE_ASKED, true);
        return;
    }
    const choice = await vscode.window.showInformationMessage(
        'corgi can show each Claude Code session\'s status in its terminal tab (● repo, ▲ repo NEEDS YOU). ' +
        'That needs the tab title set to ${sequence}.',
        'Show status in tabs', 'Not now',
    );
    await context.globalState.update(TAB_TITLE_ASKED, true);
    if (choice === 'Show status in tabs') {
        await config.update(TAB_TITLE_SETTING, '${sequence}', vscode.ConfigurationTarget.Global);
    }
}

export class AgentWindow implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly agentDir: string;
    private readonly windowId: string;
    private reportTimer: NodeJS.Timeout | undefined;
    private revealWatcher: fs.FSWatcher | undefined;
    private disposed = false;
    private focusedAt: string | undefined;

    constructor(private readonly context: vscode.ExtensionContext, agentDir?: string) {
        this.agentDir = agentDir ?? corgiAgentDir();
        this.windowId = stableWindowId(context);
    }

    get windowFile(): string {
        return path.join(this.agentDir, 'windows', safeFileName(this.windowId) + '.json');
    }

    get revealFile(): string {
        return path.join(this.agentDir, 'reveal', safeFileName(this.windowId) + '.json');
    }

    start(): void {
        // The env var costs nothing and must be there before the first
        // terminal opens, whether or not corgi is installed yet.
        this.context.environmentVariableCollection.replace('CORGI_VSCODE_WINDOW', this.windowId);
        this.context.environmentVariableCollection.description = 'corgi: lets `corgi agent focus` find this window';

        if (vscode.window.state.focused) {
            this.focusedAt = new Date().toISOString();
        }
        this.disposables.push(
            vscode.window.onDidOpenTerminal(() => this.scheduleReport()),
            vscode.window.onDidCloseTerminal(() => this.scheduleReport()),
            vscode.window.onDidChangeActiveTerminal(() => this.scheduleReport()),
            vscode.window.tabGroups.onDidChangeTabs(() => this.scheduleReport()),
            vscode.window.tabGroups.onDidChangeTabGroups(() => this.scheduleReport()),
            vscode.window.onDidChangeWindowState((state) => {
                if (state.focused) {
                    this.focusedAt = new Date().toISOString();
                    this.scheduleReport();
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleReport()),
        );
        this.scheduleReport();
        this.watchReveal();
    }

    /** True when corgi agent mode has ever run here; otherwise this stays silent. */
    private corgiPresent(): boolean {
        try {
            return fs.statSync(this.agentDir).isDirectory();
        } catch {
            return false;
        }
    }

    private scheduleReport(): void {
        if (this.reportTimer) {
            clearTimeout(this.reportTimer);
        }
        // Terminals open in bursts (a restored window brings back several);
        // one record per burst, and processId needs a moment anyway.
        this.reportTimer = setTimeout(() => {
            this.reportTimer = undefined;
            void this.report();
        }, 200);
    }

    async report(): Promise<void> {
        if (this.disposed || !this.corgiPresent()) {
            return;
        }
        const record = await this.buildRecord();
        try {
            fs.mkdirSync(path.dirname(this.windowFile), { recursive: true, mode: 0o700 });
            const tmp = this.windowFile + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
            fs.renameSync(tmp, this.windowFile);
        } catch {
            return;
        }
        this.nudgeDaemon();
        // A reveal watcher could not be armed before the directory existed.
        this.watchReveal();
        void offerTabTitles(this.context);
    }

    async buildRecord(): Promise<WindowRecord> {
        const terminals: WindowRecord['terminals'] = [];
        for (const t of vscode.window.terminals) {
            const pid = await t.processId;
            if (pid) {
                terminals.push({ name: t.name, shellPid: pid });
            }
        }
        const activeShellPid = await vscode.window.activeTerminal?.processId;
        return {
            id: this.windowId,
            app: vscode.env.appName,
            extHostPid: process.pid,
            folders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
            terminals,
            focusedAt: this.focusedAt,
            activeShellPid: activeShellPid || undefined,
            panelActive: claudePanelActive() || undefined,
            claudeTabs: claudeTabCount(),
            updatedAt: new Date().toISOString(),
        };
    }

    /** SIGUSR1 is the daemon's doorbell; it only rings a daemon that advertised it. */
    private nudgeDaemon(): void {
        if (process.platform === 'win32') {
            return;
        }
        try {
            const info = JSON.parse(fs.readFileSync(path.join(this.agentDir, 'daemon.json'), 'utf8'));
            if (info && typeof info.pid === 'number' && info.pid > 0 && info.commands === true) {
                process.kill(info.pid, 'SIGUSR1');
            }
        } catch {
            // No daemon, or it is gone: the next drain tick reads the file.
        }
    }

    private watchReveal(): void {
        if (this.revealWatcher || this.disposed || !this.corgiPresent()) {
            return;
        }
        const dir = path.dirname(this.revealFile);
        try {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            this.revealWatcher = fs.watch(dir, (_event, filename) => {
                // Some platforms report no filename; then any change in the
                // directory is worth a look (the read is a no-op when the
                // request is not ours).
                if (!filename || filename.toString() === path.basename(this.revealFile)) {
                    void this.handleReveal();
                }
            });
            this.revealWatcher.on('error', () => {
                this.revealWatcher?.close();
                this.revealWatcher = undefined;
            });
        } catch {
            this.revealWatcher = undefined;
        }
        // A request that arrived before the watcher did.
        void this.handleReveal();
    }

    async handleReveal(): Promise<void> {
        let request: RevealRequest;
        try {
            request = JSON.parse(fs.readFileSync(this.revealFile, 'utf8'));
            fs.unlinkSync(this.revealFile);
        } catch {
            return;
        }
        if (request?.windowId !== this.windowId) {
            return;
        }
        await this.reveal(request);
    }

    async reveal(request: RevealRequest): Promise<void> {
        if (request.new) {
            this.openClaudeTerminal(request.folder, request.command);
            return;
        }
        if (request.panel) {
            if (request.title && await activateClaudeTab(request.title)) {
                return;
            }
            await revealClaudePanel();
            return;
        }
        if (request.shellPid) {
            for (const t of vscode.window.terminals) {
                if ((await t.processId) === request.shellPid) {
                    t.show(false);
                    if (request.text) {
                        typeIntoTerminal(t, request.text, request.enter === true);
                    }
                    return;
                }
            }
        }
        // The tab is gone or unknown: at least bring the terminal area up.
        // Text never goes anywhere but the terminal it was meant for.
        await vscode.commands.executeCommand('workbench.action.terminal.focus');
    }

    /**
     * A new integrated terminal running claude, in the folder the daemon
     * named (one this window reported open) or the first workspace folder.
     * The terminal opening reports the window again, and the session's own
     * first hook seats it on a key.
     */
    openClaudeTerminal(folder?: string, command?: string): void {
        const cwd = folder || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        command = command?.trim() || vscode.workspace.getConfiguration('corgi').get<string>('claudeCommand', 'claude').trim() || 'claude';
        const terminal = vscode.window.createTerminal({ name: 'claude', cwd });
        terminal.show(false);
        terminal.sendText(command, true);
    }

    dispose(): void {
        this.disposed = true;
        if (this.reportTimer) {
            clearTimeout(this.reportTimer);
        }
        this.revealWatcher?.close();
        for (const d of this.disposables) {
            d.dispose();
        }
        try {
            fs.unlinkSync(this.windowFile);
            this.nudgeDaemon();
        } catch {
            // Never written, or already gone.
        }
    }
}

/**
 * Keystrokes for the TUI in a terminal, never a shell command. sendText
 * arrives as a bracketed paste, inside which a carriage return is a newline
 * in the input box, not a submit: so the text goes as a paste and Enter goes
 * afterwards as a raw key sequence to the terminal just shown.
 */
export function typeIntoTerminal(terminal: vscode.Terminal, text: string, enter: boolean): void {
    terminal.sendText(text, false);
    if (enter) {
        setTimeout(() => {
            void vscode.commands.executeCommand('workbench.action.terminal.sendSequence', { text: '\r' });
        }, 120);
    }
}

/** Open Claude Code chat tabs with where they sit: group index (tabGroups.all order) and tab index within it. */
export function claudeTabs(): { label: string; groupIndex: number; tabIndex: number; group: vscode.TabGroup; tab: vscode.Tab }[] {
    const out: { label: string; groupIndex: number; tabIndex: number; group: vscode.TabGroup; tab: vscode.Tab }[] = [];
    vscode.window.tabGroups.all.forEach((group, groupIndex) => {
        group.tabs.forEach((tab, tabIndex) => {
            if (isClaudeTab(tab)) {
                out.push({ label: tab.label, groupIndex, tabIndex, group, tab });
            }
        });
    });
    return out;
}

/** VS Code's focus-group commands are named, not numbered; index in tabGroups.all order. */
export const focusGroupCommands = [
    'workbench.action.focusFirstEditorGroup',
    'workbench.action.focusSecondEditorGroup',
    'workbench.action.focusThirdEditorGroup',
    'workbench.action.focusFourthEditorGroup',
    'workbench.action.focusFifthEditorGroup',
    'workbench.action.focusSixthEditorGroup',
    'workbench.action.focusSeventhEditorGroup',
    'workbench.action.focusEighthEditorGroup',
];

/**
 * Brings the chat tab whose label is title to the front: focus its editor
 * group, then open the editor at its index there. There is no tab API for
 * this, so it goes through the workbench commands; false when no tab
 * matches or the commands are not there.
 */
export async function activateClaudeTab(title: string): Promise<boolean> {
    const match = matchTabByTitle(claudeTabs(), title);
    if (!match) {
        return false;
    }
    if (match.tab.isActive && match.group.isActive) {
        return true;
    }
    const focusGroup = focusGroupCommands[match.groupIndex];
    if (!focusGroup) {
        return false;
    }
    try {
        await vscode.commands.executeCommand(focusGroup);
        await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', match.tabIndex);
    } catch {
        return false;
    }
    // Not the generic panel-focus command here: with several chat tabs open
    // that is what picked the wrong one.
    return true;
}

/** The Claude Code panel is the active editor tab (its webview id is claudeVSCodePanel). */
function claudePanelActive(): boolean {
    return isClaudeTab(vscode.window.tabGroups.activeTabGroup.activeTab);
}

/**
 * Open Claude Code chat tabs across every editor group. The side bar view is
 * not a tab, so when Claude Code is set to live there the count would be a
 * lie; undefined then, and corgi drops nothing.
 */
function claudeTabCount(): number | undefined {
    if (vscode.workspace.getConfiguration('claudeCode').get<string>('preferredLocation') === 'sidebar') {
        return undefined;
    }
    let n = 0;
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (isClaudeTab(tab)) {
                n++;
            }
        }
    }
    return n;
}

function isClaudeTab(tab: vscode.Tab | undefined): boolean {
    const input = tab?.input;
    return input instanceof vscode.TabInputWebview && /claude/i.test(input.viewType);
}

/**
 * Picks the command that focuses the Claude Code panel out of the commands
 * actually registered: the configured id, then the known candidates, then
 * any claude-* command whose name says "focus" ("Claude Code: Focus input"
 * is the palette entry the docs name, bound to Cmd+Esc).
 */
export function pickClaudePanelCommand(available: Iterable<string>, configured: string): string | undefined {
    const ids = new Set(available);
    for (const id of [configured.trim(), ...claudePanelCommands]) {
        if (id && ids.has(id)) {
            return id;
        }
    }
    const claude = [...ids].filter((id) => /^claude[-.]/i.test(id));
    return claude.find((id) => /focus.?input/i.test(id)) ?? claude.find((id) => /focus/i.test(id)) ?? claude.find((id) => /open/i.test(id));
}

/** Brings the Claude Code extension's panel forward. */
export async function revealClaudePanel(): Promise<boolean> {
    const configured = vscode.workspace.getConfiguration('corgi').get<string>('claudePanelCommand', '');
    const id = pickClaudePanelCommand(await vscode.commands.getCommands(true), configured);
    if (!id) {
        return false;
    }
    try {
        await vscode.commands.executeCommand(id);
        return true;
    } catch {
        return false;
    }
}

export function registerAgentWindow(context: vscode.ExtensionContext): void {
    if (!vscode.workspace.getConfiguration('corgi').get<boolean>('sessionTracking', true)) {
        context.environmentVariableCollection.clear();
        return;
    }
    const window = new AgentWindow(context);
    window.start();
    context.subscriptions.push(window);
}
