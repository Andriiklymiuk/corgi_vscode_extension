import * as vscode from 'vscode';

import { BoardSession, sessionName } from './agentBoard';
import { runCorgi } from './corgiExec';

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

function html(name: string): string {
    const title = name.replace(/</g, '&lt;');
    return `<!doctype html><html><head><meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 13px var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }
  #log { flex: 1; overflow: auto; padding: 12px 14px; }
  .e { margin: 0 0 10px; white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
  .user { color: var(--vscode-textLink-foreground); }
  .user::before { content: "you › "; opacity: .7; }
  .assistant::before { content: "${title} › "; opacity: .7; }
  .tool, .result, .system { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .tool::before { content: "⚙ "; }
  .result::before { content: "↳ "; }
  #bar { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--vscode-panel-border); }
  textarea { flex: 1; resize: none; min-height: 38px; max-height: 140px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 8px; }
  button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 4px; padding: 0 12px; cursor: pointer; }
  button.quiet { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #err { color: var(--vscode-errorForeground); padding: 4px 14px; font-size: 12px; }
</style></head><body>
<div id="log"></div>
<div id="err" hidden></div>
<div id="bar">
  <textarea id="box" placeholder="Message ${title} — Enter sends, Shift+Enter for a new line"></textarea>
  <button id="send">Send</button>
  <button class="quiet" id="allow" title="Allow the pending permission">Allow</button>
  <button class="quiet" id="deny" title="Deny it">Deny</button>
  <button class="quiet" id="stop" title="Interrupt the turn (Escape)">Stop</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const box = document.getElementById('box');
  const err = document.getElementById('err');
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const draw = (e) => {
    const d = document.createElement('div');
    d.className = 'e ' + (e.kind || 'system');
    d.innerHTML = e.kind === 'tool' ? esc([e.tool, e.subject].filter(Boolean).join(' ')) : esc(e.text || '') + (e.truncated ? ' …' : '');
    return d;
  };
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'replace') { log.replaceChildren(...m.entries.map(draw)); }
    else if (m.type === 'append') { for (const e of m.entries) log.appendChild(draw(e)); }
    else if (m.type === 'error') { err.textContent = m.text || ''; err.hidden = !m.text; return; }
    err.hidden = true;
    log.scrollTop = log.scrollHeight;
  });
  const send = () => { const t = box.value; if (!t.trim()) return; vscode.postMessage({ type: 'send', text: t }); box.value = ''; };
  document.getElementById('send').onclick = send;
  document.getElementById('allow').onclick = () => vscode.postMessage({ type: 'answer', text: 'allow' });
  document.getElementById('deny').onclick = () => vscode.postMessage({ type: 'answer', text: 'deny' });
  document.getElementById('stop').onclick = () => vscode.postMessage({ type: 'interrupt' });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
</script></body></html>`;
}
