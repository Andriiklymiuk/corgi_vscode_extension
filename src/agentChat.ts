import * as vscode from 'vscode';

import { BoardSession, sessionName } from './agentBoard';
import { runCorgi } from './corgiExec';
import { html } from './agentChatHtml';

/**
 * A session's conversation beside the code: what it said, the tools it ran,
 * and a box to type the next message — the phone's chat, in a panel. It
 * polls `corgi agent transcript` every two seconds for what landed after
 * the last offset, and sends through `corgi agent send`; the daemon does
 * the typing, so the terminal the session runs in is never touched.
 */

type Entry = { id?: string; kind: string; at?: string; text?: string; tool?: string; subject?: string; truncated?: boolean };

const POLL_MS = 2000;

export class AgentChatPanel {
    private static readonly open = new Map<string, AgentChatPanel>();
    private readonly panel: vscode.WebviewPanel;
    private offset = 0;
    private poll: NodeJS.Timeout | undefined;
    private disposed = false;

    static show(session: BoardSession): void {
        const have = AgentChatPanel.open.get(session.id);
        if (have) {
            have.panel.reveal();
            return;
        }
        AgentChatPanel.open.set(session.id, new AgentChatPanel(session));
    }

    private constructor(private readonly session: BoardSession) {
        this.panel = vscode.window.createWebviewPanel('corgi.agentChat', `corgi · ${sessionName(session)}`, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        this.panel.webview.html = html(sessionName(session));
        this.panel.onDidDispose(() => this.dispose());
        this.panel.webview.onDidReceiveMessage((m: { type: string; text?: string }) => {
            if (m.type === 'send' && m.text?.trim()) {
                void this.send(m.text.trim());
            }
            if (m.type === 'answer' && (m.text === 'allow' || m.text === 'deny')) {
                void runCorgi(['agent', 'answer', this.session.id, m.text]);
            }
            if (m.type === 'interrupt') {
                void runCorgi(['agent', 'interrupt', this.session.id]);
            }
        });
        void this.read(true);
        this.poll = setInterval(() => void this.read(false), POLL_MS);
    }

    private async read(first: boolean): Promise<void> {
        if (this.disposed) {
            return;
        }
        const args = ['agent', 'transcript', this.session.id, '--json'];
        if (!first && this.offset > 0) {
            args.push('--after', String(this.offset));
        }
        const r = await runCorgi(args);
        if (!r.ok) {
            void this.panel.webview.postMessage({ type: 'error', text: (r.stderr || r.stdout).trim().split('\n').pop() });
            return;
        }
        try {
            const out = JSON.parse(r.stdout) as { entries: Entry[]; offset: number; empty?: boolean };
            if (out.offset) {
                this.offset = out.offset;
            }
            void this.panel.webview.postMessage({ type: first ? 'replace' : 'append', entries: out.entries ?? [] });
        } catch {
            // a line that was not JSON: the next poll reads again
        }
    }

    private async send(text: string): Promise<void> {
        const r = await runCorgi(['agent', 'send', this.session.id, '--enter', text]);
        if (!r.ok) {
            void vscode.window.showWarningMessage(`corgi could not send it: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`);
            return;
        }
        void this.panel.webview.postMessage({ type: 'append', entries: [{ kind: 'user', text, at: new Date().toISOString() }] });
    }

    private dispose(): void {
        this.disposed = true;
        if (this.poll) {
            clearInterval(this.poll);
        }
        AgentChatPanel.open.delete(this.session.id);
    }
}

