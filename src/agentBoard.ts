import * as fs from 'node:fs';

/**
 * The session board corgi's daemon publishes at <agent dir>/sessions.json:
 * the fields this extension reads, and the pure logic over them (status bar
 * text, quick pick rows, needs-input transitions). No VS Code import here
 * so it can be unit tested outside the extension host.
 */

export type SessionStatus = 'working' | 'needs_input' | 'done' | 'limited' | 'stale' | 'gone' | 'unknown';

export interface BoardSession {
    id: string;
    label?: string;
    display?: string;
    cwd?: string;
    profile?: string;
    status?: SessionStatus | string;
    statusSince?: string;
    lastActivity?: string;
    detail?: string;
    tool?: string;
    host?: { kind?: string; windowId?: string; shellPid?: number; connected?: boolean };
    context?: { tokens?: number; window?: number; percent?: number; model?: string; at?: string };
    title?: string;
    pending?: { tool?: string; subject?: string; at?: string };
    note?: string;
    stuck?: boolean;
}

export interface LimitWindow {
    percent?: number;
    resetsAt?: string;
}

export interface BoardAccount {
    profile: string;
    configDir?: string;
    limits?: { fetchedAt?: string; fiveHour?: LimitWindow; sevenDay?: LimitWindow };
    forecast?: { fiveHour?: { percentPerHour?: number; exhaustAt?: string; safe?: boolean; samples?: number }; sevenDay?: unknown };
    sessions?: number;
}

export interface Board {
    updatedAt?: string;
    size?: number;
    needsInput?: number;
    working?: number;
    sessions?: BoardSession[] | null;
    frontWindow?: string;
    frontSession?: string;
    notice?: string | null;
    noticeAt?: string;
    accounts?: BoardAccount[] | null;
}

export function readBoard(file: string): Board | undefined {
    try {
        const board = JSON.parse(fs.readFileSync(file, 'utf8'));
        return board && typeof board === 'object' ? board : undefined;
    } catch {
        return undefined;
    }
}

/** Sessions the board still shows a key for; gone ones are history. */
export function liveSessions(board: Board | undefined): BoardSession[] {
    return (board?.sessions ?? []).filter((s) => s && s.id && s.status !== 'gone');
}

export function sessionName(s: BoardSession): string {
    return s.display || s.label || s.id.slice(0, 8);
}

export const statusWords: Record<string, string> = {
    working: 'working',
    needs_input: 'needs you',
    done: 'done',
    limited: 'limited',
    stale: 'stale',
    gone: 'gone',
    unknown: 'unknown',
};

export function statusWord(status: string | undefined): string {
    return statusWords[status ?? ''] ?? (status || 'unknown');
}

