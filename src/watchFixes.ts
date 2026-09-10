import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The fix log corgi's watch writes at <agent dir>/watch/fixes.json: what the
 * unattended mode is working on, and what it opened. A fix takes minutes, so
 * this is the only place a long run is visible while it is still running —
 * its notification only arrives once it is over. Pure logic, no vscode
 * import, so it unit tests.
 */

export interface FixRecord {
    key: string;
    workspace?: string;
    ref?: string;
    kind?: string;
    title?: string;
    url?: string;
    startedAt?: string;
    finishedAt?: string;
    prs?: string[];
    note?: string;
    error?: string;
}

interface FixLogFile {
    started?: FixRecord[] | null;
}

export function fixesPath(agentDir: string): string {
    return path.join(agentDir, 'watch', 'fixes.json');
}

export function readFixes(file: string): FixRecord[] {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as FixLogFile;
        return Array.isArray(parsed?.started) ? parsed.started.filter((r) => r && r.key) : [];
    } catch {
        return [];
    }
}

export function isRunning(r: FixRecord): boolean {
    return !r.finishedAt;
}

export function fixName(r: FixRecord): string {
    return r.ref || r.key;
}

/** Newest first. A run with no start time sorts last rather than first. */
export function newestFirst(fixes: readonly FixRecord[]): FixRecord[] {
    const at = (r: FixRecord) => (r.startedAt ? Date.parse(r.startedAt) : 0) || 0;
    return [...fixes].sort((a, b) => at(b) - at(a));
}

export function running(fixes: readonly FixRecord[]): FixRecord[] {
    return newestFirst(fixes).filter(isRunning);
}

/**
 * recent is what to show when nothing is running: the finished runs, newest
 * first, capped. A run older than maxAgeMs is history, not news.
 */
export function recent(fixes: readonly FixRecord[], nowMs: number, maxAgeMs = 12 * 3600_000, limit = 8): FixRecord[] {
    return newestFirst(fixes)
        .filter((r) => !isRunning(r) && nowMs - (Date.parse(r.startedAt ?? '') || 0) <= maxAgeMs)
        .slice(0, limit);
}

/** "4m" / "2h 10m" — how long a run has been going, or how long it took. */
export function elapsed(r: FixRecord, nowMs: number): string {
    const start = Date.parse(r.startedAt ?? '');
    if (!Number.isFinite(start)) {
        return '';
    }
    const end = r.finishedAt ? Date.parse(r.finishedAt) : nowMs;
    const minutes = Math.max(0, Math.round(((Number.isFinite(end) ? end : nowMs) - start) / 60000));
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const rest = minutes % 60;
    return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${Math.floor(minutes / 60)}h`;
}

/** What a finished run ended up doing, in a few words. */
export function outcome(r: FixRecord): string {
    if (isRunning(r)) {
        return 'running';
    }
    if (r.error) {
        return r.error;
    }
    if (r.prs?.length) {
        return r.prs.length === 1 ? 'opened 1 PR' : `opened ${r.prs.length} PRs`;
    }
    return r.note || 'done, nothing opened';
}

export function statusText(fixes: readonly FixRecord[], nowMs: number): string | undefined {
    const live = running(fixes);
    if (live.length === 1) {
        return `$(sync~spin) ${fixName(live[0])} ${elapsed(live[0], nowMs)}`;
    }
    if (live.length > 1) {
        return `$(sync~spin) ${live.length} fixes running`;
    }
    // Nothing running: say what came out of the last few, and only briefly.
    const done = recent(fixes, nowMs);
    const withPRs = done.filter((r) => r.prs?.length).length;
    if (withPRs) {
        return `$(git-pull-request) ${withPRs} from the watch`;
    }
    const failed = done.filter((r) => r.error).length;
    return failed ? `$(warning) ${failed} fix${failed > 1 ? 'es' : ''} failed` : undefined;
}

export function tooltip(fixes: readonly FixRecord[], nowMs: number): string {
    const live = running(fixes);
    const done = recent(fixes, nowMs);
    if (!live.length && !done.length) {
        return 'corgi agent watch has not worked on anything.';
    }
    const rows: string[] = [];
    for (const r of live) {
        rows.push(`  ${fixName(r)} — running ${elapsed(r, nowMs)}`);
    }
    for (const r of done) {
        rows.push(`  ${fixName(r)} — ${outcome(r)} (${elapsed(r, nowMs)})`);
    }
    return ['corgi agent watch, unattended:', ...rows, '', 'Click to open a pull request or its log.'].join('\n');
}

/** Every pull request the shown runs opened, newest first, deduped. */
export function pullRequests(fixes: readonly FixRecord[], nowMs: number): { ref: string; url: string }[] {
    const out: { ref: string; url: string }[] = [];
    const seen = new Set<string>();
    for (const r of [...running(fixes), ...recent(fixes, nowMs)]) {
        for (const url of r.prs ?? []) {
            if (!/^https:\/\//.test(url) || seen.has(url)) {
                continue;
            }
            seen.add(url);
            out.push({ ref: fixName(r), url });
        }
    }
    return out;
}
