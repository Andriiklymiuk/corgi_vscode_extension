import * as vscode from 'vscode';
import { isHiddenWorkspace } from './agentBoard';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    FixRecord, elapsed, fixName, fixesPath, outcome, pullRequests, readFixes, recent, running, statusText, tooltip,
} from './watchFixes';

const POLL_MS = 5000;

/**
 * Shows what `corgi agent watch --auto` is doing. A fix runs headless for
 * minutes and only speaks when it is over, so without this the editor gives
 * no sign that anything is happening on your behalf. A long run also gets a
 * progress notification, because a spinner in the status bar is easy to miss
 * and a fix can touch the files you are looking at.
 */
export class WatchFixesWatcher implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly item: vscode.StatusBarItem;
    private watcher: fs.FSWatcher | undefined;
    private timer: NodeJS.Timeout | undefined;
    private fixes: FixRecord[] = [];
    private readonly announced = new Set<string>();
    private disposed = false;

    constructor(private readonly agentDir: string) {
        this.item = vscode.window.createStatusBarItem('corgi.watchFixes', vscode.StatusBarAlignment.Left, 48);
        this.item.name = 'Corgi watch fixes';
        this.item.command = 'corgi.agent.watchFixes';
    }

    start(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('corgi.watchFixes')) {
                    this.render();
                }
            }),
            vscode.commands.registerCommand('corgi.agent.watchFixes', () => this.show()),
        );
        this.timer = setInterval(() => this.refresh(), POLL_MS);
        this.watch();
        this.refresh();
    }

    private enabled(): boolean {
        return vscode.workspace.getConfiguration('corgi').get<boolean>('watchFixes.statusBar', true);
    }

    // corgi writes fixes.json by rename, so the directory sees the change;
    // watching the file would hold a dead inode.
    private watch(): void {
        if (this.watcher || this.disposed) {
            return;
        }
        const dir = path.dirname(fixesPath(this.agentDir));
        try {
            this.watcher = fs.watch(dir, () => this.refresh());
            this.watcher.on('error', () => {
                this.watcher?.close();
                this.watcher = undefined;
            });
        } catch {
            this.watcher = undefined; // the poll is the fallback
        }
    }

    private refresh(): void {
        if (this.disposed) {
            return;
        }
        this.watch();
        const hidden = vscode.workspace.getConfiguration('corgi').get<string[]>('agent.hiddenWorkspaces', []) ?? [];
        this.fixes = readFixes(fixesPath(this.agentDir)).filter((r) => !isHiddenWorkspace(r.workspace, hidden));
        this.render();
        this.announce();
    }

    private render(): void {
        const text = this.enabled() ? statusText(this.fixes, Date.now()) : undefined;
        if (!text) {
            this.item.hide();
            return;
        }
        this.item.text = text;
        this.item.tooltip = tooltip(this.fixes, Date.now());
        this.item.show();
    }

    /** One progress notification per run, so a long fix is impossible to miss. */
    private announce(): void {
        if (!vscode.workspace.getConfiguration('corgi').get<boolean>('watchFixes.progress', true)) {
            return;
        }
        for (const fix of running(this.fixes)) {
            if (this.announced.has(fix.key)) {
                continue;
            }
            this.announced.add(fix.key);
            void this.follow(fix);
        }
    }

    private follow(fix: FixRecord): Thenable<void> {
        return vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `corgi is working on ${fixName(fix)}`, cancellable: false },
            async (progress) => {
                for (;;) {
                    if (this.disposed) {
                        return;
                    }
                    const now = readFixes(fixesPath(this.agentDir)).find((r) => r.key === fix.key);
                    if (!now || !running([now]).length) {
                        const done = now ?? fix;
                        const first = done.prs?.[0];
                        if (done.error) {
                            void vscode.window.showWarningMessage(`corgi: ${fixName(done)} — ${done.error}`);
                        } else if (first) {
                            const open = 'Open';
                            const answer = await vscode.window.showInformationMessage(
                                `corgi opened a pull request for ${fixName(done)}`, open);
                            if (answer === open) {
                                void vscode.env.openExternal(vscode.Uri.parse(first));
                            }
                        }
                        return;
                    }
                    progress.report({ message: elapsed(now, Date.now()) });
                    await new Promise((r) => setTimeout(r, POLL_MS));
                }
            },
        );
    }

    private async show(): Promise<void> {
        const now = Date.now();
        const live = running(this.fixes);
        const done = recent(this.fixes, now);
        if (!live.length && !done.length) {
            void vscode.window.showInformationMessage(
                'corgi agent watch has not worked on anything. `corgi agent watch enable --auto` turns that on.');
            return;
        }
        const rows: (vscode.QuickPickItem & { url?: string })[] = [];
        for (const r of live) {
            rows.push({ label: `$(sync~spin) ${fixName(r)}`, description: `running ${elapsed(r, now)}`, detail: r.title });
        }
        for (const r of done) {
            const icon = r.error ? '$(warning)' : r.prs?.length ? '$(git-pull-request)' : '$(check)';
            rows.push({
                label: `${icon} ${fixName(r)}`,
                description: `${outcome(r)} · ${elapsed(r, now)}`,
                detail: r.prs?.[0] ?? r.url,
                url: r.prs?.[0] ?? r.url,
            });
        }
        const picked = await vscode.window.showQuickPick(rows, {
            title: 'corgi agent watch — worked on for you',
            placeHolder: pullRequests(this.fixes, now).length ? 'Pick one to open its pull request' : 'What the watch has done',
        });
        if (picked?.url) {
            void vscode.env.openExternal(vscode.Uri.parse(picked.url));
        }
    }

    dispose(): void {
        this.disposed = true;
        if (this.timer) {
            clearInterval(this.timer);
        }
        this.watcher?.close();
        this.item.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
    }
}
