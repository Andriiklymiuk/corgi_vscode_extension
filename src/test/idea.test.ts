import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterLine, anchorFor, authorName, epicRef, findQuote, forAgentCount, headingAbove, ideaCounts, ideaSlugOf, IdeaComment, lineRangeOf, lineStart, listIdeas, openCount, openUnder, readIdea, sendTargets,
    sentLabel, statusLabel, timeAgo, titleOf, typeLabel, waitsOnAgent, waitsOnPerson,
} from '../idea';

const page = `# Coffee shop scheduling

## Who it is for

The owner and the baristas. The owner sets the shifts.

## Shifts

The owner sets the shifts a week ahead. Baristas swap shifts between
themselves, and the owner approves a swap.
`;

const c = (over: Partial<IdeaComment>): IdeaComment => ({ id: 'c1', kind: 'comment', by: 'ann', text: 'hm', status: 'open', at: '2026-10-24T10:00:00Z', ...over });

describe('idea', () => {
    it('finds a quote that is on the page once', () => {
        const hit = findQuote(page, { quote: 'swap shifts' });
        assert.deepStrictEqual(hit, { start: page.indexOf('swap shifts'), end: page.indexOf('swap shifts') + 'swap shifts'.length });
        assert.strictEqual(findQuote(page, { quote: 'nowhere on the page' }), null);
        assert.strictEqual(findQuote(page, undefined), null);
        assert.strictEqual(findQuote(page, { quote: '' }), null);
    });
    it('picks the copy whose prefix and suffix match, like a text-quote selector', () => {
        const quote = 'The owner sets the shifts';
        const first = page.indexOf(quote);
        const second = page.indexOf(quote, first + 1);
        assert.ok(second > first);
        assert.strictEqual(findQuote(page, { quote })!.start, first, 'no context: the first');
        assert.strictEqual(findQuote(page, { quote, prefix: '## Shifts\n\n', suffix: ' a week ahead' })!.start, second);
        assert.strictEqual(findQuote(page, { quote, prefix: 'baristas. ', suffix: '.\n\n## Shifts' })!.start, first);
    });
    it('forgives whitespace when the exact words are gone', () => {
        const hit = findQuote(page, { quote: 'Baristas swap shifts between themselves' })!;
        assert.ok(hit);
        assert.strictEqual(page.slice(hit.start, hit.end), 'Baristas swap shifts between\nthemselves');
    });
    it('builds an anchor with forty characters of context and the heading above', () => {
        const start = page.indexOf('approves a swap');
        const a = anchorFor(page, start, start + 'approves a swap'.length);
        assert.strictEqual(a.quote, 'approves a swap');
        assert.strictEqual(a.prefix!.length, 40);
        assert.ok(a.prefix!.endsWith('the owner '));
        assert.strictEqual(a.suffix, '.\n');
        assert.strictEqual(a.heading, 'Shifts');
        assert.strictEqual(anchorFor(page, 0, 6).prefix, '');
        assert.strictEqual(anchorFor(page, 0, 6).heading, '');
        assert.strictEqual(headingAbove(page, page.indexOf('baristas.')), 'Who it is for');
        // The anchor finds its own words again.
        assert.deepStrictEqual(findQuote(page, a), { start, end: start + 'approves a swap'.length });
    });
    it('turns offsets into lines, zero-based, and back', () => {
        assert.deepStrictEqual(lineRangeOf(page, 0, 5), { startLine: 0, endLine: 0 });
        const start = page.indexOf('Baristas swap');
        const end = page.indexOf('a swap.') + 'a swap.'.length;
        assert.deepStrictEqual(lineRangeOf(page, start, end), { startLine: 8, endLine: 9 });
        // A selection that ends right after the newline stays on its line.
        assert.deepStrictEqual(lineRangeOf(page, 0, page.indexOf('\n') + 1), { startLine: 0, endLine: 0 });
        assert.strictEqual(lineStart(page, 2), page.indexOf('## Who'));
        assert.strictEqual(lineStart(page, 99), page.length);
    });
    it('tells a proposal waiting on a person from a comment waiting on the agent', () => {
        const proposal = c({ kind: 'proposal', by: 'agent' });
        assert.ok(waitsOnPerson(proposal));
        assert.ok(!waitsOnAgent(proposal));
        const accepted = c({ kind: 'proposal', by: 'agent', replies: [{ id: 'r1', by: 'ann', text: 'yes', at: '2026-10-24T10:01:00Z' }] });
        assert.ok(!waitsOnPerson(accepted));
        assert.ok(waitsOnAgent(accepted));
        assert.ok(waitsOnAgent(c({})));
        assert.ok(!waitsOnAgent(c({ status: 'answered' })));
        assert.strictEqual(openCount([c({}), c({ status: 'fixed' }), c({ status: 'resolved' })]), 2);
        assert.strictEqual(forAgentCount([c({}), proposal, c({ status: 'resolved' })]), 1);
    });
    it('has words for statuses, counts and times', () => {
        assert.strictEqual(statusLabel('fixed'), 'changed the page');
        assert.strictEqual(statusLabel(undefined), 'open');
        assert.strictEqual(ideaCounts(3, 1), '3 open · 1 waiting on the agent');
        assert.strictEqual(ideaCounts(0, 0), '0 open');
        const now = new Date('2026-10-24T12:00:00Z');
        assert.strictEqual(timeAgo('2026-10-24T11:59:30Z', now), 'just now');
        assert.strictEqual(timeAgo('2026-10-24T09:50:00Z', now), '2h 10m');
        assert.strictEqual(timeAgo(undefined, now), '');
        assert.strictEqual(authorName('', 'ann'), 'ann');
        assert.strictEqual(authorName(' Ann B ', 'ann'), 'Ann B');
        assert.strictEqual(titleOf(page), 'Coffee shop scheduling');
    });
    it('names the type, the epic, the destinations and what a ticket waits on', () => {
        assert.deepStrictEqual(['idea', 'spec', 'hld', 'rfc', undefined, 'odd'].map(typeLabel), ['idea', 'spec', 'HLD', 'RFC', 'idea', 'idea']);
        const sent = [{ kind: 'ticket', ref: 'SHOP-13', url: 'https://j/13' }, { kind: 'epic', ref: 'SHOP-12', title: 'BrewShift' }, { kind: 'page', ref: '99' }];
        assert.strictEqual(epicRef(sent), 'SHOP-12');
        assert.strictEqual(epicRef(undefined), '');
        assert.strictEqual(sentLabel(sent[1]), '🎯 SHOP-12 · BrewShift');
        assert.strictEqual(sentLabel(sent[2]), '📄 page 99');
        assert.deepStrictEqual(sendTargets({ jira: { project: 'SHOP', site: 'acme.atlassian.net' }, confluence: { site: 'acme' } }).map((t) => [t.to, t.project, t.site]), [['jira', 'SHOP', 'acme.atlassian.net'], ['confluence', '', 'acme']]);
        assert.deepStrictEqual(sendTargets({ linear: {} }).map((t) => [t.to, t.project]), [['linear', '']]);
        assert.deepStrictEqual(sendTargets(null), []);
        assert.strictEqual(afterLine({ id: 3, title: 't', after: [1, 2] }), 'after 1, 2');
        assert.strictEqual(afterLine({ id: 1, title: 't' }), '');
        const comments = [c({ id: 1, anchor: { quote: 'x', heading: 'Infra' } }), c({ id: 2, status: 'resolved', anchor: { quote: 'y', heading: 'Infra' } }), c({ id: 3, anchor: { quote: 'z', heading: 'Data' } })];
        assert.strictEqual(openUnder(comments, 'Infra'), 1);
        assert.strictEqual(openUnder(comments, 'data'), 1);
        assert.strictEqual(openUnder(comments, 'Screens'), 0);
    });
    it('reads an idea from its folder and lists the folder', () => {
        const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corgi-idea-'));
        const ideas = path.join(agentDir, 'ideas');
        const dir = path.join(ideas, 'coffee');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'idea.md'), page);
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ slug: 'coffee', title: 'Coffee', status: 'draft', updatedAt: '2026-10-24T10:00:00Z' }));
        fs.writeFileSync(path.join(dir, 'comments.json'), JSON.stringify({ next: 3, comments: [c({ id: 1 }), c({ id: 2, kind: 'proposal', by: 'agent' }), { text: 'no id' }] }));
        fs.mkdirSync(path.join(ideas, 'bare'));
        fs.writeFileSync(path.join(ideas, 'bare', 'idea.md'), '# Bare\n');
        fs.writeFileSync(path.join(ideas, 'changed'), '');
        try {
            const idea = readIdea(ideas, 'coffee')!;
            assert.strictEqual(idea.meta.title, 'Coffee');
            assert.deepStrictEqual(idea.comments.map((x) => x.id), [1, 2], 'numeric ids, as corgi writes them; a comment without one is dropped');
            assert.strictEqual(idea.file, path.join(dir, 'idea.md'));
            const bare = readIdea(ideas, 'bare')!;
            assert.deepStrictEqual(bare.meta, { slug: 'bare', title: 'Bare', status: 'draft' });
            assert.strictEqual(readIdea(ideas, 'missing'), undefined);
            assert.strictEqual(readIdea(ideas, '../coffee'), undefined);
            const list = listIdeas(ideas);
            assert.deepStrictEqual(list.map((i) => [i.slug, i.open, i.forAgent]), [['coffee', 2, 1], ['bare', 0, 0]]);
            assert.strictEqual(ideaSlugOf(agentDir, idea.file), 'coffee');
            assert.strictEqual(ideaSlugOf(agentDir, path.join(dir, 'meta.json')), undefined);
            assert.strictEqual(ideaSlugOf(agentDir, path.join(agentDir, 'idea.md')), undefined);
        } finally {
            fs.rmSync(agentDir, { recursive: true, force: true });
        }
    });
});
