import * as fs from 'node:fs';
import * as path from 'node:path';

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
    /** The cwd's branch as of the last prompt, what Claude last said, the last pull request it linked. */
    branch?: string;
    summary?: string;
    pr?: string;
    turnStartedAt?: string;
    /** Which limit a limited session hit ("quota" | "overload"), when the daemon continues it, how many times it has. */
    limit?: string;
    resumeAt?: string;
    resumes?: number;
    /** What the daemon concluded a person should look at: a context nearly full, a tool failing on repeat, a diff past its budget. */
    drift?: string[];
    /** What the branch has built up since it left main, measured once a minute. */
    changes?: { files?: number; lines?: number; touched?: string[]; at?: string };
    /** Other live sessions in the same repository on the same files — or in the same working tree. */
    overlap?: { id?: string; session?: string; files?: string[]; sameCheckout?: boolean }[];
    /** The last test command the session ran, and how it went. */
    tests?: { ok?: boolean; at?: string; cmd?: string };
    /** The bot this session runs as (corgi agent bot, 2.20.13). */
    bot?: string;
    /** What it has cost, the budget it runs under, and whether it passed it (corgi 2.20.9). */
    spend?: { tokens?: number; turns?: number; at?: string };
    cap?: number;
    overCap?: boolean;
}

export function isDrifting(s: BoardSession): boolean {
    return Array.isArray(s.drift) && s.drift.length > 0;
}

/** "4 files · 120 lines" — the branch in one line; "" when there is no diff. */
export function changesLine(s: BoardSession): string {
    const c = s.changes;
    if (!c || (!c.files && !c.lines)) {
        return '';
    }
    const files = c.files ?? 0;
    const lines = c.lines ?? 0;
    return `${files} file${files === 1 ? '' : 's'} · ${lines} line${lines === 1 ? '' : 's'}`;
}

/** Whether another session in the same repository is on this one's files. */
export function isCrossing(s: BoardSession): boolean {
    return Array.isArray(s.overlap) && s.overlap.length > 0;
}

/** "api·2 on registry.go, b.go, …" or "same checkout as api·2" — the first crossing; "" when none. */
export function overlapLine(s: BoardSession): string {
    const first = s.overlap?.[0];
    if (!first) {
        return '';
    }
    if (first.sameCheckout) {
        return `same checkout as ${first.session ?? '?'}`;
    }
    const files = first.files ?? [];
    const shown = files.length > 2 ? [...files.slice(0, 2), '…'] : files;
    return `${first.session ?? '?'} on ${shown.join(', ')}`;
}

/** "tests ✓" or "tests ✗ go test"; "" when the session has not run any. */
export function testsLine(s: BoardSession): string {
    if (!s.tests) {
        return '';
    }
    return s.tests.ok ? 'tests ✓' : `tests ✗ ${s.tests.cmd ?? ''}`.trim();
}

/** A token count in one word: 52.3M, 980k, 412. */
export function formatTokens(n: number): string {
    if (n >= 1e9) {
        return `${(n / 1e9).toFixed(1)}B`;
    }
    if (n >= 1e6) {
        return `${(n / 1e6).toFixed(1)}M`;
    }
    if (n >= 1e3) {
        return `${Math.floor(n / 1e3)}k`;
    }
    return `${n}`;
}

/** "52.3M" for what the session has cost; "52.3M over budget" once it passed its cap. */
export function spendLine(s: BoardSession): string {
    const n = s.spend?.tokens ?? 0;
    if (n <= 0) {
        return '';
    }
    return s.overCap ? `${formatTokens(n)} over budget` : formatTokens(n);
}

/** "continues 12:50 · 2 so far" for a limited session the daemon plans to continue; "API overloaded" for a hiccup. */
export function limitLine(s: BoardSession, now: Date = new Date()): string {
    if (s.status !== 'limited') {
        return '';
    }
    if (s.limit === 'overload') {
        return 'API overloaded — retried on its own';
    }
    const at = s.resumeAt ? new Date(s.resumeAt) : undefined;
    if (!at || Number.isNaN(at.getTime()) || at.getFullYear() < 2000 || at <= now) {
        return '';
    }
    const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `continues ${clock}${s.resumes ? ` · ${s.resumes} so far` : ''}`;
}

/** A workspace is hidden by its id or label, or by the last path component of a folder. */
export function isHiddenWorkspace(name: string | undefined, hidden: readonly string[]): boolean {
    if (!name || hidden.length === 0) {
        return false;
    }
    if (hidden.includes(name)) {
        return true;
    }
    const base = name.split('/').filter(Boolean).pop() ?? name;
    return hidden.includes(base);
}

/**
 * The same board without the sessions of hidden workspaces and with the
 * counts recomputed — what every view reads while the screen is shown to
 * someone. Nothing on the machine changes.
 */
export function hideWorkspaces(board: Board | undefined, hidden: readonly string[]): Board | undefined {
    if (!board || hidden.length === 0) {
        return board;
    }
    const sessions = (board.sessions ?? []).filter((s) => s && !isHiddenWorkspace(s.label, hidden) && !isHiddenWorkspace(s.cwd, hidden));
    if (sessions.length === (board.sessions ?? []).length) {
        return board;
    }
    const gone = new Set((board.sessions ?? []).filter((s) => !sessions.includes(s)).map((s) => s.id));
    return {
        ...board,
        sessions,
        needsInput: sessions.filter((s) => s.status === 'needs_input').length,
        working: sessions.filter((s) => s.status === 'working').length,
        frontSession: board.frontSession && gone.has(board.frontSession) ? undefined : board.frontSession,
    };
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

/** A named session you come back to (corgi agent bot); the soul stays on the machine. */
export interface Bot {
    name: string;
    title?: string;
    workspace: string;
    model?: string;
    profile?: string;
    isolate?: boolean;
    color?: string;
    lastSession?: string;
}

/** The bots beside the board: <agent dir>/bots.json. */
export function readBots(agentDir: string): Bot[] {
    try {
        const store = JSON.parse(fs.readFileSync(path.join(agentDir, 'bots.json'), 'utf8'));
        return Array.isArray(store?.bots) ? store.bots.filter((b: Bot) => b && b.name) : [];
    } catch {
        return [];
    }
}

export const botTitle = (b: Bot): string => (b.title && b.title.trim()) || b.name;

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
    if (changesLine(s)) {
        bits.push(changesLine(s));
    }
    if (testsLine(s)) {
        bits.push(testsLine(s));
    }
    if (spendLine(s)) {
        bits.push(spendLine(s));
    }
    if (isCrossing(s)) {
        bits.push(`⚠ ${overlapLine(s)}`);
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

/** Control characters only — Escape, Return, "2" then Return — are keys to press, never text to paste. */
export function isKeySequence(text: string): boolean {
    return text.length > 0 && text.length <= 4 && /^[\x00-\x1f0-9]+$/.test(text) && /[\x00-\x1f]/.test(text);
}
