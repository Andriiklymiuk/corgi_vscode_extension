import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** One thing the watch saw that is still waiting on a person. */
export interface InboxItem {
    key: string;
    ref?: string;
    kind?: string;
    workspace?: string;
    title?: string;
    url?: string;
    state?: string;
    at?: string;
    /** Why unattended runs leave this ticket alone: the breaker tripped, or someone blocked it by hand. */
    blocked?: string;
    /** The live session on the ticket: opened for it by Work on it, or on a branch named after it. */
    session?: { id: string; label: string; status: string };
    /** Work on it pressed, and by whom, while the session is on its way. */
    picked?: { at: string; by: string };
    /** A task's own columns (a tracker ticket's come from the board). */
    columns?: string[];
    /** Who said what, for a comment or a review. */
    author?: string;
    body?: string;
}

const KIND_LABEL: Record<string, string> = {
    'issue.new': 'issue',
    'issue.comment': 'comment',
    'pr.comment': 'PR comment',
    'pr.review': 'PR review',
    'review.requested': 'review asked',
    'ci.failed': 'red build',
    routine: 'routine',
    task: 'task',
};

export function kindLabel(item: InboxItem): string {
    return KIND_LABEL[item.kind ?? ''] ?? item.kind ?? '';
}

export function itemName(item: InboxItem): string {
    return item.ref?.trim() || item.key;
}

/** "READY TO DEV · 20m" — the column it sits in and how long it has waited; a blocked one says why first. */
const STATUS_WORD: Record<string, string> = { needs_input: 'needs you', working: 'working', done: 'done', stale: 'idle', limited: 'limit' };

export function itemDetail(item: InboxItem, now: number): string {
    const bits = [kindLabel(item)];
    if (item.blocked) {
        bits.push(`blocked: ${item.blocked}`);
    } else if (item.session) {
        bits.push(`session ${item.session.label} · ${STATUS_WORD[item.session.status] ?? item.session.status}`);
    } else if (item.picked) {
        const from = item.picked.by === 'cli' ? 'command line' : item.picked.by === 'page' ? 'page' : item.picked.by === 'editor' ? 'editor' : 'phone';
        bits.push(`picked from the ${from} · waiting for a session`);
    } else if (item.author && item.body) {
        bits.push(`${item.author}: ${item.body}`);
    }
    if (item.state) {
        bits.push(item.state);
    }
    const waited = elapsed(item.at, now);
    if (waited) {
        bits.push(waited);
    }
    return bits.filter(Boolean).join(' · ');
}

export function elapsed(at: string | undefined, now: number): string {
    if (!at) {
        return '';
    }
    const started = Date.parse(at);
    if (Number.isNaN(started)) {
        return '';
    }
    const minutes = Math.max(0, Math.floor((now - started) / 60_000));
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
    }
    return `${Math.floor(hours / 24)}d`;
}

/** Only an https link is worth opening. */
export function openableUrl(item: InboxItem): string | undefined {
    return item.url && /^https:\/\//.test(item.url) ? item.url : undefined;
}

/** Items grouped by workspace, alphabetically, newest first inside each. */
export function groupByWorkspace(items: InboxItem[]): { workspace: string; items: InboxItem[] }[] {
    const groups = new Map<string, InboxItem[]>();
    for (const item of items) {
        const key = item.workspace?.trim() || 'elsewhere';
        groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(([workspace, list]) => ({
            workspace,
            items: list.sort((a, b) => Date.parse(b.at ?? '') - Date.parse(a.at ?? '')),
        }));
}

/**
 * Reads the inbox from corgi itself rather than the events file: the CLI
 * already drops what was dismissed and prefers a column someone moved a
 * ticket to, and those rules should live in one place.
 */
export async function readInbox(corgi = 'corgi', hidden: readonly string[] = []): Promise<InboxItem[]> {
    try {
        const { stdout } = await run(corgi, ['agent', 'watch', '--json'], { timeout: 10_000 });
        const parsed = JSON.parse(stdout) as { events?: InboxItem[] };
        return (parsed.events ?? []).filter((e) => e && typeof e.key === 'string' && e.key !== '' && !hiddenWorkspace(e.workspace, hidden));
    } catch {
        return []; // no corgi, no watch, half-written output: an empty inbox, never a crash
    }
}

function hiddenWorkspace(name: string | undefined, hidden: readonly string[]): boolean {
    return !!name && (hidden.includes(name) || hidden.includes(name.split('/').filter(Boolean).pop() ?? name));
}
