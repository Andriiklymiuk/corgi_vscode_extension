import * as fs from 'fs';
import * as path from 'path';
import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';

const AGENT_COMMAND = /(^|[\s/])(claude|codex)(\s|$)/;
const WANT_FRESH_MS = 5000;
const DUMP_EVERY_MS = 200;
const SCAN_MS = 400;

export type MirrorTerminal = { readonly processId: Thenable<number | undefined>; sendText(text: string, addNewLine?: boolean): void };
export type MirrorExecutionStart = { terminal: MirrorTerminal; execution: { commandLine: { value: string }; read(): AsyncIterable<string> } };

type Mirror = {
    term: Terminal;
    serialize: SerializeAddon;
    terminal: MirrorTerminal;
    dumped: number;
    timer: NodeJS.Timeout | undefined;
};

export function isAgentCommand(commandLine: string): boolean {
    return AGENT_COMMAND.test(commandLine.trim());
}

export function parseWant(text: string): { cols: number; rows: number } | undefined {
    const [c, r] = text.trim().split(/\s+/).map((n) => parseInt(n, 10));
    if (!Number.isFinite(c) || !Number.isFinite(r) || c < 10 || r < 3 || c > 1000 || r > 500) {
        return undefined;
    }
    return { cols: c, rows: r };
}

export class TerminalMirror {
    private readonly mirrors = new Map<number, Mirror>();
    private readonly scan: NodeJS.Timeout;
    private watcher: fs.FSWatcher | undefined;

    constructor(private readonly dir: string) {
        this.scan = setInterval(() => this.tick(), SCAN_MS);
        this.scan.unref?.();
        try {
            this.watcher = fs.watch(dir, { persistent: false }, (_event, name) => {
                if (name && (name.endsWith('.keys') || name.endsWith('.want'))) {
                    this.tick();
                }
            });
        } catch {
            this.watcher = undefined;
        }
    }

    async follow(event: MirrorExecutionStart): Promise<void> {
        if (!isAgentCommand(event.execution.commandLine.value)) {
            return;
        }
        const pid = await event.terminal.processId;
        if (!pid) {
            return;
        }
        const stream = event.execution.read();
        const term = new Terminal({ cols: 120, rows: 40, scrollback: 0, allowProposedApi: true });
        const serialize = new SerializeAddon();
        term.loadAddon(serialize);
        const mirror: Mirror = { term, serialize, terminal: event.terminal, dumped: 0, timer: undefined };
        this.mirrors.get(pid)?.term.dispose();
        this.mirrors.set(pid, mirror);
        try {
            for await (const data of stream) {
                term.write(data);
                if (this.wanted(pid)) {
                    this.schedule(pid, mirror);
                }
            }
        } finally {
            if (mirror.timer) {
                clearTimeout(mirror.timer);
                mirror.timer = undefined;
            }
            if (this.mirrors.get(pid) === mirror) {
                this.mirrors.delete(pid);
                fs.rmSync(this.file(pid, 'ansi'), { force: true });
            }
            term.dispose();
        }
    }

    private file(pid: number, ext: string): string {
        return path.join(this.dir, `${pid}.${ext}`);
    }

    private wanted(pid: number): boolean {
        try {
            return Date.now() - fs.statSync(this.file(pid, 'want')).mtimeMs < WANT_FRESH_MS;
        } catch {
            return false;
        }
    }

    private schedule(pid: number, m: Mirror): void {
        if (m.timer) {
            return;
        }
        const wait = Math.max(0, DUMP_EVERY_MS - (Date.now() - m.dumped));
        m.timer = setTimeout(() => {
            m.timer = undefined;
            this.dump(pid, m);
        }, wait);
    }

    private dump(pid: number, m: Mirror): void {
        try {
            const size = parseWant(fs.readFileSync(this.file(pid, 'want'), 'utf8'));
            if (size && (size.cols !== m.term.cols || size.rows !== m.term.rows)) {
                m.term.resize(size.cols, size.rows);
            }
        } catch {
            return;
        }
        m.term.write('', () => {
            if (this.mirrors.get(pid) !== m) {
                return;
            }
            const out = m.serialize.serialize({ scrollback: 0 });
            const tmp = this.file(pid, `ansi.${process.pid}.tmp`);
            fs.writeFile(tmp, out, { mode: 0o600 }, (err) => {
                if (err) {
                    return;
                }
                if (this.mirrors.get(pid) !== m) {
                    fs.rm(tmp, { force: true }, () => undefined);
                    return;
                }
                fs.rename(tmp, this.file(pid, 'ansi'), () => undefined);
            });
            m.dumped = Date.now();
        });
    }

    private tick(): void {
        if (this.mirrors.size === 0) {
            return;
        }
        let names: string[];
        try {
            names = fs.readdirSync(this.dir);
        } catch {
            return;
        }
        for (const [pid, m] of this.mirrors) {
            if (this.wanted(pid) && Date.now() - m.dumped > 1500) {
                this.schedule(pid, m);
            }
            const keys = names.filter((n) => n.startsWith(`${pid}.`) && n.endsWith('.keys')).sort();
            for (const name of keys) {
                const full = path.join(this.dir, name);
                try {
                    const data = fs.readFileSync(full, 'utf8');
                    fs.rmSync(full, { force: true });
                    if (data) {
                        m.terminal.sendText(data, false);
                    }
                } catch {
                    fs.rmSync(full, { force: true });
                }
            }
            if (keys.length) {
                this.schedule(pid, m);
            }
        }
    }

    dispose(): void {
        clearInterval(this.scan);
        this.watcher?.close();
        for (const m of this.mirrors.values()) {
            m.term.dispose();
        }
        this.mirrors.clear();
    }
}
