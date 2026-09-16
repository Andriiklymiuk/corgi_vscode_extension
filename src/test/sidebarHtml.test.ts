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
    it('has the three sections', () => {
        for (const id of ['daemon', 'usage', 'inbox', 'board', 'sessions', 'workspaces']) {
            assert.ok(html.includes(`id="${id}"`), id);
        }
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