export function formatElapsed(since: string | undefined, now: Date = new Date()): string {
    if (!since) {
        return '';
    }
    const ms = now.getTime() - new Date(since).getTime();
    if (!Number.isFinite(ms) || ms < 0) {
        return '';
    }
    const s = Math.floor(ms / 1000);
    if (s < 60) {
        return `${s}s`;
    }
    const m = Math.floor(s / 60);
    if (m < 60) {
        return `${m}m`;
    }
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${Math.floor(h / 24)}d`;
}

/** The account closest to its 5h limit: the one the status bar should warn about. */
export function lowestHeadroomAccount(accounts: BoardAccount[] | null | undefined): BoardAccount | undefined {
    let best: BoardAccount | undefined;
    for (const a of accounts ?? []) {
        const pct = a?.limits?.fiveHour?.percent;
        if (typeof pct !== 'number') {
            continue;
        }
        if (!best || pct > (best.limits?.fiveHour?.percent ?? -1)) {
            best = a;
        }
    }
    return best;
}

export function countByStatus(sessions: BoardSession[], status: string): number {
    return sessions.filter((s) => s.status === status).length;
}

/** "$(pulse) 2 · $(bell) 1 · 5h 62%": working, needs input, and the tightest 5h limit. */
export function statusBarText(board: Board | undefined): string {
    const sessions = liveSessions(board);
    const working = typeof board?.working === 'number' ? board.working : countByStatus(sessions, 'working');
    const needsInput = typeof board?.needsInput === 'number' ? board.needsInput : countByStatus(sessions, 'needs_input');
    const parts = [`$(pulse) ${working}`];
    if (needsInput > 0) {
        parts.push(`$(bell) ${needsInput}`);
    }
    const account = lowestHeadroomAccount(board?.accounts);
    if (account) {
        parts.push(`5h ${account.limits!.fiveHour!.percent}%`);
    }
    return parts.join(' · ');
}

/** One tooltip line per session: name, status, detail, context fill, elapsed. */
export function sessionSummary(s: BoardSession, now: Date = new Date()): string {
    const bits = [statusWord(s.status)];
    if (s.pending?.tool) {
        bits.push(`asks ${s.pending.tool}`);
    }
    if (s.detail) {
        bits.push(s.detail);
    }
    if (typeof s.context?.percent === 'number') {
        bits.push(`ctx ${s.context.percent}%`);
    }
    const elapsed = formatElapsed(s.statusSince, now);
    if (elapsed) {
        bits.push(elapsed);
    }
    if (s.stuck) {
        bits.push('stuck');
    }
    if (s.note) {
        bits.push(`"${s.note}"`);
    }
    return `${sessionName(s)} — ${bits.join(' / ')}`;
}

export function boardTooltip(board: Board | undefined, now: Date = new Date()): string {
    const sessions = liveSessions(board);
    if (!sessions.length) {
        return 'corgi agent: no Claude Code sessions';
    }
    const lines = sessions.map((s) => sessionSummary(s, now));
    const account = lowestHeadroomAccount(board?.accounts);
    if (account) {
        const five = account.limits!.fiveHour!;
        const seven = account.limits?.sevenDay;
        let line = `${account.profile}: 5h ${five.percent}%`;
        if (typeof seven?.percent === 'number') {
            line += `, 7d ${seven.percent}%`;
        }
        if (five.resetsAt) {
            line += ` (resets ${new Date(five.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
        }
        lines.push('', line);
    }
    return lines.join('\n');
}

/** Sessions sorted the way a picker should list them: needs input first, oldest first within a status. */
export const statusRank: Record<string, number> = { needs_input: 0, limited: 1, working: 2, done: 3, stale: 4, unknown: 5 };

export function sortForPick(sessions: BoardSession[]): BoardSession[] {
    return [...sessions].sort((a, b) => {
        const ra = statusRank[a.status ?? ''] ?? 9;
        const rb = statusRank[b.status ?? ''] ?? 9;
        if (ra !== rb) {
            return ra - rb;
        }
        return (a.statusSince ?? '').localeCompare(b.statusSince ?? '');
    });
}

/** The session `corgi agent next` would go to: the longest-waiting needs_input one, else the front session. */
export function nextSession(board: Board | undefined): BoardSession | undefined {
    const waiting = sortForPick(liveSessions(board)).filter((s) => s.status === 'needs_input');
    if (waiting.length) {
        return waiting[0];
    }
    return liveSessions(board).find((s) => s.id === board?.frontSession);
}

/**
 * Sessions that entered needs_input between two board reads and live in a
 * window other than ours. Keyed by id + statusSince, so one wait is one
 * toast even when the board is re-read many times.
 */
export function newlyNeedingInput(previous: Board | undefined, next: Board | undefined, windowId: string, seen: Set<string>): BoardSession[] {
    const before = new Map(liveSessions(previous).map((s) => [s.id, s]));
    const out: BoardSession[] = [];
    for (const s of liveSessions(next)) {
        if (s.status !== 'needs_input' || s.host?.windowId === windowId) {
            continue;
        }
        const key = `${s.id}@${s.statusSince ?? ''}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const was = before.get(s.id);
        if (was && was.status === 'needs_input' && was.statusSince === s.statusSince) {
            continue;
        }
        // The first read is a snapshot, not a transition: a window that
        // just opened should not repeat every wait already on the board.
        if (previous !== undefined) {
            out.push(s);
        }
    }
    return out;
}

/** The Claude Code chat tab whose label is title: exact, then case-insensitive prefix, then substring. */
export function matchTabByTitle<T extends { label: string }>(tabs: T[], title: string): T | undefined {
    const wanted = title.trim();
    if (!wanted) {
        return undefined;
    }
    const lower = wanted.toLowerCase();
    return tabs.find((t) => t.label === wanted)
        ?? tabs.find((t) => t.label.toLowerCase().startsWith(lower))
        ?? tabs.find((t) => t.label.toLowerCase().includes(lower));
}
