import * as assert from 'node:assert';
import * as path from 'path';
import { insideFolder } from '../utils/insideFolder';

describe('insideFolder', () => {
  const base = path.resolve('/Users/me/work/app');
  it('keeps what is under the workspace', () => {
    assert.ok(insideFolder(base, path.join(base, 'corgi-compose.yml')));
    assert.ok(insideFolder(base, path.join(base, 'examples', 'x', 'corgi-compose.yml')));
  });
  it('refuses what climbs out', () => {
    assert.ok(!insideFolder(base, path.join(base, '..', '..', 'Library', 'LaunchAgents', 'x.plist')));
    assert.ok(!insideFolder(base, '/etc/passwd'));
    assert.ok(!insideFolder(base, base + '-other/file'));
  });
});
