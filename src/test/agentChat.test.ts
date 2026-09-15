import * as assert from 'node:assert';
import { html } from '../agentChatHtml';

describe('agentChat html', () => {
  it('keeps a hostile session name inside its strings', () => {
    const page = html('x"></style><script>alert(1)</script>');
    assert.ok(!page.includes('<script>alert'));
    assert.ok(page.includes('placeholder="Message x&quot;&gt;&lt;/style&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(page.includes('content: "x\\">\\3c /style>\\3c script>alert(1)\\3c /script> › "'));
  });
  it('carries a content security policy', () => {
    assert.ok(html('api').includes('Content-Security-Policy'));
  });
});
