import { Board, BoardSession, liveSessions, sessionName } from './agentBoard';

/**
 * Auto-continue: a session that stopped on a usage limit is sent one message
 * the moment its window resets, so a long run does not sit dead until someone
 * notices. Pure logic over the board — no vscode import, so it unit tests.
 */

export interface AutoContinueSettings {
    enabled: boolean;
    message: string;
    /** Seconds to wait past the reset before typing; the limit lifts on the server's clock, not ours. */
    graceSeconds: number;
}

export const autoContinueDefaults: AutoContinueSettings = {
    enabled: false,
    message: 'continue',
    graceSeconds: 60,
};

export interface PendingContinue {
    sessionId: string;
    name: string;
    /** RFC3339 from the board. */
    resetsAt: string;
    resetsAtMs: number;
    /** Which window is holding it: the 5-hour one or the weekly one. */
    window: '5h' | 'week';
    profile?: string;
}

/** Sessions the board says are stopped on a limit. */
export function limitedSessions(board: Board | undefined): BoardSession[] {
    return liveSessions(board).filter((s) => s.status === 'limited');
}

/**
 * planContinues is every limited session that has a known reset time and has
 * not been cancelled, soonest first. A session whose account the board does
 * not carry is left out: without a reset time there is nothing to wait for.
 */
export function planContinues(board: Board | undefined, cancelled: ReadonlySet<string>): PendingContinue[] {
    const accounts = board?.accounts ?? [];
    const out: PendingContinue[] = [];
    for (const s of limitedSessions(board)) {
        if (cancelled.has(s.id)) {
            continue;
        }
        const account = accounts.find((a) => a.profile === (s.profile ?? '')) ?? (accounts.length === 1 ? accounts[0] : undefined);
        const reset = soonestReset(account?.limits);
        if (!reset) {
            continue;
        }
        out.push({
            sessionId: s.id,
            name: sessionName(s),
            resetsAt: reset.at,
            resetsAtMs: reset.ms,
            window: reset.window,
            profile: s.profile,
        });
    }
    return out.sort((a, b) => a.resetsAtMs - b.resetsAtMs);
}

function soonestReset(limits: { fiveHour?: { resetsAt?: string }; sevenDay?: { resetsAt?: string } } | undefined):
    { at: string; ms: number; window: '5h' | 'week' } | undefined {
    const candidates: { at: string; ms: number; window: '5h' | 'week' }[] = [];
    for (const [window, at] of [['5h', limits?.fiveHour?.resetsAt], ['week', limits?.sevenDay?.resetsAt]] as const) {
        if (!at) {
            continue;
        }
        const ms = Date.parse(at);
        if (Number.isFinite(ms)) {
            candidates.push({ at, ms, window });
        }
    }
    candidates.sort((a, b) => a.ms - b.ms);
    return candidates[0];
}

/** The ones whose window has reset and whose grace has passed. */
export function dueNow(pending: readonly PendingContinue[], nowMs: number, graceSeconds: number): PendingContinue[] {
    const grace = Math.max(0, graceSeconds) * 1000;
    return pending.filter((p) => nowMs >= p.resetsAtMs + grace);
}

/** "in 42m" / "now" — what the queue row says about the wait left. */
export function waitLabel(p: PendingContinue, nowMs: number): string {
    const left = p.resetsAtMs - nowMs;
    if (left <= 0) {
        return 'now';
    }
    const minutes = Math.round(left / 60000);
    if (minutes < 60) {
        return `in ${Math.max(1, minutes)}m`;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;
}

export function statusText(pending: readonly PendingContinue[], nowMs: number): string | undefined {
    if (pending.length === 0) {
        return undefined;
    }
    const soonest = pending[0];
    if (pending.length === 1) {
        return `$(debug-continue) ${soonest.name} ${waitLabel(soonest, nowMs)}`;
    }
    return `$(debug-continue) ${pending.length} queued, next ${waitLabel(soonest, nowMs)}`;
}

export function queueTooltip(pending: readonly PendingContinue[], nowMs: number, settings: AutoContinueSettings): string {
    if (!settings.enabled) {
        return 'Auto-continue is off — corgi.autoContinue.enabled turns it on';
    }
    if (pending.length === 0) {
        return 'Auto-continue is on. Nothing is waiting on a limit.';
    }
    const rows = pending.map((p) => `  ${p.name} — ${p.window} window, ${waitLabel(p, nowMs)}`);
    return [`Auto-continue will send ${JSON.stringify(settings.message)} to:`, ...rows, '', 'Click to cancel one.'].join('\n');
}
