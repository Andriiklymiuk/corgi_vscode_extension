import * as assert from 'node:assert';
import { ideaPage } from '../ideaHtml';

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
