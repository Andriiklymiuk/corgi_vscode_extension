import * as assert from 'node:assert';
import { Board } from '../agentBoard';
import { autoContinueDefaults, dueNow, limitedSessions, planContinues, queueTooltip, statusText, waitLabel } from '../autoContinue';

const NOW = Date.parse('2026-09-10T10:00:00Z');
const IN_AN_HOUR = new Date(NOW + 3600_000).toISOString();
const IN_TWO_DAYS = new Date(NOW + 48 * 3600_000).toISOString();

function board(extra: Partial<Board> = {}): Board {
    return {
        sessions: [
            { id: 's-limited', display: 'api', status: 'limited', profile: 'work' },
            { id: 's-working', display: 'web', status: 'working', profile: 'work' },
            { id: 's-gone', display: 'old', status: 'gone', profile: 'work' },
        ],
        accounts: [
            { profile: 'work', limits: { fiveHour: { percent: 100, resetsAt: IN_AN_HOUR }, sevenDay: { percent: 60, resetsAt: IN_TWO_DAYS } } },
        ],
        ...extra,
    };
}

describe('autoContinue', () => {
    it('only a limited session is queued, at its soonest reset', () => {
        assert.deepStrictEqual(limitedSessions(board()).map((s) => s.id), ['s-limited']);

        const pending = planContinues(board(), new Set());
        assert.strictEqual(pending.length, 1);
        assert.strictEqual(pending[0].sessionId, 's-limited');
        assert.strictEqual(pending[0].name, 'api');
        assert.strictEqual(pending[0].window, '5h', 'the nearer window is what it waits on');
        assert.strictEqual(pending[0].resetsAt, IN_AN_HOUR);
    });

    it('a cancelled session is not queued', () => {
        assert.deepStrictEqual(planContinues(board(), new Set(['s-limited'])), []);
    });

    it('a session with no known reset time is left alone', () => {
        assert.deepStrictEqual(planContinues(board({ accounts: [] }), new Set()), []);
        assert.deepStrictEqual(planContinues(board({ accounts: [{ profile: 'work', limits: {} }] }), new Set()), []);
        assert.deepStrictEqual(planContinues(undefined, new Set()), []);
    });

    it('a single account covers a session with no profile of its own', () => {
        const b = board({ sessions: [{ id: 's1', display: 'api', status: 'limited' }] });
        assert.strictEqual(planContinues(b, new Set()).length, 1);

        const two = board({
            sessions: [{ id: 's1', display: 'api', status: 'limited' }],
            accounts: [
                { profile: 'work', limits: { fiveHour: { resetsAt: IN_AN_HOUR } } },
                { profile: 'personal', limits: { fiveHour: { resetsAt: IN_AN_HOUR } } },
            ],
        });
        assert.deepStrictEqual(planContinues(two, new Set()), [], 'two accounts and no profile: guessing would resume the wrong one');
    });

    it('queued sessions come out soonest first', () => {
        const b = board({
            sessions: [
                { id: 'later', display: 'later', status: 'limited', profile: 'week' },
                { id: 'sooner', display: 'sooner', status: 'limited', profile: 'hour' },
            ],
            accounts: [
                { profile: 'week', limits: { sevenDay: { resetsAt: IN_TWO_DAYS } } },
                { profile: 'hour', limits: { fiveHour: { resetsAt: IN_AN_HOUR } } },
            ],
        });
        assert.deepStrictEqual(planContinues(b, new Set()).map((p) => p.sessionId), ['sooner', 'later']);
    });

    it('nothing is due before the reset, and grace holds it past it', () => {
        const pending = planContinues(board(), new Set());
        assert.deepStrictEqual(dueNow(pending, NOW, 60), [], 'an hour early');
        assert.deepStrictEqual(dueNow(pending, Date.parse(IN_AN_HOUR), 60), [], 'the grace has not passed');
        assert.strictEqual(dueNow(pending, Date.parse(IN_AN_HOUR) + 61_000, 60).length, 1);
        assert.strictEqual(dueNow(pending, Date.parse(IN_AN_HOUR), 0).length, 1, 'zero grace fires on the dot');
    });

    it('the wait reads as a person would say it', () => {
        const [p] = planContinues(board(), new Set());
        assert.strictEqual(waitLabel(p, NOW), 'in 1h');
        assert.strictEqual(waitLabel(p, NOW + 3000_000), 'in 10m');
        assert.strictEqual(waitLabel(p, Date.parse(IN_AN_HOUR)), 'now');
        assert.strictEqual(waitLabel({ ...p, resetsAtMs: NOW + 5400_000 }, NOW), 'in 1h 30m');
        assert.strictEqual(waitLabel({ ...p, resetsAtMs: NOW + 7200_000 }, NOW), 'in 2h');
    });

    it('the status bar shows the count and the next wait, and hides when empty', () => {
        const pending = planContinues(board(), new Set());
        assert.strictEqual(statusText([], NOW), undefined);
        assert.match(statusText(pending, NOW)!, /api in 1h/);

        const two = [...pending, { ...pending[0], sessionId: 'x', name: 'web' }];
        assert.match(statusText(two, NOW)!, /2 queued, next in 1h/);
    });

    it('the tooltip says what will be sent, and says so when it is off', () => {
        const pending = planContinues(board(), new Set());
        const on = { ...autoContinueDefaults, enabled: true };
        const tip = queueTooltip(pending, NOW, on);
        assert.match(tip, /"continue"/);
        assert.match(tip, /api — 5h window, in 1h/);
        assert.match(queueTooltip([], NOW, on), /Nothing is waiting/);
        assert.match(queueTooltip(pending, NOW, autoContinueDefaults), /off/);
    });
});
