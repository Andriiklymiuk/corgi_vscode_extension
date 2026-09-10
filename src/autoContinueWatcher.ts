import * as vscode from 'vscode';
import { Board } from './agentBoard';
import {
    AutoContinueSettings, PendingContinue, autoContinueDefaults, dueNow, planContinues, queueTooltip, statusText, waitLabel,
} from './autoContinue';
import { runCorgi } from './corgiExec';

const TICK_MS = 30000;

export function readAutoContinueSettings(): AutoContinueSettings {
    const c = vscode.workspace.getConfiguration('corgi');
    const message = (c.get<string>('autoContinue.message') ?? autoContinueDefaults.message).trim();
    return {
        enabled: c.get<boolean>('autoContinue.enabled') ?? autoContinueDefaults.enabled,
        message: message || autoContinueDefaults.message,
        graceSeconds: c.get<number>('autoContinue.graceSeconds') ?? autoContinueDefaults.graceSeconds,
    };
}

/**
 * Watches the board for sessions stopped on a usage limit and types one
 * message into each when its window resets. Off unless asked for. Every
 * queued send is visible in the status bar and can be cancelled from there,
 * because a session nobody wants resumed must not resume itself.
 */
export class AutoContinueWatcher implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly item: vscode.StatusBarItem;
    private readonly cancelled = new Set<string>();
    private readonly sent = new Set<string>();
    private timer: NodeJS.Timeout | undefined;
    private board: Board | undefined;
    private pending: PendingContinue[] = [];
    private settings = readAutoContinueSettings();

    constructor() {
        this.item = vscode.window.createStatusBarItem('corgi.autoContinue', vscode.StatusBarAlignment.Left, 49);
        this.item.name = 'Corgi auto-continue';
        this.item.command = 'corgi.agent.autoContinue';
    }

    start(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('corgi.autoContinue')) {
                    this.settings = readAutoContinueSettings();
                    this.render();
                }
            }),
            vscode.commands.registerCommand('corgi.agent.autoContinue', () => this.showQueue()),
        );
        this.timer = setInterval(() => void this.tick(), TICK_MS);
        this.render();
    }

    /** Called on every board publish by the board watcher. */
    update(board: Board | undefined): void {
        this.board = board;
        // A session that is no longer limited gets a clean slate: its next
        // limit is a new wait, not the one someone cancelled hours ago.
        const stillLimited = new Set(planContinues(board, new Set()).map((p) => p.sessionId));
        for (const id of [...this.cancelled]) {
            if (!stillLimited.has(id)) {
                this.cancelled.delete(id);
            }
        }
        for (const id of [...this.sent]) {
            if (!stillLimited.has(id)) {
                this.sent.delete(id);
            }
        }
        this.render();
        void this.tick();
    }

    private render(): void {
        this.pending = planContinues(this.board, this.cancelled).filter((p) => !this.sent.has(p.sessionId));
        const now = Date.now();
        const text = this.settings.enabled ? statusText(this.pending, now) : undefined;
        if (!text) {
            this.item.hide();
            return;
        }
        this.item.text = text;
        this.item.tooltip = queueTooltip(this.pending, now, this.settings);
        this.item.show();
    }

    private async tick(): Promise<void> {
        if (!this.settings.enabled) {
            return;
        }
        const due = dueNow(this.pending, Date.now(), this.settings.graceSeconds);
        for (const p of due) {
            if (this.sent.has(p.sessionId)) {
                continue;
            }
            this.sent.add(p.sessionId);
            const result = await runCorgi(['agent', 'send', p.sessionId, '--enter', '--', this.settings.message]);
            if (result.ok) {
                void vscode.window.showInformationMessage(`corgi: resumed ${p.name} — its ${p.window} limit reset`);
            } else {
                this.sent.delete(p.sessionId);
                void vscode.window.showWarningMessage(`corgi could not resume ${p.name}: ${result.stderr || result.stdout}`);
            }
        }
        this.render();
    }

    private async showQueue(): Promise<void> {
        if (!this.settings.enabled) {
            const turnOn = 'Turn on';
            const answer = await vscode.window.showInformationMessage(
                'Auto-continue is off. Sessions stopped on a usage limit stay stopped.', turnOn);
            if (answer === turnOn) {
                await vscode.workspace.getConfiguration('corgi').update('autoContinue.enabled', true, vscode.ConfigurationTarget.Global);
            }
            return;
        }
        if (this.pending.length === 0) {
            void vscode.window.showInformationMessage('Auto-continue is on. Nothing is waiting on a limit.');
            return;
        }
        const now = Date.now();
        const rows: (vscode.QuickPickItem & { id?: string; all?: boolean; off?: boolean })[] = this.pending.map((p) => ({
            label: `$(close) ${p.name}`,
            description: `${p.window} window · ${waitLabel(p, now)}`,
            detail: `Will send ${JSON.stringify(this.settings.message)}. Pick to cancel this one.`,
            id: p.sessionId,
        }));
        rows.push({ label: '$(clear-all) Cancel all', all: true });
        rows.push({ label: '$(circle-slash) Turn auto-continue off', off: true });

        const picked = await vscode.window.showQuickPick(rows, { title: 'Auto-continue when limits reset', placeHolder: 'Pick one to cancel it' });
        if (!picked) {
            return;
        }
        if (picked.off) {
            await vscode.workspace.getConfiguration('corgi').update('autoContinue.enabled', false, vscode.ConfigurationTarget.Global);
            return;
        }
        if (picked.all) {
            for (const p of this.pending) {
                this.cancelled.add(p.sessionId);
            }
        } else if (picked.id) {
            this.cancelled.add(picked.id);
        }
        this.render();
    }

    dispose(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }
        this.item.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
    }
}
