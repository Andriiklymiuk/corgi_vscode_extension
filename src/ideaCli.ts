import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CorgiResult, runCorgi } from './corgiExec';
import { authorName, changedMarker, ideasDir } from './idea';

/**
 * What the idea panel and the comment threads share: the author for --by,
 * the `corgi idea … --json` call, and the watcher on the idea files.
 */

/** The agent writes or plans for minutes: the slow verbs get this long. */
export const SLOW_MS = 6 * 60_000;
const POLL_MS = 5000;
const DEBOUNCE_MS = 250;

/** The author for --by: the setting, else the login name. */
export function ideaAuthor(): string {
    let user = '';
    try {
        user = os.userInfo().username;
    } catch {
        // no account name on this platform: the setting or "someone"
    }
    return authorName(vscode.workspace.getConfiguration('corgi').get<string>('idea.author', ''), user);
}

/** Why corgi failed: the message of its `{"error":{...}}` JSON when it printed one, else the last line. */
export function lastLine(r: CorgiResult): string {
    try {
        const parsed = JSON.parse(r.stdout) as { error?: { message?: string } };
        if (parsed?.error?.message) {
            return parsed.error.message;
        }
    } catch {
        // not JSON: the last line below
    }
    return (r.stderr || r.stdout).trim().split('\n').pop() ?? '';
}

/** A `corgi idea … --json` verb, parsed; or why it failed. */
export async function ideaJSON<T>(args: string[], timeoutMs?: number): Promise<{ ok: true; value: T } | { ok: false; why: string }> {
    const r = await runCorgi(['idea', ...args], undefined, timeoutMs);
    if (!r.ok) {
        return { ok: false, why: lastLine(r) || 'corgi failed' };
    }
    try {
        return { ok: true, value: JSON.parse(r.stdout) as T };
    } catch {
        return { ok: false, why: 'corgi printed something that was not JSON' };
    }
}

/**
 * Change under <agent dir>/ideas: corgi touches ideas/changed on every
 * change to any idea, and the idea's own folder changes with it. fs.watch
 * on both, a slow poll on the marker's mtime for the platforms that drop
 * events, and one debounced event out.
 */
export class IdeaFilesWatcher implements vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;
    private readonly watchers = new Map<string, fs.FSWatcher>();
    private poll: NodeJS.Timeout | undefined;
    private debounce: NodeJS.Timeout | undefined;
    private lastMtime = -1;
    private disposed = false;

    constructor(private readonly agentDir: string, private readonly slug?: string) { }

    start(): this {
        this.poll = setInterval(() => this.tick(), POLL_MS);
        this.tick();
        return this;
    }

    private dirs(): string[] {
        const out = [ideasDir(this.agentDir)];
        if (this.slug) {
            out.push(path.join(ideasDir(this.agentDir), this.slug));
        }
        return out;
    }

    private arm(): void {
        if (this.disposed) {
            return;
        }
        for (const dir of this.dirs()) {
            if (this.watchers.has(dir)) {
                continue;
            }
            try {
                const w = fs.watch(dir, (_event, filename) => {
                    const name = filename ? filename.toString() : '';
                    // In ideas/ itself only the marker and this idea's folder matter (everything, without a slug).
                    if (!name || dir !== ideasDir(this.agentDir) || !this.slug || name === 'changed' || name === this.slug) {
                        this.schedule();
                    }
                });
                w.on('error', () => {
                    w.close();
                    this.watchers.delete(dir);
                });
                this.watchers.set(dir, w);
            } catch {
                // not there yet: the poll arms it again once it is
            }
        }
    }

    private tick(): void {
        if (this.disposed) {
            return;
        }
        this.arm();
        let mtime = -1;
        try {
            mtime = fs.statSync(changedMarker(this.agentDir)).mtimeMs;
            if (this.slug) {
                for (const f of ['idea.md', 'meta.json', 'comments.json']) {
                    try {
                        mtime = Math.max(mtime, fs.statSync(path.join(ideasDir(this.agentDir), this.slug, f)).mtimeMs);
                    } catch {
                        // a file corgi has not written yet
                    }
                }
            }
        } catch {
            // no marker: nothing has changed yet
        }
        if (mtime !== this.lastMtime) {
            const first = this.lastMtime === -1;
            this.lastMtime = mtime;
            if (!first) {
                this.schedule();
            }
        }
    }

    private schedule(): void {
        if (this.debounce) {
            clearTimeout(this.debounce);
        }
        this.debounce = setTimeout(() => {
            this.debounce = undefined;
            if (!this.disposed) {
                this.changed.fire();
            }
        }, DEBOUNCE_MS);
    }

    dispose(): void {
        this.disposed = true;
        if (this.poll) {
            clearInterval(this.poll);
        }
        if (this.debounce) {
            clearTimeout(this.debounce);
        }
        for (const w of this.watchers.values()) {
            w.close();
        }
        this.watchers.clear();
        this.changed.dispose();
    }
}

