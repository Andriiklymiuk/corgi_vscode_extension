import { Board, BoardAccount, BoardSession, Bot, botTitle, changesLine, formatElapsed, formatTokens, hideWorkspaces, isCrossing, isDrifting, limitLine, liveSessions, overlapLine, resumeWord, sessionName, spendLine, statusRank, statusWord, testsLine } from './agentBoard';
import { InboxItem, elapsed, groupByWorkspace, itemDetail, itemName, openableUrl } from './watchInbox';

/**
 * Everything the sidebar page shows, decided here so the page only draws.
 * No vscode import: this runs in plain node tests.
 */

export type SessionNode = { kind: 'session'; session: BoardSession };
export type InboxNode = { kind: 'item'; item: InboxItem };
export type Tone = 'ask' | 'bad' | 'live' | 'quiet';

export interface UsageWindow {
    name: '5h' | '7d';
    label: string;
    percent: number;
    resets: string;
    warn: string;
}

export interface SessionRow {
    id: string;
    title: string;
    clause: string;
    tooltip: string;
    elapsed: string;
    tone: Tone;
    crossing: boolean;
    front: boolean;
    can: ('chat' | 'allow' | 'fresh' | 'pr')[];
    node: SessionNode;
}

export interface InboxRow {
    key: string;
    name: string;
    detail: string;
    tooltip: string;
    elapsed: string;
    tone: Tone;
    url?: string;
    can: ('work' | 'open' | 'ignore' | 'unblock' | 'pr')[];
    node: InboxNode;
}

/** One card of `corgi agent kanban --json`, the fields the page reads. */
export interface KanbanCard {
    ref?: string;
    key?: string;
    title?: string;
    url?: string;
    workspace?: string;
    column?: string;
    why?: string;
    updatedAt?: string;
    fix?: { running?: boolean; outcome?: string; prs?: string[] };
    standing?: { word?: string };
}

export interface BoardRow {
    key: string;
    title: string;
    detail: string;
    elapsed: string;
    tone: Tone;
    url?: string;
}

/** A registered workspace as `corgi agent workspaces --json` and `corgi agent watch --json` describe it. */
export interface WorkspaceInfo {
    id: string;
    absPath?: string;
    status?: string;
}

export interface WatchedWorkspace {
    workspace: string;
    action?: string;
    sources?: string[];
}

export interface WorkspaceRow {
    id: string;
    detail: string;
    paused: boolean;
    watch: string;
    tone: Tone;
}

export interface DaemonInfo {
    pid?: number;
    version?: string;
}

export interface SidebarState {
    daemon: { running: boolean; version: string; muted: string };
    accounts: { profile: string; sessions: number; windows: UsageWindow[] }[];
    inbox: { workspace: string; rows: InboxRow[] }[];
    board: { column: string; rows: BoardRow[] }[];
    sessions: { workspace: string; rows: SessionRow[] }[];
    ended: SessionRow[];
    workspaces: WorkspaceRow[];
    counts: { inbox: number; active: number; board: number };
    profiles: string[];
    /** False when the corgi binary is not on the machine: the page shows how to install it. */
    installed: boolean;
}

