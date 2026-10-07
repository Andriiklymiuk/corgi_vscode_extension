import * as assert from 'node:assert';
import { page } from '../sidebarHtml';

describe('sidebar page', () => {
    const html = page('abc123');
    it('locks scripts to the nonce', () => {
        assert.ok(html.includes(`script-src 'nonce-abc123'`));
        assert.ok(html.includes(`<script nonce="abc123">`));
        assert.ok(html.includes(`default-src 'none'`));
    });
    it('never assigns innerHTML', () => {
        assert.ok(!html.includes('innerHTML'));
    });
    it('has every section, accounts and sessions first, the board last', () => {
        const order = ['daemon', 'usage', 'sessions', 'inbox', 'workspaces', 'board'].map((id) => html.indexOf(`id="${id}"`));
        assert.ok(order.every((i) => i >= 0), String(order));
        assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
    });
    it('drops a click on the session already in front', () => {
        assert.ok(html.includes('if (r.front || now - focusing < 1200) return;'));
    });
    it('offers the Homebrew install when corgi is missing', () => {
        assert.ok(html.includes(`'corgi.installWithHomebrew'`));
        assert.ok(html.includes('id="install"'));
    });
    it('only runs commands the extension allows, by name', () => {
        assert.ok(html.includes(`'corgi.agent.focusNode'`));
        assert.ok(html.includes(`'corgi.agent.inboxWorkOn'`));
    });
});
