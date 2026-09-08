import { execFile } from 'node:child_process';
import * as fs from 'node:fs';

/**
 * Runs the corgi binary without a terminal. The extension host's PATH is
 * whatever launched VS Code, which on macOS often lacks Homebrew's bin, so
 * the usual install locations are tried when a bare `corgi` is not found.
 */
const fallbackBinaries = ['/opt/homebrew/bin/corgi', '/usr/local/bin/corgi', `${process.env.HOME ?? ''}/go/bin/corgi`];

let resolved: string | undefined;

export function corgiBinary(): string {
    if (resolved) {
        return resolved;
    }
    for (const candidate of fallbackBinaries) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            resolved = candidate;
            return candidate;
        } catch {
            // Not there; the next one, then PATH.
        }
    }
    return 'corgi';
}

export interface CorgiResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}

export function runCorgi(args: string[], cwd?: string): Promise<CorgiResult> {
    return new Promise((resolve) => {
        const run = (bin: string, retry: boolean) => {
            execFile(bin, args, { cwd, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error && retry && (error as NodeJS.ErrnoException).code === 'ENOENT') {
                    resolved = undefined;
                    const next = corgiBinary();
                    if (next !== bin) {
                        run(next, false);
                        return;
                    }
                }
                resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? (error?.message ?? '')) });
            });
        };
        run(resolved ?? 'corgi', true);
    });
}
