import * as assert from 'node:assert';
import { Board, BoardSession, boardTooltip, changesLine, formatElapsed, hideWorkspaces, isCrossing, isDrifting, isHiddenWorkspace, limitLine, lowestHeadroomAccount, matchTabByTitle, newlyNeedingInput, nextSession, overlapLine, sessionSummary, sortForPick, spendLine, statusBarText, testsLine } from '../agentBoard';

function session(id: string, status: string, extra: Partial<BoardSession> = {}): BoardSession {
    return { id, display: id, status, statusSince: '2026-09-08T10:00:00Z', host: { kind: 'vscode-terminal', windowId: 'w-other', shellPid: 1 }, ...extra };
}

describe('statusBarText', () => {
    it('shows working, needs input and the tightest 5h limit', () => {
        const board: Board = {
            working: 2, needsInput: 1, sessions: [],
            accounts: [
                { profile: 'default', limits: { fiveHour: { percent: 40 }, sevenDay: { percent: 10 } } },
                { profile: 'work', limits: { fiveHour: { percent: 62 }, sevenDay: { percent: 30 } } },
            ],
        };
        assert.strictEqual(statusBarText(board), '$(pulse) 2 · $(bell) 1 · 5h 62%');
    });

    it('drops the bell when nothing waits and the limit when no account reports one', () => {
        assert.strictEqual(statusBarText({ working: 0, needsInput: 0, sessions: [], accounts: null }), '$(pulse) 0');
    });

    it('counts sessions itself when the board has no totals', () => {
        const board: Board = { sessions: [session('a', 'working'), session('b', 'needs_input'), session('c', 'gone')] };
        assert.strictEqual(statusBarText(board), '$(pulse) 1 · $(bell) 1');
    });
});

describe('lowestHeadroomAccount', () => {
    it('picks the account with the highest 5h percent and ignores ones without limits', () => {
        const picked = lowestHeadroomAccount([
            { profile: 'a' },
            { profile: 'b', limits: { fiveHour: { percent: 20 } } },
            { profile: 'c', limits: { fiveHour: { percent: 80 } } },
        ]);
        assert.strictEqual(picked?.profile, 'c');
        assert.strictEqual(lowestHeadroomAccount([{ profile: 'a' }]), undefined);
    });
});

describe('sessionSummary and tooltip', () => {
    const now = new Date('2026-09-08T10:05:30Z');
    it('lists status, pending tool, detail, context and elapsed', () => {
        const s = session('api', 'needs_input', { detail: 'Bash', pending: { tool: 'Bash' }, context: { percent: 37 }, stuck: false });
        assert.strictEqual(sessionSummary(s, now), 'api — needs you / asks Bash / Bash / ctx 37% / 5m');
    });
    it('says so when the board is empty', () => {
        assert.strictEqual(boardTooltip({ sessions: [] }, now), 'corgi agent: no Claude Code sessions');
    });
    it('adds the account line', () => {
        const tip = boardTooltip({ sessions: [session('a', 'working')], accounts: [{ profile: 'default', limits: { fiveHour: { percent: 5 }, sevenDay: { percent: 9 } } }] }, now);
        assert.ok(tip.endsWith('default: 5h 5%, 7d 9%'), tip);
    });
});

describe('formatElapsed', () => {
    const now = new Date('2026-09-08T12:00:00Z');
    it('rounds to the largest unit', () => {
        assert.strictEqual(formatElapsed('2026-09-08T11:59:30Z', now), '30s');
        assert.strictEqual(formatElapsed('2026-09-08T11:15:00Z', now), '45m');
        assert.strictEqual(formatElapsed('2026-09-08T09:30:00Z', now), '2h 30m');
        assert.strictEqual(formatElapsed('2026-09-05T09:30:00Z', now), '3d');
        assert.strictEqual(formatElapsed(undefined, now), '');
        assert.strictEqual(formatElapsed('garbage', now), '');
    });
});

describe('sortForPick and nextSession', () => {
    it('puts the longest-waiting needs_input session first', () => {
        const board: Board = {
            frontSession: 'w',
            sessions: [
                session('w', 'working'),
                session('late', 'needs_input', { statusSince: '2026-09-08T10:30:00Z' }),
                session('early', 'needs_input', { statusSince: '2026-09-08T10:00:00Z' }),
            ],
        };
        assert.deepStrictEqual(sortForPick(board.sessions!).map((s) => s.id), ['early', 'late', 'w']);
        assert.strictEqual(nextSession(board)?.id, 'early');
    });
    it('falls back to the front session', () => {
        const board: Board = { frontSession: 'w', sessions: [session('w', 'working'), session('d', 'done')] };
        assert.strictEqual(nextSession(board)?.id, 'w');
        assert.strictEqual(nextSession({ sessions: [session('d', 'done')] }), undefined);
    });
});

describe('newlyNeedingInput', () => {
    it('reports a session from another window once per wait', () => {
        const seen = new Set<string>();
        const before: Board = { sessions: [session('a', 'working')] };
        const after: Board = { sessions: [session('a', 'needs_input')] };
        assert.deepStrictEqual(newlyNeedingInput(before, after, 'w-mine', seen).map((s) => s.id), ['a']);
        assert.deepStrictEqual(newlyNeedingInput(after, after, 'w-mine', seen), []);
        const again: Board = { sessions: [session('a', 'needs_input', { statusSince: '2026-09-08T11:00:00Z' })] };
        assert.deepStrictEqual(newlyNeedingInput(after, again, 'w-mine', seen).map((s) => s.id), ['a']);
    });
    it('skips sessions in this window and ones already waiting on the first read', () => {
        const seen = new Set<string>();
        const mine = session('m', 'needs_input', { host: { kind: 'vscode-terminal', windowId: 'w-mine' } });
        const other = session('o', 'needs_input');
        const first: Board = { sessions: [mine, other] };
        assert.deepStrictEqual(newlyNeedingInput(undefined, first, 'w-mine', seen), []);
        assert.deepStrictEqual(newlyNeedingInput(first, first, 'w-mine', seen), []);
        const fresh = session('n', 'needs_input');
        assert.deepStrictEqual(newlyNeedingInput(first, { sessions: [mine, other, fresh] }, 'w-mine', seen).map((s) => s.id), ['n']);
    });
});

