import * as fs from 'fs';
import * as path from 'path';

export function insideFolder(base: string, target: string): boolean {
  const root = realOrSelf(path.resolve(base));
  const full = realOrSelf(path.resolve(target));
  return full === root || full.startsWith(root + path.sep);
}

// the deepest existing ancestor, symlinks followed, plus the rest as given
function realOrSelf(p: string): string {
  let existing = p;
  const rest: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) { return p; }
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.join(fs.realpathSync(existing), ...rest);
  } catch {
    return p;
  }
}

export const plainFileName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
