/**
 * The sidebar page: one HTML string, inline CSS on VS Code's theme
 * colours, one script under a nonce. The script never reads the board; it
 * draws the SidebarState the extension posts and sends back which command
 * to run on which row. Pure, so it is tested without vscode.
 */
export function page(nonce: string): string {
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root {
    --fg: var(--vscode-foreground);
    --dim: var(--vscode-descriptionForeground);
    --hover: var(--vscode-list-hoverBackground);
    --ask: var(--vscode-notificationsWarningIcon-foreground);
    --bad: var(--vscode-notificationsErrorIcon-foreground);
    --live: var(--vscode-charts-green, #89d185);
    --bar: var(--vscode-progressBar-background);
    --track: var(--vscode-scrollbarSlider-background);
    --link: var(--vscode-textLink-foreground);
    --btn: var(--vscode-toolbar-hoverBackground);
    --badge: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --line: var(--vscode-sideBarSectionHeader-border, transparent);
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 0 8px; font: 13px/1.4 var(--vscode-font-family); color: var(--fg); background: transparent; -webkit-font-smoothing: antialiased; }
  section { border-top: 1px solid var(--line); }
  section:first-child { border-top: 0; }
  h2 { margin: 0; padding: 7px 12px 5px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--dim); display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
  h2:hover { color: var(--fg); }
  h2 .chev { display: inline-block; width: 14px; text-align: center; font-size: 10px; transition: transform .12s ease; }
  h2 .count { margin-left: auto; font-weight: 500; letter-spacing: 0; text-transform: none; }
  h2 .badge { margin-left: auto; min-width: 18px; padding: 0 6px; border-radius: 9px; font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; color: var(--badge-fg); background: var(--badge); letter-spacing: 0; }
  section.closed .chev { transform: rotate(-90deg); }
  section.closed .body { display: none; }
  .ws { padding: 4px 12px 1px 22px; font-size: 11px; color: var(--dim); }
  .row { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 3px 12px 3px 14px; cursor: pointer; position: relative; }
  .row:hover, .row:focus-visible { background: var(--hover); outline: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--dim); opacity: .55; }
  .dot.ask { background: var(--ask); opacity: 1; }
  .dot.bad { background: var(--bad); opacity: 1; }
  .dot.live { background: var(--live); opacity: 1; animation: pulse 1.8s ease-in-out infinite; }
  .mark { width: 8px; flex: none; text-align: center; color: var(--ask); font-size: 12px; }
  @keyframes pulse { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } }
  .main { flex: 1; min-width: 0; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .clause { color: var(--dim); font-size: 12px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { color: var(--dim); font-size: 11px; flex: none; }
  .acts { display: none; gap: 2px; position: absolute; right: 8px; top: 50%; transform: translateY(-50%); padding-left: 10px; background: linear-gradient(to right, transparent, var(--hover) 10px); }
  .row:hover .acts, .row:focus-within .acts { display: flex; }
  .row:hover .when, .row:focus-within .when { visibility: hidden; }
  .acts button { font: inherit; font-size: 11px; line-height: 20px; color: var(--fg); background: transparent; border: 0; border-radius: 3px; padding: 0 6px; cursor: pointer; white-space: nowrap; }
  .acts button:hover { background: var(--btn); }
  .acts button.yes { color: var(--live); }
  .acts button.no { color: var(--bad); }
  .usage { padding: 2px 12px 6px 14px; }
  .usage .who { font-size: 11px; color: var(--dim); margin: 4px 0 2px; }
  .usage .line { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-top: 5px; }
  .usage .name { width: 18px; color: var(--dim); flex: none; }
  .track { flex: 1; height: 4px; border-radius: 2px; background: var(--track); overflow: hidden; }
  .fill { height: 100%; border-radius: 2px; background: var(--bar); transition: width .3s ease; }
  .fill.ask { background: var(--ask); }
  .fill.bad { background: var(--bad); }
  .usage .pct { width: 36px; text-align: right; flex: none; font-variant-numeric: tabular-nums; }
  .usage .resets { color: var(--dim); font-size: 11px; padding-left: 26px; }
  .usage .resets.warn { color: var(--ask); }
  .empty { padding: 6px 14px 4px; color: var(--dim); font-size: 12px; line-height: 1.45; }
  #install { padding: 10px 14px 12px; font-size: 12px; line-height: 1.5; border-bottom: 1px solid var(--line); }
  #install a.btn { display: inline-block; margin-top: 8px; padding: 4px 12px; border-radius: 3px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  #install a.btn:hover { background: var(--vscode-button-hoverBackground); text-decoration: none; }
  .foot { display: flex; gap: 14px; padding: 6px 14px 4px; font-size: 12px; }
  a { color: var(--link); cursor: pointer; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style></head><body>
<div id="install" hidden></div>
<section id="usage"><h2><span class="chev">▾</span>Usage</h2><div class="body"></div></section>
<section id="inbox"><h2><span class="chev">▾</span>Inbox<span class="badge" hidden></span></h2><div class="body"></div></section>
<section id="sessions"><h2><span class="chev">▾</span>Sessions<span class="count"></span></h2><div class="body"></div></section>
<script nonce="${nonce}">
(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const closed = new Set(Array.isArray(saved.closed) ? saved.closed : []);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const run = (command, node) => vscode.postMessage({ type: 'run', command, node });
  const button = (label, cls, onClick) => { const b = el('button', cls, label); b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b; };

  for (const sec of document.querySelectorAll('section')) {
    if (closed.has(sec.id)) sec.classList.add('closed');
    sec.querySelector('h2').addEventListener('click', () => {
      sec.classList.toggle('closed');
      if (sec.classList.contains('closed')) closed.add(sec.id); else closed.delete(sec.id);
      vscode.setState({ closed: [...closed] });
    });
  }

  const body = (id) => document.querySelector('#' + id + ' .body');

  const drawUsage = (accounts) => {
    const sec = document.getElementById('usage');
    sec.hidden = accounts.length === 0;
    const out = [];
    for (const a of accounts) {
      const box = el('div', 'usage');
      if (accounts.length > 1) box.appendChild(el('div', 'who', a.profile));
      for (const w of a.windows) {
        const line = el('div', 'line');
        line.appendChild(el('span', 'name', w.name));
        const track = el('div', 'track');
        const fill = el('div', 'fill' + (w.percent >= 90 ? ' bad' : w.percent >= 70 ? ' ask' : ''));
        fill.style.width = w.percent + '%';
        track.appendChild(fill);
        line.appendChild(track);
        line.appendChild(el('span', 'pct', w.percent + '%'));
        box.appendChild(line);
        const note = [w.resets, w.warn].filter(Boolean).join(' · ');
        if (note) box.appendChild(el('div', 'resets' + (w.warn ? ' warn' : ''), note));
      }
      out.push(box);
    }
    body('usage').replaceChildren(...out);
  };

  const row = (tone, crossing, title, clause, when, tooltip) => {
    const r = el('div', 'row');
    r.tabIndex = 0;
    r.title = tooltip || '';
    r.appendChild(crossing ? el('span', 'mark', '⚠') : el('span', 'dot ' + tone));
    const main = el('div', 'main');
    main.appendChild(el('div', 'title', title));
    if (clause) main.appendChild(el('div', 'clause', clause));
    r.appendChild(main);
    r.appendChild(el('span', 'when', when || ''));
    return r;
  };

  const groups = (list, draw) => {
    const out = [];
    for (const g of list) {
      if (g.workspace) out.push(el('div', 'ws', g.workspace));
      for (const r of g.rows) out.push(draw(r));
    }
    return out;
  };

  const drawInbox = (state) => {
    const badge = document.querySelector('#inbox .badge');
    badge.hidden = state.counts.inbox === 0;
    badge.textContent = String(state.counts.inbox);
    const rows = groups(state.inbox, (r) => {
      const d = row(r.tone, false, r.name, r.detail, r.elapsed, r.tooltip);
      const acts = el('div', 'acts');
      if (r.can.includes('work')) acts.appendChild(button('Work on it', '', () => run('corgi.agent.inboxWorkOn', r.node)));
      if (r.can.includes('unblock')) acts.appendChild(button('Unblock', 'yes', () => run('corgi.agent.inboxUnblock', r.node)));
      if (r.can.includes('open')) acts.appendChild(button('Open', '', () => vscode.postMessage({ type: 'open', url: r.url })));
      acts.appendChild(button('⋯', '', () => vscode.postMessage({ type: 'menu', node: r.node })));
      d.appendChild(acts);
      d.addEventListener('click', () => r.url ? vscode.postMessage({ type: 'open', url: r.url }) : vscode.postMessage({ type: 'menu', node: r.node }));
      return d;
    });
    if (rows.length === 0) {
      const e = el('div', 'empty');
      e.appendChild(el('div', '', 'Nothing is waiting on you.'));
      e.appendChild(el('div', '', 'The watch puts tickets, review requests, comments and red builds here as it finds them. '));
      const again = el('a', '', 'Check again');
      again.addEventListener('click', () => run('corgi.sidebar.reload'));
      e.lastChild.appendChild(again);
      rows.push(e);
    }
    body('inbox').replaceChildren(...rows);
  };

  const drawSessions = (state) => {
    document.querySelector('#sessions .count').textContent = state.counts.active ? 'active · ' + state.counts.active : '';
    const rows = groups(state.sessions, (r) => {
      const d = row(r.tone, r.crossing, r.title, r.clause, r.elapsed, r.tooltip);
      const acts = el('div', 'acts');
      if (r.can.includes('allow')) {
        acts.appendChild(button('Allow', 'yes', () => run('corgi.agent.answer', r.node)));
        acts.appendChild(button('Deny', 'no', () => run('corgi.agent.deny', r.node)));
      }
      if (r.can.includes('fresh')) acts.appendChild(button('Fresh', '', () => run('corgi.agent.fresh', r.node)));
      if (r.can.includes('pr')) acts.appendChild(button('PR', '', () => run('corgi.agent.openPr', r.node)));
      acts.appendChild(button('Chat', '', () => run('corgi.agent.chat', r.node)));
      acts.appendChild(button('⋯', '', () => vscode.postMessage({ type: 'menu', node: r.node })));
      d.appendChild(acts);
      d.addEventListener('click', () => run('corgi.agent.focusNode', r.node));
      d.addEventListener('keydown', (e) => { if (e.key === 'Enter') run('corgi.agent.focusNode', r.node); });
      return d;
    });
    if (rows.length === 0) rows.push(el('div', 'empty', 'No sessions. Start one below.'));
    const foot = el('div', 'foot');
    const fresh = el('a', '', '+ New session');
    fresh.addEventListener('click', () => run('corgi.agent.new'));
    const isolated = el('a', '', '+ Isolated');
    isolated.title = 'A new session in its own worktree';
    isolated.addEventListener('click', () => run('corgi.agent.newIsolated'));
    foot.append(fresh, isolated);
    rows.push(foot);
    body('sessions').replaceChildren(...rows);
  };

  const drawInstall = (installed) => {
    const box = document.getElementById('install');
    box.hidden = installed;
    if (installed) { box.replaceChildren(); return; }
    const text = el('div', '', 'The corgi command line is not installed. It comes from Homebrew, so have that first. ');
    const repo = el('a', '', 'Corgi on GitHub');
    repo.addEventListener('click', () => vscode.postMessage({ type: 'open', url: 'https://github.com/Andriiklymiuk/corgi' }));
    text.appendChild(repo);
    const btn = el('a', 'btn', 'Install corgi with Homebrew');
    btn.addEventListener('click', () => run('corgi.installWithHomebrew'));
    box.replaceChildren(text, btn);
  };

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.type !== 'state' || !m.state) return;
    drawInstall(m.state.installed !== false);
    drawUsage(m.state.accounts || []);
    drawInbox(m.state);
    drawSessions(m.state);
  });
  vscode.postMessage({ type: 'ready' });
})();
</script></body></html>`;
}
