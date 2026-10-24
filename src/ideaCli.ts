import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CorgiResult, runCorgi } from './corgiExec';
import { authorName, changedMarker, ideasDir, isSlug } from './idea';

/**
 * What the idea panel, the comment threads and the sidebar share: the
 * author for --by, the `corgi idea … --json` call, the watcher on the idea
 * files, and one event that says "an idea changed" to whoever draws them.
 */

/** The agent writes or plans for minutes: the slow verbs get this long. */
export const SLOW_MS = 6 * 60_000;
/** A write (comment, reply, resolve) notifies the desktop and a webhook before it exits: a minute, not 15 s. */
export const WRITE_MS = 60_000;
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

const ideasChanged = new vscode.EventEmitter<string | undefined>();
/**
 * An idea changed, by slug when known: a panel or the threads view wrote
 * through corgi, or a watcher saw the files move. The sidebar re-reads its
 * Ideas section on this, so the counts follow the panel.
 */
export const onIdeasChanged = ideasChanged.event;
export function fireIdeasChanged(slug?: string): void {
    ideasChanged.fire(slug);
}

/** The newest mtime among the marker and, for one idea, its three files; -1 when none is there. */
export function ideaStamp(agentDir: string, slug?: string): number {
    let mtime = -1;
    const look = (file: string) => {
        try {
            mtime = Math.max(mtime, fs.statSync(file).mtimeMs);
        } catch {
            // not written yet
        }
    };
    look(changedMarker(agentDir));
    if (slug) {
        for (const f of ['idea.md', 'meta.json', 'comments.json']) {
            look(path.join(ideasDir(agentDir), slug, f));
        }
    }
    return mtime;
}

/**
 * Change under <agent dir>/ideas: corgi touches ideas/changed on every
 * change to any idea, and the idea's own folder changes with it. fs.watch
 * on both (armed again by the poll once a missing folder appears), a slow
 * poll on the mtimes for the platforms that drop events, and one debounced
 * event out, with the slug when the event named one. start() seeds the
 * baseline without firing; the first real change fires, even from nothing.
 */
export class IdeaFilesWatcher implements vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<string | undefined>();
    readonly onDidChange = this.changed.event;
    private readonly watchers = new Map<string, fs.FSWatcher>();
    private poll: NodeJS.Timeout | undefined;
    private debounce: NodeJS.Timeout | undefined;
    private lastMtime = -1;
    private pendingSlug: string | undefined | null = null;
    private disposed = false;

    constructor(private readonly agentDir: string, private readonly slug?: string) { }

    get running(): boolean {
        return !!this.poll;
    }

    start(): this {
        if (this.poll || this.disposed) {
            return this;
        }
        this.lastMtime = ideaStamp(this.agentDir, this.slug);
        this.arm();
        this.poll = setInterval(() => this.tick(), POLL_MS);
        return this;
    }

    /** Quiet until start() again: no poll, no fs.watch. */
    stop(): void {
        if (this.poll) {
            clearInterval(this.poll);
            this.poll = undefined;
        }
        if (this.debounce) {
            clearTimeout(this.debounce);
            this.debounce = undefined;
        }
        for (const w of this.watchers.values()) {
            w.close();
        }
        this.watchers.clear();
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
                    if (dir !== ideasDir(this.agentDir)) {
                        this.schedule(this.slug);
                    } else if (!name || name === 'changed') {
                        this.schedule(undefined);
                    } else if (!this.slug || name === this.slug) {
                        // A folder named by its slug changed.
                        this.schedule(isSlug(name) ? name : undefined);
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
        if (this.disposed || !this.poll) {
            return;
        }
        this.arm();
        const mtime = ideaStamp(this.agentDir, this.slug);
        if (mtime !== this.lastMtime) {
            this.lastMtime = mtime;
            this.schedule(this.slug);
        }
    }

    private schedule(slug: string | undefined): void {
        // Two events in one burst: keep the slug only when both agree.
        this.pendingSlug = this.pendingSlug === null ? slug : this.pendingSlug === slug ? slug : undefined;
        if (this.debounce) {
            clearTimeout(this.debounce);
        }
        this.debounce = setTimeout(() => {
            this.debounce = undefined;
            const which = this.pendingSlug ?? undefined;
            this.pendingSlug = null;
            if (!this.disposed) {
                // The poll must not fire again for what fs.watch just reported.
                this.lastMtime = ideaStamp(this.agentDir, this.slug);
                this.changed.fire(which);
            }
        }, DEBOUNCE_MS);
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
        this.changed.dispose();
    }
}