describe('matchTabByTitle', () => {
    const tabs = [{ label: 'Claude Code' }, { label: 'Fix the login bug' }, { label: 'Refactor: sessions' }];
    it('prefers an exact label, then a prefix, then a substring', () => {
        assert.strictEqual(matchTabByTitle(tabs, 'Fix the login bug')?.label, 'Fix the login bug');
        assert.strictEqual(matchTabByTitle(tabs, 'refactor')?.label, 'Refactor: sessions');
        assert.strictEqual(matchTabByTitle(tabs, 'LOGIN')?.label, 'Fix the login bug');
        assert.strictEqual(matchTabByTitle(tabs, 'nothing like it'), undefined);
        assert.strictEqual(matchTabByTitle(tabs, '  '), undefined);
    });
});

describe('drift, limits and hidden workspaces', () => {
    it('limitLine says when the daemon continues, or that the API hiccuped', () => {
        const soon = new Date(Date.now() + 3_600_000).toISOString();
        assert.ok(limitLine({ id: 'a', status: 'limited', resumeAt: soon, resumes: 2 }).startsWith('continues '));
        assert.ok(limitLine({ id: 'a', status: 'limited', resumeAt: soon, resumes: 2 }).endsWith('· 2 so far'));
        assert.strictEqual(limitLine({ id: 'a', status: 'limited', limit: 'overload' }), 'API overloaded — retried on its own');
        assert.strictEqual(limitLine({ id: 'a', status: 'limited', resumeAt: '0001-01-01T00:00:00Z' }), '', 'a zero time is not a time');
        assert.strictEqual(limitLine({ id: 'a', status: 'working', resumeAt: soon }), '');
    });

    it('a hidden workspace takes its sessions and the counts with it', () => {
        const board = {
            needsInput: 1, working: 1, frontSession: 'a',
            sessions: [
                { id: 'a', label: 'secret', cwd: '/home/me/dev/secret', status: 'needs_input' },
                { id: 'b', label: 'api', cwd: '/home/me/dev/api', status: 'working' },
            ],
        };
        const hidden = hideWorkspaces(board, ['secret']);
        assert.deepStrictEqual(hidden?.sessions?.map((s) => s.id), ['b']);
        assert.strictEqual(hidden?.needsInput, 0);
        assert.strictEqual(hidden?.working, 1);
        assert.strictEqual(hidden?.frontSession, undefined);
        assert.strictEqual(hideWorkspaces(board, []), board, 'nothing hidden, the same board');
        assert.ok(isHiddenWorkspace('/home/me/dev/secret', ['secret']), 'by the folder\'s last path component too');
        assert.ok(isDrifting({ id: 'a', drift: ['context 91% full'] }));
        assert.ok(!isDrifting({ id: 'a', drift: [] }));
    });

    it('the branch, the crossing and the last test run each read as one line', () => {
        const s = {
            id: 'a', display: 'api', status: 'working',
            changes: { files: 4, lines: 120, touched: ['registry.go', 'a.go'] },
            overlap: [{ id: 'b', session: 'api·2', files: ['registry.go', 'b.go', 'c.go'] }],
            tests: { ok: false, cmd: 'go test' },
        };
        assert.strictEqual(changesLine(s), '4 files · 120 lines');
        assert.ok(isCrossing(s));
        assert.strictEqual(overlapLine(s), 'api·2 on registry.go, b.go, …');
        assert.strictEqual(testsLine(s), 'tests ✗ go test');
        assert.strictEqual(overlapLine({ id: 'b', overlap: [{ id: 'a', session: 'api', sameCheckout: true }] }), 'same checkout as api');
        assert.strictEqual(testsLine({ id: 'c', tests: { ok: true, cmd: 'bun test' } }), 'tests ✓');
        assert.strictEqual(changesLine({ id: 'c', changes: { files: 0, lines: 0 } }), '', 'an empty diff is no line');
        assert.ok(!isCrossing({ id: 'c' }));
        const summary = sessionSummary(s);
        assert.ok(summary.includes('4 files · 120 lines') && summary.includes('tests ✗ go test') && summary.includes('⚠ api·2 on registry.go'), summary);
    });

    it('what it has cost reads as one word, and says over budget once it passed its cap', () => {
        assert.strictEqual(spendLine({ id: 'a' }), '');
        assert.strictEqual(spendLine({ id: 'a', spend: { tokens: 52_300_000 } }), '52.3M');
        assert.strictEqual(spendLine({ id: 'a', spend: { tokens: 980_000 } }), '980k');
        assert.strictEqual(spendLine({ id: 'a', spend: { tokens: 52_300_000 }, cap: 50_000_000, overCap: true }), '52.3M over budget');
        assert.ok(sessionSummary({ id: 'a', display: 'api', status: 'working', spend: { tokens: 1_200_000 }, overCap: true }).includes('1.2M over budget'));
    });
});