/** "resets in 40m" / "resets in 3h" / "resets in 5d"; "" without a time ahead. */
function resetsIn(at: string | undefined, now: Date): string {
    if (!at) {
        return '';
    }
    const ms = Date.parse(at) - now.getTime();
    if (Number.isNaN(ms) || ms <= 0) {
        return '';
    }
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) {
        return `resets in ${minutes}m`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 48) {
        return `resets in ${hours}h`;
    }
    return `resets in ${Math.round(hours / 24)}d`;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export function usageWindows(a: BoardAccount, now: Date): UsageWindow[] {
    const out: UsageWindow[] = [];
    const five = a.limits?.fiveHour;
    if (five && typeof five.percent === 'number') {
        const f = a.forecast?.fiveHour;
        const runsOut = f && f.safe === false && f.exhaustAt ? new Date(f.exhaustAt) : undefined;
        const warn = runsOut && !Number.isNaN(runsOut.getTime()) ? `runs out ${runsOut.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
        out.push({ name: '5h', label: 'Session (5h)', percent: clamp(five.percent), resets: resetsIn(five.resetsAt, now), warn });
    }
    const seven = a.limits?.sevenDay;
    if (seven && typeof seven.percent === 'number') {
        out.push({ name: '7d', label: 'Weekly (7d)', percent: clamp(seven.percent), resets: resetsIn(seven.resetsAt, now), warn: '' });
    }
    return out;
}

/** Sessions grouped by workspace, alphabetically; needs-input first within each. */
export function groupSessions(board: Board | undefined): { label: string; sessions: BoardSession[] }[] {
    const groups = new Map<string, BoardSession[]>();
    for (const s of liveSessions(board)) {
        const key = s.label || s.display || '?';
        groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(([label, sessions]) => ({
            label,
            sessions: sessions.sort((a, b) => (statusRank[a.status ?? ''] ?? 9) - (statusRank[b.status ?? ''] ?? 9)),
        }));
}

export function sessionRow(s: BoardSession, bots: Bot[], now: Date, front = ''): SessionRow {
    const bot = s.bot ? bots.find((b) => b.name === s.bot) : undefined;
    const drifting = isDrifting(s);
    const crossing = isCrossing(s);
    // A limit with a plan says when, before anything else: a drift note or a
    // status word would read as something to do, and there is nothing to do.
    const meta = [resumeWord(s, now) || (drifting ? 'drifting' : statusWord(s.status))];
    // After the status, one of: the drift reason, who else is on its files,
    // the permission, the note, the limit, what it is doing, the branch.
    if (drifting) {
        meta.push(s.drift![0]);
    } else if (crossing) {
        meta.push(`⚠ ${overlapLine(s)}`);
    } else if (s.pending?.tool) {
        meta.push(`asks ${s.pending.tool}`);
    } else if (s.note) {
        meta.push(`"${s.note}"`);
    } else if (limitLine(s, now)) {
        meta.push(limitLine(s, now));
    } else if (s.detail) {
        meta.push(s.detail);
    } else if (s.branch) {
        meta.push(s.branch);
    }
    for (const line of [changesLine(s), testsLine(s), spendLine(s)]) {
        if (line) {
            meta.push(line);
        }
    }
    if (typeof s.context?.percent === 'number' && s.context.percent > 0) {
        meta.push(`ctx ${s.context.percent}%`);
    }
    const tooltip = [
        s.display || s.label,
        s.cwd,
        s.branch ? `branch ${s.branch}` : '',
        s.profile ? `account ${s.profile}` : '',
        s.host?.kind,
        s.summary ? `\n${s.summary}` : '',
        s.pr ? `\n${s.pr}` : '',
        drifting ? `\ndrifting:\n${s.drift!.join('\n')}` : '',
        s.changes?.touched?.length ? `\ntouching: ${s.changes.touched.join(', ')}` : '',
        crossing ? `\ncrossing streams:\n${(s.overlap ?? []).map((o) => (o.sameCheckout ? `same checkout as ${o.session}` : `${o.session} on ${(o.files ?? []).join(', ')}`)).join('\n')}` : '',
        s.tests ? `\n${testsLine(s)}${s.tests.at ? ` · ${formatElapsed(s.tests.at, now)}` : ''}` : '',
        s.spend?.tokens ? `\nspent ${formatTokens(s.spend.tokens)} tokens${s.spend.turns ? ` over ${s.spend.turns} turns` : ''}${s.cap ? ` · budget ${formatTokens(s.cap)}` : ''}${s.overCap ? ' · OVER BUDGET' : ''}` : '',
    ].filter(Boolean).join('\n');
    const tone: Tone = drifting || s.overCap ? 'bad' : s.status === 'needs_input' ? 'ask' : s.status === 'working' ? 'live' : 'quiet';
    const can: SessionRow['can'] = ['chat'];
    if (s.pending) {
        can.push('allow');
    }
    if (drifting) {
        can.push('fresh');
    }
    if (s.pr) {
        can.push('pr');
    }
    return {
        id: s.id,
        title: bot ? botTitle(bot) : s.title || sessionName(s),
        clause: meta.join(' · '),
        tooltip,
        elapsed: formatElapsed(s.statusSince, now),
        tone,
        crossing,
        front: !!front && s.id === front,
        can,
        node: { kind: 'session', session: s },
    };
}

export function inboxRow(item: InboxItem, now: number): InboxRow {
    const url = openableUrl(item);
    const issue = (item.kind ?? '').startsWith('issue.') || item.kind === 'task';
    const can: InboxRow['can'] = [];
    if (issue) {
        can.push('work');
    }
    if (url) {
        can.push('open');
    }
    can.push('ignore');
    if (item.blocked) {
        can.push('unblock');
    }
    if (item.pr) {
        can.push('pr');
    }
    // itemDetail ends with the wait; the row shows that on its right instead.
    const waited = elapsed(item.at, now);
    let detail = itemDetail(item, now);
    if (waited && detail.endsWith(waited)) {
        detail = detail.slice(0, -waited.length).replace(/ · $/, '');
    }
    return {
        key: item.key,
        name: itemName(item),
        detail,
        tooltip: [item.title || itemName(item), item.author && item.body ? `${item.author}: ${item.body}` : '', item.blocked ? `blocked: ${item.blocked}` : ''].filter(Boolean).join('\n'),
        elapsed: waited,
        tone: item.blocked ? 'bad' : item.session ? 'ask' : 'quiet',
        url,
        can,
        node: { kind: 'item', item },
    };
}

/** The kanban's column order; anything else lands after these. */
export const boardColumns = ['Inbox', 'Ready', 'Running', 'Blocked', 'Review', 'Done'];

/** Cards by column, in the board's own order, newest first inside one. */
export function boardGroups(cards: KanbanCard[], now: number): { column: string; rows: BoardRow[] }[] {
    const groups = new Map<string, BoardRow[]>();
    for (const c of cards) {
        if (!c.ref && !c.key) {
            continue;
        }
        const column = c.column || 'Inbox';
        const running = !!c.fix?.running;
        const tone: Tone = column === 'Blocked' ? 'bad' : running ? 'live' : column === 'Ready' ? 'ask' : 'quiet';
        const detail = [c.workspace, c.why || c.standing?.word, running ? 'fix running' : c.fix?.prs?.length ? `PR ${c.fix.prs[c.fix.prs.length - 1]}` : ''].filter(Boolean).join(' · ');
        const url = c.url && /^https:\/\//.test(c.url) ? c.url : undefined;
        groups.set(column, [...(groups.get(column) ?? []), { key: c.key || c.ref!, title: c.ref ? `${c.ref}  ${c.title ?? ''}`.trim() : c.title ?? '', detail, elapsed: elapsed(c.updatedAt, now), tone, url }]);
    }
    const rank = (col: string) => {
        const i = boardColumns.indexOf(col);
        return i < 0 ? boardColumns.length : i;
    };
    return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([column, rows]) => ({ column, rows }));
}

/** Registered workspaces with what the daemon does for each. */
export function workspaceRows(list: WorkspaceInfo[], watched: WatchedWorkspace[], running: Set<string>, paused: Set<string>): WorkspaceRow[] {
    return list.map((w) => {
        const watch = watched.find((x) => x.workspace === w.id);
        const isPaused = paused.has(w.id);
        const bits = [isPaused ? 'paused' : running.has(w.id) ? 'supervised' : 'registered'];
        if (watch) {
            bits.push(`watch ${watch.action ?? 'notify'}${watch.sources?.length ? ` · ${watch.sources.join(', ')}` : ''}`);
        }
        if (w.status && w.status !== 'ok') {
            bits.push(w.status);
        }
        return { id: w.id, detail: bits.join(' · '), paused: isPaused, watch: watch?.action ?? '', tone: w.status && w.status !== 'ok' ? 'bad' : running.has(w.id) ? 'live' : 'quiet' };
    });
}

/** "muted until 3:30 PM" while a mute holds; "" otherwise. */
export function mutedLine(until: string | undefined, now: Date): string {
    if (!until) {
        return '';
    }
    const at = new Date(until.trim());
    if (Number.isNaN(at.getTime()) || at <= now) {
        return '';
    }
    return `muted until ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export interface BuildInput {
    board?: Board;
    inbox: InboxItem[];
    hidden: readonly string[];
    bots: Bot[];
    now: Date;
    installed?: boolean;
    daemon?: DaemonInfo;
    mutedUntil?: string;
    cards?: KanbanCard[];
    workspaces?: WorkspaceInfo[];
    watched?: WatchedWorkspace[];
    running?: string[];
    paused?: string[];
}

export function build(input: BuildInput): SidebarState {
    const { inbox, hidden, bots, now } = input;
    const shown = hideWorkspaces(input.board, hidden);
    const front = shown?.frontSession ?? '';
    const groups = groupSessions(shown);
    const sessions = groups.length === 1
        ? [{ workspace: '', rows: groups[0].sessions.map((s) => sessionRow(s, bots, now, front)) }]
        : groups.map((g) => ({ workspace: g.label, rows: g.sessions.map((s) => sessionRow(s, bots, now, front)) }));
    const inboxGroups = groupByWorkspace(inbox);
    const inboxOut = inboxGroups.length === 1
        ? [{ workspace: '', rows: inboxGroups[0].items.map((i) => inboxRow(i, now.getTime())) }]
        : inboxGroups.map((g) => ({ workspace: g.workspace, rows: g.items.map((i) => inboxRow(i, now.getTime())) }));
    const live = liveSessions(shown);
    const ended = (shown?.sessions ?? []).filter((s) => s && s.id && s.status === 'gone').map((s) => sessionRow(s, bots, now));
    const accounts = shown?.accounts ?? [];
    const cards = input.cards ?? [];
    return {
        daemon: { running: !!input.daemon?.pid, version: input.daemon?.version ?? '', muted: mutedLine(input.mutedUntil, now) },
        accounts: accounts.map((a) => ({ profile: a.profile, sessions: a.sessions ?? 0, windows: usageWindows(a, now) })).filter((a) => a.windows.length > 0),
        inbox: inboxOut,
        board: boardGroups(cards, now.getTime()),
        sessions,
        ended,
        workspaces: workspaceRows(input.workspaces ?? [], input.watched ?? [], new Set(input.running ?? []), new Set(input.paused ?? [])),
        counts: { inbox: inbox.length, active: live.filter((s) => s.status === 'working' || s.status === 'needs_input').length, board: cards.length },
        profiles: accounts.map((a) => a.profile).filter(Boolean),
        installed: input.installed !== false,
    };
}
