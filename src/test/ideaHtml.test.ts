import * as assert from 'node:assert';
import { ideaPage, sharedFunctions, sharedScript } from '../ideaHtml';
import { findQuote, waitsOnPerson } from '../idea';
import { formatElapsed } from '../agentBoard';

describe('idea page', () => {
    const html = ideaPage('abc123', 'vscode-webview://x');
    it('locks scripts to the nonce and images to the webview', () => {
        assert.ok(html.includes(`script-src 'nonce-abc123'`));
        assert.ok(html.includes(`<script nonce="abc123">`));
        assert.ok(html.includes(`default-src 'none'`));
        assert.ok(html.includes(`img-src vscode-webview://x data:`));
        assert.ok(ideaPage('n').includes(`img-src 'none'`));
    });
    it('sets innerHTML once, for the page corgi rendered, and nowhere else', () => {
        const uses = html.split('innerHTML').length - 1;
        assert.strictEqual(uses, 1);
        assert.ok(html.includes('page.innerHTML = String(doc.html'));
    });
    it('has the article, the comments, the composer and the floating Comment button', () => {
        for (const id of ['page', 'hand', 'filter', 'composer', 'comments', 'float', 'answering', 'buildTop', 'progress', 'outline', 'tickets', 'sent', 'type']) {
            assert.ok(html.includes(`id="${id}"`), id);
        }
    });
    it('speaks every message the host understands', () => {
        for (const type of ['ready', 'comment', 'reply', 'status', 'build', 'send', 'openMarkdown', 'openBrowser', 'openLink']) {
            assert.ok(html.includes(`type: '${type}'`), type);
        }
        for (const type of ['doc', 'busy', 'error']) {
            assert.ok(html.includes(`m.type === '${type}'`), type);
        }
    });
    it('shares the host\'s own pure functions with the page by their source, closure-free', () => {
        const script = sharedScript();
        assert.ok(html.includes(script));
        for (const f of sharedFunctions) {
            assert.ok(script.includes(`function ${f.name}(`), f.name);
        }
        for (const bad of ['exports.', 'require(', '_1.', 'module.']) {
            assert.ok(!script.includes(bad), `${bad} would not resolve inside the webview`);
        }
        // The block runs on its own and behaves like the host's copies.
        const fn = new Function(script + '\nreturn { findQuote, waitsOnPerson, formatElapsed, statusLabel, typeLabel, openUnder, afterLine, sentLabel };');
        const w = fn() as { findQuote: typeof findQuote; waitsOnPerson: typeof waitsOnPerson; formatElapsed: typeof formatElapsed; statusLabel: (s: string) => string; typeLabel: (s: string) => string; openUnder: (c: unknown[], h: string) => number; afterLine: (t: unknown) => string; sentLabel: (l: unknown) => string };
        const text = 'a b a b';
        assert.deepStrictEqual(w.findQuote(text, { quote: 'a', prefix: 'b ' }), findQuote(text, { quote: 'a', prefix: 'b ' }));
        assert.deepStrictEqual(w.findQuote(text, { quote: 'a', prefix: 'b ' }), { start: 4, end: 5 });
        assert.strictEqual(w.waitsOnPerson({ id: 1, kind: 'proposal', by: 'agent', text: '', status: 'open', at: '' }), true);
        assert.strictEqual(w.formatElapsed('2026-01-01T00:00:00Z', new Date('2026-01-01T00:02:00Z')), '2m');
        assert.strictEqual(w.statusLabel('fixed'), 'changed the page');
        assert.strictEqual(w.typeLabel('hld'), 'HLD');
        assert.strictEqual(w.openUnder([{ status: 'open', anchor: { heading: 'Infra' } }], 'infra'), 1);
        assert.strictEqual(w.afterLine({ after: [1, 2] }), 'after 1, 2');
        assert.strictEqual(w.sentLabel({ kind: 'page', ref: '99' }), '📄 page 99');
        assert.ok(!html.includes('const findQuote ='), 'no second text-quote selector in the page');
    });
    it('attaches files through the host: a pick request, chips with an x, paths on the comment', () => {
        assert.ok(html.includes(`post({ type: 'pickFiles' })`));
        assert.ok(html.includes(`m.type === 'picked'`));
        assert.ok(html.includes(`files: attached.map((f) => f.path)`));
        assert.ok(html.includes(`button('×'`));
    });
    it('only opens http(s) links', () => {
        assert.ok(html.includes('const httpUrl = (u) => typeof u === \'string\' && /^https?:\\/\\//i.test(u);'));
    });
    it('replies from a one-line box under every card: Enter sends, Shift+Enter a new line', () => {
        assert.ok(html.includes(`d.appendChild(quickReply(c));`));
        assert.ok(html.includes(`if (e.key !== 'Enter' || e.shiftKey) return;`));
        assert.ok(!html.includes(`button('Reply'`), 'no Reply button to reveal a box');
        assert.ok(html.includes(`button('Accept', 'yes'`) && html.includes(`button('Dismiss'`) && html.includes(`button('Resolve'`) && html.includes(`button('Reopen'`));
    });
    it('puts a + comment on every section heading without adding text to the article', () => {
        assert.ok(html.includes(`button.hc::before { content: "+ comment"; }`));
        assert.ok(html.includes(`page.querySelectorAll('h2, h3')`));
        assert.ok(html.includes(`openComposer({ quote: text, prefix: '', suffix: '', heading: text })`));
    });
    it('offers a send button per destination with credentials, tickets folded, tasks only as a fallback', () => {
        assert.ok(html.includes(`post({ type: 'send', to })`));
        assert.ok(html.includes(`'Tickets (' + list.length + ')'`));
        assert.ok(html.includes(`if (tasks.length && !tickets().length)`));
    });
    it('themes with VS Code variables', () => {
        for (const v of ['--vscode-editor-background', '--vscode-foreground', '--vscode-textLink-foreground', '--vscode-button-background']) {
            assert.ok(html.includes(v), v);
        }
    });
});
