import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isAgentCommand, parseWant, TerminalMirror } from '../terminalMirror';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 3000): Promise<void> {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) {
            throw new Error('timed out');
        }
        await sleep(20);
    }
}

describe('terminal mirror', () => {
    it('follows only agent commands', () => {
        assert.ok(isAgentCommand('claude'));
        assert.ok(isAgentCommand('/opt/homebrew/bin/claude --resume'));
        assert.ok(isAgentCommand('codex'));
        assert.ok(!isAgentCommand('npm test'));
        assert.ok(!isAgentCommand('claudette'));
    });

    it('reads the wanted size', () => {
        assert.deepStrictEqual(parseWant('90 30\n'), { cols: 90, rows: 30 });
        assert.strictEqual(parseWant('nope'), undefined);
        assert.strictEqual(parseWant('5 2'), undefined);
    });

    it('writes the screen only while wanted and types keys into the terminal', async function () {
        this.timeout(10000);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
        const mirror = new TerminalMirror(dir);
        const typed: string[] = [];
        let push: (s: string) => void = () => undefined;
        let finish: () => void = () => undefined;
        const chunks: string[] = [];
        let wake: (() => void) | undefined;
        push = (s) => {
            chunks.push(s);
            wake?.();
        };
        let done = false;
        finish = () => {
            done = true;
            wake?.();
        };
        async function* read(): AsyncIterable<string> {
            for (;;) {
                while (chunks.length) {
                    yield chunks.shift()!;
                }
                if (done) {
                    return;
                }
                await new Promise<void>((r) => (wake = r));
            }
        }
        try {
        const following = mirror.follow({
            terminal: { processId: Promise.resolve(4242), sendText: (t: string) => typed.push(t) },
            execution: { commandLine: { value: 'claude' }, read },
        });
        await sleep(30);
        push('\x1b[1mAllow edit?\x1b[0m 1. Yes  2. No');
        await sleep(300);
        assert.ok(!fs.existsSync(path.join(dir, '4242.ansi')), 'nobody asked, nothing written');
        fs.writeFileSync(path.join(dir, '4242.want'), '80 24');
        push('\r\n> ');
        await until(() => fs.existsSync(path.join(dir, '4242.ansi')));
        const screen = fs.readFileSync(path.join(dir, '4242.ansi'), 'utf8');
        assert.ok(screen.includes('Allow edit?'), screen);
        assert.ok(screen.includes('\x1b['), 'colours survive');
        fs.writeFileSync(path.join(dir, '4242.0001.keys'), '1');
        await until(() => typed.length === 1);
        assert.deepStrictEqual(typed, ['1']);
        assert.ok(!fs.existsSync(path.join(dir, '4242.0001.keys')));
        finish();
        await following;
        assert.ok(!fs.existsSync(path.join(dir, '4242.ansi')), 'an ended session leaves no screen behind');
        } finally {
            finish();
            mirror.dispose();
        }
    });
});
