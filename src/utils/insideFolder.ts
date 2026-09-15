import * as path from 'path';

export function insideFolder(base: string, target: string): boolean {
  const root = path.resolve(base);
  const full = path.resolve(target);
  return full === root || full.startsWith(root + path.sep);
}
