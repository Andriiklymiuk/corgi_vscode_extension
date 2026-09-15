// The chat webview page. Pure, so it can be tested without vscode.
export function html(name: string): string {
    const title = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cssTitle = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ').replace(/[\r\n]/g, ' ');
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 13px var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }
  #log { flex: 1; overflow: auto; padding: 12px 14px; }
  .e { margin: 0 0 10px; white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
  .user { color: var(--vscode-textLink-foreground); }
  .user::before { content: "you › "; opacity: .7; }
  .assistant::before { content: "${cssTitle} › "; opacity: .7; }
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
