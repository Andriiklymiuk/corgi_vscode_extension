import * as assert from 'node:assert';
import { InboxItem, elapsed, groupByWorkspace, itemDetail, itemName, kindLabel, openableUrl } from '../watchInbox';

const NOW = Date.parse('2026-09-10T18:00:00Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

describe('watchInbox', () => {
    it('names a row by its ref, and falls back to the key', () => {
        assert.strictEqual(itemName({ key: 'jira:ABC-1', ref: 'ABC-1' }), 'ABC-1');
        assert.strictEqual(itemName({ key: 'jira:ABC-1', ref: '  ' }), 'jira:ABC-1');
    });

    it('says what kind of thing it is in words that fit', () => {
        assert.strictEqual(kindLabel({ key: 'a', kind: 'issue.new' }), 'issue');
        assert.strictEqual(kindLabel({ key: 'a', kind: 'pr.review' }), 'PR review');
        assert.strictEqual(kindLabel({ key: 'a', kind: 'ci.failed' }), 'red build');
        assert.strictEqual(kindLabel({ key: 'a', kind: 'something.new' }), 'something.new');
    });

    it('shows the column it sits in and how long it has waited', () => {
        assert.strictEqual(itemDetail({ key: 'a', kind: 'issue.new', state: 'Ready', at: at(20) }, NOW), 'issue · Ready · 20m');
        assert.strictEqual(itemDetail({ key: 'a', kind: 'pr.review', at: at(90) }, NOW), 'PR review · 1h 30m');
        assert.strictEqual(itemDetail({ key: 'a', kind: 'issue.new' }, NOW), 'issue');
    });

    it('measures the wait, and says nothing when it cannot', () => {
        assert.strictEqual(elapsed(at(5), NOW), '5m');
        assert.strictEqual(elapsed(at(120), NOW), '2h');
        assert.strictEqual(elapsed(at(60 * 50), NOW), '2d');
        assert.strictEqual(elapsed(undefined, NOW), '');
        assert.strictEqual(elapsed('not a date', NOW), '');
    });

    it('only opens an https link', () => {
        assert.strictEqual(openableUrl({ key: 'a', url: 'https://x/browse/ABC-1' }), 'https://x/browse/ABC-1');
        assert.strictEqual(openableUrl({ key: 'a', url: 'javascript:alert(1)' }), undefined);
        assert.strictEqual(openableUrl({ key: 'a' }), undefined);
    });

    it('groups by workspace, newest first, and never loses a row', () => {
        const items: InboxItem[] = [
            { key: 'a', workspace: 'web', at: at(60) },
            { key: 'b', workspace: 'api', at: at(30) },
            { key: 'c', workspace: 'api', at: at(5) },
            { key: 'd', at: at(1) },
        ];
        const groups = groupByWorkspace(items);
        assert.deepStrictEqual(groups.map((g) => g.workspace), ['api', 'elsewhere', 'web']);
        assert.deepStrictEqual(groups[0].items.map((i) => i.key), ['c', 'b'], 'newest first inside a workspace');
        assert.strictEqual(groups.reduce((n, g) => n + g.items.length, 0), items.length);
    });
});

describe('blocked items and who said what', () => {
    it('a blocked item says why first; a comment says who', () => {
        assert.ok(itemDetail({ key: 'k', kind: 'issue.comment', blocked: '2 runs failed', state: 'Todo', at: new Date().toISOString() }, Date.now()).startsWith('comment · blocked: 2 runs failed'));
        assert.ok(itemDetail({ key: 'k', kind: 'pr.review', author: 'maria', body: 'nit: name', at: new Date().toISOString() }, Date.now()).includes('maria: nit: name'));
        assert.strictEqual(kindLabel({ key: 'k', kind: 'review.requested' }), 'review asked');
    });
});
