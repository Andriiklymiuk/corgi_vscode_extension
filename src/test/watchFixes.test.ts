import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    FixRecord, elapsed, fixName, fixesPath, newestFirst, outcome, pullRequests, readFixes, recent, running, statusText, tooltip,
} from '../watchFixes';

const NOW = Date.parse('2026-09-10T12:00:00Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function fix(key: string, extra: Partial<FixRecord> = {}): FixRecord {
    return { key, ref: key.toUpperCase(), workspace: 'api', startedAt: at(10), ...extra };
}

describe('watchFixes', () => {
    it('reads the log, and survives one that is missing or broken', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corgi-fixes-'));
        const file = fixesPath(dir);
        assert.deepStrictEqual(readFixes(file), [], 'a missing file is no fixes, not a crash');

        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'not json');
        assert.deepStrictEqual(readFixes(file), [], 'a half-written file is no fixes');

        fs.writeFileSync(file, JSON.stringify({ started: [fix('a'), { workspace: 'x' }, null] }));
        const got = readFixes(file);
        assert.strictEqual(got.length, 1, 'a row with no key is not a fix');
        assert.strictEqual(got[0].key, 'a');

        fs.writeFileSync(file, JSON.stringify({}));
        assert.deepStrictEqual(readFixes(file), [], 'no started array is no fixes');
    });

    it('sorts newest first and splits running from finished', () => {
        const fixes = [
            fix('old', { startedAt: at(120), finishedAt: at(118) }),
            fix('live', { startedAt: at(4) }),
            fix('recent', { startedAt: at(30), finishedAt: at(28) }),
        ];
        assert.deepStrictEqual(newestFirst(fixes).map((r) => r.key), ['live', 'recent', 'old']);
        assert.deepStrictEqual(running(fixes).map((r) => r.key), ['live']);
        assert.deepStrictEqual(recent(fixes, NOW).map((r) => r.key), ['recent', 'old']);
    });

    it('forgets a finished run once it is old news', () => {
        const stale = [fix('yesterday', { startedAt: at(60 * 20), finishedAt: at(60 * 20 - 2) })];
        assert.deepStrictEqual(recent(stale, NOW), [], 'older than the window is history');
        assert.strictEqual(recent(stale, NOW, 24 * 3600_000).length, 1, 'a wider window keeps it');
    });

    it('says how long a run has taken, running or finished', () => {
        assert.strictEqual(elapsed(fix('a', { startedAt: at(4) }), NOW), '4m');
        assert.strictEqual(elapsed(fix('a', { startedAt: at(90) }), NOW), '1h 30m');
        assert.strictEqual(elapsed(fix('a', { startedAt: at(120) }), NOW), '2h');
        assert.strictEqual(elapsed(fix('a', { startedAt: at(50), finishedAt: at(44) }), NOW), '6m', 'a finished run is measured to its end');
        assert.strictEqual(elapsed({ key: 'a' }, NOW), '', 'no start time, nothing to say');
    });

    it('describes what a run ended up doing', () => {
        assert.strictEqual(outcome(fix('a')), 'running');
        assert.strictEqual(outcome(fix('a', { finishedAt: at(1), prs: ['https://x/pull/1'] })), 'opened 1 PR');
        assert.strictEqual(outcome(fix('a', { finishedAt: at(1), prs: ['https://x/pull/1', 'https://x/pull/2'] })), 'opened 2 PRs');
        assert.strictEqual(outcome(fix('a', { finishedAt: at(1), error: 'timed out' })), 'timed out');
        assert.strictEqual(outcome(fix('a', { finishedAt: at(1), note: 'no change needed' })), 'no change needed');
        assert.strictEqual(outcome(fix('a', { finishedAt: at(1) })), 'done, nothing opened');
        assert.strictEqual(fixName({ key: 'jira:ABC-1' }), 'jira:ABC-1', 'the key stands in for a missing ref');
    });

    it('the status bar spins while running, then reports, then goes quiet', () => {
        assert.strictEqual(statusText([], NOW), undefined);

        const one = statusText([fix('hum-1338', { startedAt: at(7) })], NOW)!;
        assert.match(one, /sync~spin/);
        assert.match(one, /HUM-1338 7m/);

        assert.match(statusText([fix('a', { startedAt: at(2) }), fix('b', { startedAt: at(1) })], NOW)!, /2 fixes running/);

        const opened = [fix('a', { finishedAt: at(9), prs: ['https://x/pull/1'] })];
        assert.match(statusText(opened, NOW)!, /git-pull-request\) 1 from the watch/);

        assert.match(statusText([fix('a', { finishedAt: at(9), error: 'boom' })], NOW)!, /1 fix failed/);
        assert.strictEqual(statusText([fix('a', { finishedAt: at(9), note: 'no change' })], NOW), undefined,
            'a quiet, uneventful run is not worth a status bar item');
    });

    it('the tooltip lists the runs, and says so when there are none', () => {
        assert.match(tooltip([], NOW), /has not worked on anything/);
        const tip = tooltip([fix('live', { startedAt: at(3) }), fix('done', { finishedAt: at(20), prs: ['https://x/pull/1'] })], NOW);
        assert.match(tip, /LIVE — running 3m/);
        assert.match(tip, /DONE — opened 1 PR/);
    });

    it('collects the pull requests, deduped, and ignores anything that is not a url', () => {
        const fixes = [
            fix('a', { finishedAt: at(5), prs: ['https://x/pull/1', 'https://x/pull/1', 'javascript:alert(1)'] }),
            fix('b', { finishedAt: at(6), prs: ['https://y/-/merge_requests/2'] }),
        ];
        assert.deepStrictEqual(pullRequests(fixes, NOW).map((p) => p.url),
            ['https://x/pull/1', 'https://y/-/merge_requests/2']);
    });
});
