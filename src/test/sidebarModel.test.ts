import * as assert from 'node:assert';
import { build, inboxRow, sessionRow, usageWindows } from '../sidebarModel';
import type { Board, BoardSession } from '../agentBoard';

const now = new Date('2026-09-16T10:00:00Z');
const s = (over: Partial<BoardSession>): BoardSession => ({ id: 'a', label: 'api', status: 'working', statusSince: '2026-09-16T09:50:00Z', ...over });

describe('sidebarModel', () => {
    it('draws two usage windows with when they reset', () => {
        const w = usageWindows({ profile: 'p', limits: { fiveHour: { percent: 12, resetsAt: '2026-09-16T13:00:00Z' }, sevenDay: { percent: 75, resetsAt: '2026-09-21T10:00:00Z' } } }, now);
        assert.deepStrictEqual(w.map((x) => [x.name, x.percent, x.resets]), [['5h', 12, 'resets in 3h'], ['7d', 75, 'resets in 5d']]);
    });
    it('says when the forecast runs out', () => {
        const w = usageWindows({ profile: 'p', limits: { fiveHour: { percent: 40 } }, forecast: { fiveHour: { safe: false, exhaustAt: '2026-09-16T11:30:00Z' } } }, now);
        assert.ok(w[0].warn.startsWith('runs out '));
        assert.strictEqual(w.length, 1);
    });
    it('clamps a percent past 100', () => {
        assert.strictEqual(usageWindows({ profile: 'p', limits: { fiveHour: { percent: 140 } } }, now)[0].percent, 100);
    });
    it('ranks a pending session as ask with allow in can', () => {
        const r = sessionRow(s({ status: 'needs_input', pending: { tool: 'Bash' } }), [], now);
        assert.strictEqual(r.tone, 'ask');
        assert.ok(r.can.includes('allow'));
        assert.ok(r.clause.startsWith('needs you · asks Bash'));
        assert.strictEqual(r.elapsed, '10m');
    });
    it('ranks a drifting session as bad with fresh in can', () => {
        const r = sessionRow(s({ drift: ['context 92%'] }), [], now);
        assert.strictEqual(r.tone, 'bad');
        assert.ok(r.can.includes('fresh'));
        assert.ok(r.clause.startsWith('drifting · context 92%'));
        assert.ok(r.tooltip.includes('drifting:\ncontext 92%'));
    });
    it('adds pr when the session linked one', () => {
        assert.ok(sessionRow(s({ pr: 'https://x/pr/1' }), [], now).can.includes('pr'));
    });
    it('marks a crossing session and names the other one', () => {
        const r = sessionRow(s({ overlap: [{ session: 'api·2', files: ['a.go'] }] }), [], now);
        assert.ok(r.crossing);
        assert.ok(r.clause.includes('api·2 on a.go'));
    });
    it('uses the bot title when the session runs as a bot', () => {
        assert.strictEqual(sessionRow(s({ bot: 'reviewer' }), [{ name: 'reviewer', title: 'Reviewer bot', workspace: 'api' }], now).title, 'Reviewer bot');
    });
    it('puts the branch, the diff, the tests and the context on the clause', () => {
        const r = sessionRow(s({ branch: 'feat/x', changes: { files: 2, lines: 39 }, tests: { ok: true }, context: { percent: 63 } }), [], now);
        assert.strictEqual(r.clause, 'working · feat/x · 2 files · 39 lines · tests ✓ · ctx 63%');
    });
    it('groups sessions by workspace only when there are two', () => {
        const one: Board = { sessions: [s({ id: '1' })] };
        const two: Board = { sessions: [s({ id: '1' }), s({ id: '2', label: 'web' })] };
        assert.deepStrictEqual(build(one, [], [], [], now).sessions.map((g) => g.workspace), ['']);
        assert.deepStrictEqual(build(two, [], [], [], now).sessions.map((g) => g.workspace), ['api', 'web']);
    });
    it('puts needs-input first inside a workspace', () => {
        const b: Board = { sessions: [s({ id: '1' }), s({ id: '2', status: 'needs_input' })] };
        assert.deepStrictEqual(build(b, [], [], [], now).sessions[0].rows.map((r) => r.id), ['2', '1']);
    });
    it('drops hidden workspaces and counts the rest', () => {
        const b: Board = { sessions: [s({ id: '1' }), s({ id: '2', label: 'web', status: 'needs_input' }), s({ id: '3', status: 'done' })] };
        const st = build(b, [], ['web'], [], now);
        assert.strictEqual(st.sessions[0].rows.length, 2);
        assert.deepStrictEqual(st.counts, { inbox: 0, active: 1 });
    });
    it('leaves out an account without limits', () => {
        const b: Board = { accounts: [{ profile: 'a' }, { profile: 'b', limits: { fiveHour: { percent: 5 } } }] };
        assert.deepStrictEqual(build(b, [], [], [], now).accounts.map((a) => a.profile), ['b']);
    });
    it('marks a blocked inbox row bad with unblock, and an issue with work', () => {
        const r = inboxRow({ key: 'k', ref: 'IMP-1', kind: 'issue.new', blocked: 'breaker', url: 'https://t/1' }, now.getTime());
        assert.strictEqual(r.tone, 'bad');
        assert.deepStrictEqual(r.can, ['work', 'open', 'ignore', 'unblock']);
        assert.strictEqual(r.url, 'https://t/1');
        assert.strictEqual(r.name, 'IMP-1');
    });
    it('gives a pull request row the pr action', () => {
        assert.ok(inboxRow({ key: 'k', kind: 'pr.review', pr: 'https://g/p/1' }, now.getTime()).can.includes('pr'));
    });
    it('keeps the wait on the right, not twice', () => {
        const r = inboxRow({ key: 'k', kind: 'issue.new', at: '2026-09-16T08:00:00Z' }, now.getTime());
        assert.strictEqual(r.elapsed, '2h');
        assert.ok(!r.detail.endsWith('2h'));
    });
    it('groups the inbox by workspace only when there are two', () => {
        const st = build(undefined, [{ key: 'a', workspace: 'api' }, { key: 'b', workspace: 'web' }], [], [], now);
        assert.deepStrictEqual(st.inbox.map((g) => g.workspace), ['api', 'web']);
        assert.strictEqual(st.counts.inbox, 2);
    });
});
