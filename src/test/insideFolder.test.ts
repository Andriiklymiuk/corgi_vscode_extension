import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { insideFolder, plainFileName } from '../utils/insideFolder';

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
  it('follows a symlink the repo planted', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corgi-inside-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'corgi-outside-'));
    fs.symlinkSync(outside, path.join(root, 'examples'));
    assert.ok(!insideFolder(root, path.join(root, 'examples', 'x', 'corgi-compose.yml')));
    assert.ok(insideFolder(root, path.join(root, 'real', 'corgi-compose.yml')));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe('plainFileName', () => {
  it('takes a compose file name and refuses shell text', () => {
    assert.ok(plainFileName.test('corgi-compose.yml'));
    assert.ok(plainFileName.test('docker-compose.v2.yml'));
    assert.ok(!plainFileName.test('x.yml;touch pwned'));
    assert.ok(!plainFileName.test('a b.yml'));
    assert.ok(!plainFileName.test('.env'));
    assert.ok(!plainFileName.test('$(id).yml'));
  });
});
