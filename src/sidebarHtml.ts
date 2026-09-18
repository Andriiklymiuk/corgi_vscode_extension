/**
 * The sidebar page: one HTML string, inline CSS on VS Code's own theme
 * tokens, one script under a nonce. The script never reads the board; it
 * draws the SidebarState the extension posts and sends back which command
 * to run on which row. Pure, so it is tested without vscode.
 */
export function page(nonce: string): string {
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root {
    --fg: var(--vscode-sideBar-foreground, var(--vscode-foreground));
    --dim: var(--vscode-descriptionForeground);
    --head: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    --hover: var(--vscode-list-hoverBackground);
    --selected: var(--vscode-list-inactiveSelectionBackground);
    --ask: var(--vscode-notificationsWarningIcon-foreground);
    --bad: var(--vscode-notificationsErrorIcon-foreground);
    --live: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
    --bar: var(--vscode-progressBar-background);
    --track: var(--vscode-editorWidget-border, var(--vscode-scrollbarSlider-background));
    --link: var(--vscode-textLink-foreground);
    --badge: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --input: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, transparent);
    --line: var(--vscode-sideBarSectionHeader-border, transparent);
    --btn: var(--vscode-toolbar-hoverBackground);
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 0 12px; font: 13px/1.4 var(--vscode-font-family); color: var(--fg); background: transparent; -webkit-font-smoothing: antialiased; }
  #install { padding: 10px 14px 12px; font-size: 12px; line-height: 1.5; border-bottom: 1px solid var(--line); }
  #install a.btn { display: inline-block; margin-top: 8px; padding: 4px 12px; border-radius: 3px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  #install a.btn:hover { background: var(--vscode-button-hoverBackground); text-decoration: none; }
  #daemon { display: flex; align-items: center; gap: 8px; padding: 8px 14px; font-size: 12px; color: var(--dim); border-bottom: 1px solid var(--line); }
  #daemon .dot { margin: 0; }
  #daemon .sp { flex: 1; }
  #daemon a { font-size: 12px; }
  section { padding-bottom: 4px; }
  h2 { margin: 0; padding: 8px 14px 6px 8px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--head); display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
  h2 .chev { display: inline-block; width: 12px; text-align: center; font-size: 10px; color: var(--dim); transition: transform .12s ease; }
  h2 .badge { margin-left: auto; min-width: 20px; padding: 0 7px; border-radius: 10px; font-size: 11px; font-weight: 600; line-height: 19px; text-align: center; color: var(--badge-fg); background: var(--badge); letter-spacing: 0; text-transform: none; }
  h2 a { margin-left: auto; font-weight: 400; letter-spacing: 0; text-transform: none; font-size: 12px; }
  section.closed .chev { transform: rotate(-90deg); }
  section.closed .body { display: none; }
  .sub { padding: 8px 14px 2px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--dim); }
  .usage { padding: 0 14px 6px; }
  .usage .line { display: flex; align-items: baseline; justify-content: space-between; margin-top: 8px; }
  .usage .line .pct { font-variant-numeric: tabular-nums; }
  .track { height: 5px; border-radius: 3px; background: var(--track); overflow: hidden; margin-top: 5px; }
  .fill { height: 100%; border-radius: 3px; background: var(--bar); transition: width .3s ease; }
  .fill.ask { background: var(--ask); }
  .fill.bad { background: var(--bad); }
  .usage .resets { color: var(--dim); font-size: 12px; margin-top: 3px; }
  .usage .resets.warn { color: var(--ask); }
  .big { display: flex; align-items: center; gap: 10px; padding: 8px 14px; cursor: pointer; font-size: 13px; }
  .big:hover { background: var(--hover); }
  .big .plus { font-size: 17px; line-height: 1; color: var(--fg); width: 14px; text-align: center; }
  .tools { display: flex; align-items: center; gap: 10px; padding: 0 14px 6px; font-size: 12px; color: var(--dim); }
  .tools .active { display: flex; align-items: center; gap: 4px; }
  .tools input { flex: 1; min-width: 40px; font: inherit; font-size: 12px; color: var(--input-fg); background: var(--input); border: 1px solid var(--input-border); border-radius: 4px; padding: 3px 7px; }
  .tools input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .tools a { white-space: nowrap; }
  .ws { display: flex; align-items: center; gap: 6px; padding: 6px 14px 2px 10px; font-size: 12px; color: var(--dim); cursor: pointer; user-select: none; }
  .ws .sub { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .8; }
  .ws a { font-size: 11px; }
  .ws .chev { width: 10px; font-size: 9px; }
  .ws .badge { margin-left: auto; min-width: 20px; padding: 0 7px; border-radius: 10px; font-size: 11px; font-weight: 600; line-height: 19px; text-align: center; color: var(--badge-fg); background: var(--badge); }
  .ws.closed + .rows { display: none; }
  .row { display: flex; align-items: center; gap: 9px; min-height: 34px; padding: 4px 14px 4px 14px; cursor: pointer; position: relative; border-radius: 4px; margin: 0 6px; }
  .row:hover, .row:focus-visible { background: var(--hover); outline: 0; }
  .row.front { background: var(--selected); }
  .row.front .title { font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--dim); opacity: .45; }
  .dot.ask { background: var(--ask); opacity: 1; }
  .dot.bad { background: var(--bad); opacity: 1; }
  .dot.live { background: var(--live); opacity: 1; animation: pulse 1.8s ease-in-out infinite; }
  .mark { width: 8px; flex: none; text-align: center; color: var(--ask); font-size: 12px; }
  @keyframes pulse { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } }
  .main { flex: 1; min-width: 0; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .clause { color: var(--dim); font-size: 12px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { color: var(--dim); font-size: 12px; flex: none; }
  .acts { display: none; gap: 2px; position: absolute; right: 8px; top: 50%; transform: translateY(-50%); padding-left: 12px; background: linear-gradient(to right, transparent, var(--hover) 12px); }
  .row:hover .acts, .row:focus-within .acts { display: flex; }
  .row:hover .when, .row:focus-within .when { visibility: hidden; }
  .acts button { font: inherit; font-size: 11px; line-height: 20px; color: var(--fg); background: transparent; border: 0; border-radius: 3px; padding: 0 6px; cursor: pointer; white-space: nowrap; }
  .acts button:hover { background: var(--btn); }
  .acts button.yes { color: var(--live); }
  .acts button.no { color: var(--bad); }
  .empty { padding: 4px 14px 6px; color: var(--dim); font-size: 12px; line-height: 1.45; }
  .foot { display: flex; gap: 14px; padding: 4px 14px 6px; font-size: 12px; }
  a { color: var(--link); cursor: pointer; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style></head><body>
<div id="install" hidden></div>
<div id="daemon" hidden></div>
<section id="usage"><h2><span class="chev">▾</span>Account &amp; usage<a data-run="corgi.agent.addAccount">Add account</a></h2><div class="body"></div></section>
<section id="inbox"><h2><span class="chev">▾</span>Inbox<span class="badge" hidden></span></h2><div class="body"></div></section>
<section id="board"><h2><span class="chev">▾</span>Board<span class="badge" hidden></span></h2><div class="body"></div></section>
<section id="sessions"><h2><span class="chev">▾</span>Session manager</h2><div class="body"></div></section>
<section id="workspaces"><h2><span class="chev">▾</span>Workspaces<a data-run="corgi.agent.addWorkspace">Add</a></h2><div class="body"></div></section>
<script nonce="${nonce}">
(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const closed = new Set(Array.isArray(saved.closed) ? saved.closed : []);
  const closedGroups = new Set(Array.isArray(saved.closedGroups) ? saved.closedGroups : []);
  let filter = typeof saved.filter === 'string' ? saved.filter : '';
  let showEnded = saved.showEnded === true;
  let byTicket = saved.byTicket === true;
  let last = null;
  const persist = () => vscode.setState({ closed: [...closed], closedGroups: [...closedGroups], filter, showEnded, byTicket });
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const run = (command, node) => vscode.postMessage({ type: 'run', command, node });
  const open = (url) => vscode.postMessage({ type: 'open', url });
  const button = (label, cls, onClick) => { const b = el('button', cls, label); b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b; };

  for (const sec of document.querySelectorAll('section')) {
    if (closed.has(sec.id)) sec.classList.add('closed');
    sec.querySelector('h2').addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      sec.classList.toggle('closed');
      if (sec.classList.contains('closed')) closed.add(sec.id); else closed.delete(sec.id);
      persist();
    });
  }
  for (const a of document.querySelectorAll('h2 a[data-run]')) a.addEventListener('click', () => run(a.dataset.run));

  const body = (id) => document.querySelector('#' + id + ' .body');
  const badge = (id, n) => { const b = document.querySelector('#' + id + ' .badge'); if (!b) return; b.hidden = !n; b.textContent = String(n); };

  const drawInstall = (installed) => {
    const box = document.getElementById('install');
    box.hidden = installed;
    if (installed) { box.replaceChildren(); return; }
    const text = el('div', '', 'The corgi command line is not installed. It comes from Homebrew, so have that first. ');
    const repo = el('a', '', 'Corgi on GitHub');
    repo.addEventListener('click', () => open('https://github.com/Andriiklymiuk/corgi'));
    text.appendChild(repo);
    const btn = el('a', 'btn', 'Install corgi with Homebrew');
    btn.addEventListener('click', () => run('corgi.installWithHomebrew'));
    box.replaceChildren(text, btn);
  };

  const drawDaemon = (d) => {
    const box = document.getElementById('daemon');
    box.hidden = false;
    const dot = el('span', 'dot ' + (d.running ? 'live' : 'bad'));
    const text = el('span', '', d.running ? 'corgi agent ' + d.version + (d.muted ? ' · ' + d.muted : '') : 'corgi agent is off');
    const sp = el('span', 'sp');
    const acts = [];
    if (d.running) {
      const mute = el('a', '', d.muted ? 'Unmute' : 'Mute');
      mute.addEventListener('click', () => run(d.muted ? 'corgi.agent.unmute' : 'corgi.agent.mute'));
      const restart = el('a', '', 'Restart');
      restart.addEventListener('click', () => run('corgi.agent.daemonRestart'));
      acts.push(mute, restart);
    } else {
      const start = el('a', '', 'Start');
      start.addEventListener('click', () => run('corgi.agent.daemonStart'));
      acts.push(start);
    }
    box.replaceChildren(dot, text, sp, ...acts);
  };

  const drawUsage = (accounts) => {
    const sec = document.getElementById('usage');
    sec.hidden = accounts.length === 0;
    const out = [];
    for (const a of accounts) {
      if (accounts.length > 1) out.push(el('div', 'sub', a.profile + (a.sessions ? ' · ' + a.sessions + ' session' + (a.sessions === 1 ? '' : 's') : '')));
      const box = el('div', 'usage');
      for (const w of a.windows) {
        const line = el('div', 'line');
        line.appendChild(el('span', '', w.label));
        line.appendChild(el('span', 'pct', w.percent + '%'));
        box.appendChild(line);
        const track = el('div', 'track');
        const fill = el('div', 'fill' + (w.percent >= 90 ? ' bad' : w.percent >= 70 ? ' ask' : ''));
        fill.style.width = w.percent + '%';
        track.appendChild(fill);
        box.appendChild(track);
        const note = [w.resets ? w.resets.replace(/^resets/, 'Resets') : '', w.warn].filter(Boolean).join(' · ');
        if (note) box.appendChild(el('div', 'resets' + (w.warn ? ' warn' : ''), note));
      }
      out.push(box);
    }
    body('usage').replaceChildren(...out);
  };

  const row = (tone, crossing, title, clause, when, tooltip, front) => {
    const r = el('div', 'row' + (front ? ' front' : ''));
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

  const group = (id, label, count, rows) => {
    const key = id + ':' + label;
    const head = el('div', 'ws' + (closedGroups.has(key) ? ' closed' : ''));
    head.appendChild(el('span', 'chev', closedGroups.has(key) ? '▸' : '▾'));
    head.appendChild(el('span', '', label));
    head.appendChild(el('span', 'badge', String(count)));
    const list = el('div', 'rows');
    for (const r of rows) list.appendChild(r);
    head.addEventListener('click', () => {
      head.classList.toggle('closed');
      head.querySelector('.chev').textContent = head.classList.contains('closed') ? '▸' : '▾';
      if (head.classList.contains('closed')) closedGroups.add(key); else closedGroups.delete(key);
      persist();
    });
    return [head, list];
  };

  const matches = (r) => !filter || (r.title + ' ' + (r.clause || r.detail || '') + ' ' + (r.name || '')).toLowerCase().includes(filter.toLowerCase());

  const drawInbox = (state) => {
    badge('inbox', state.counts.inbox);
    const out = [];
    for (const g of state.inbox) {
      const rows = g.rows.map((r) => {
        const d = row(r.tone, false, r.name, r.detail, r.elapsed, r.tooltip);
        const acts = el('div', 'acts');
        if (r.can.includes('work')) acts.appendChild(button('Work on it', '', () => run('corgi.agent.inboxWorkOn', r.node)));
        if (r.can.includes('unblock')) acts.appendChild(button('Unblock', 'yes', () => run('corgi.agent.inboxUnblock', r.node)));
        if (r.can.includes('open')) acts.appendChild(button('Open', '', () => open(r.url)));
        acts.appendChild(button('⋯', '', () => vscode.postMessage({ type: 'menu', node: r.node })));
        d.appendChild(acts);
        d.addEventListener('click', () => r.url ? open(r.url) : vscode.postMessage({ type: 'menu', node: r.node }));
        return d;
      });
      if (g.workspace) out.push(...group('inbox', g.workspace, g.rows.length, rows)); else out.push(...rows);
    }
    if (out.length === 0) {
      const e = el('div', 'empty');
      e.appendChild(el('div', '', 'Nothing is waiting on you.'));
      e.appendChild(el('div', '', 'The watch puts tickets, review requests, comments and red builds here as it finds them. '));
      const again = el('a', '', 'Check again');
      again.addEventListener('click', () => run('corgi.sidebar.reload'));
      e.lastChild.appendChild(again);
      out.push(e);
    }
    body('inbox').replaceChildren(...out);
  };

  const drawBoard = (state) => {
    badge('board', state.counts.board);
    const out = [];
    for (const g of state.board) {
      const rows = g.rows.map((r) => {
        const d = row(r.tone, false, r.title, r.detail, r.elapsed, r.title);
        if (r.url) d.addEventListener('click', () => open(r.url));
        return d;
      });
      out.push(...group('board', g.column, g.rows.length, rows));
    }
    if (out.length === 0) out.push(el('div', 'empty', 'No cards. Tickets the watch follows, and tasks of your own, land here.'));
    body('board').replaceChildren(...out);
  };

  const sessionRow = (r) => {
    const d = row(r.tone, r.crossing, r.title, r.clause, r.elapsed, r.tooltip, r.front);
    const acts = el('div', 'acts');
    acts.appendChild(button('Why', '', () => run('corgi.agent.why', r.node)));
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
  };

  const drawSessions = (state) => {
    const out = [];
    const fresh = el('div', 'big');
    fresh.append(el('span', 'plus', '+'), el('span', '', 'New session'));
    fresh.addEventListener('click', () => run('corgi.agent.new'));
    out.push(fresh);
    const tools = el('div', 'tools');
    const active = el('span', 'active');
    active.append(el('span', '', '⚡'), el('span', '', 'Active · ' + state.counts.active));
    const search = el('input');
    search.type = 'search'; search.placeholder = 'Filter'; search.value = filter;
    search.addEventListener('input', () => { filter = search.value; persist(); if (last) drawSessions(last); });
    const iso = el('a', '', '+ Isolated');
    iso.title = 'A session in its own worktree';
    iso.addEventListener('click', () => run('corgi.agent.newIsolated'));
    tools.append(active, search, iso);
    if (state.tickets.length) {
      const fold = el('a', '', byTicket ? 'by workspace' : 'by ticket');
      fold.title = byTicket ? 'Fold the sessions by workspace' : 'Fold the sessions by the ticket or branch they work on';
      fold.addEventListener('click', () => { byTicket = !byTicket; persist(); if (last) drawSessions(last); });
      tools.append(fold);
    }
    out.push(tools);
    let shown = 0;
    if (byTicket && state.tickets.length) {
      for (const g of state.tickets) {
        const rows = g.rows.filter(matches).map(sessionRow);
        shown += rows.length;
        if (!rows.length) continue;
        if (!g.key) { out.push(...group('tickets', 'no ticket', rows.length, rows)); continue; }
        const nodes = group('tickets', g.key, rows.length, rows);
        if (g.detail) nodes[0].insertBefore(el('span', 'sub', g.detail), nodes[0].querySelector('.badge'));
        if (g.url) { const a = el('a', '', 'open'); a.addEventListener('click', (e) => { e.stopPropagation(); open(g.url); }); nodes[0].insertBefore(a, nodes[0].querySelector('.badge')); }
        out.push(...nodes);
      }
    } else {
      for (const g of state.sessions) {
        const rows = g.rows.filter(matches).map(sessionRow);
        shown += rows.length;
        if (!rows.length) continue;
        if (g.workspace) out.push(...group('sessions', g.workspace, rows.length, rows)); else out.push(...rows);
      }
    }
    if (shown === 0) out.push(el('div', 'empty', filter ? 'Nothing matches.' : 'No sessions. Start one above.'));
    if (state.ended.length) {
      const head = el('div', 'ws' + (showEnded ? '' : ' closed'));
      head.append(el('span', 'chev', showEnded ? '▾' : '▸'), el('span', '', 'Ended sessions'), el('span', 'badge', String(state.ended.length)));
      const list = el('div', 'rows');
      for (const r of state.ended.filter(matches)) list.appendChild(sessionRow(r));
      head.addEventListener('click', () => { showEnded = !showEnded; persist(); drawSessions(last); });
      out.push(head, list);
    }
    body('sessions').replaceChildren(...out);
    if (document.activeElement !== search && filter) search.focus({ preventScroll: true });
  };

  const drawWorkspaces = (state) => {
    const out = state.workspaces.map((w) => {
      const d = row(w.tone, false, w.id, w.detail, '', w.id);
      const acts = el('div', 'acts');
      acts.appendChild(button(w.paused ? 'Resume' : 'Pause', '', () => run(w.paused ? 'corgi.agent.workspaceResume' : 'corgi.agent.workspacePause', { kind: 'workspace', id: w.id })));
      acts.appendChild(button(w.watch ? 'Watch off' : 'Watch', '', () => run(w.watch ? 'corgi.agent.watchDisable' : 'corgi.agent.watchEnable', { kind: 'workspace', id: w.id })));
      acts.appendChild(button('⋯', '', () => vscode.postMessage({ type: 'menu', node: { kind: 'workspace', id: w.id } })));
      d.appendChild(acts);
      d.addEventListener('click', () => run('corgi.agent.workspaceOpen', { kind: 'workspace', id: w.id }));
      return d;
    });
    if (out.length === 0) out.push(el('div', 'empty', 'No workspaces yet. Add one from a folder with a corgi-compose.yml.'));
    body('workspaces').replaceChildren(...out);
  };

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.type !== 'state' || !m.state) return;
    last = m.state;
    drawInstall(m.state.installed !== false);
    drawDaemon(m.state.daemon || { running: false, version: '', muted: '' });
    drawUsage(m.state.accounts || []);
    drawInbox(m.state);
    drawBoard(m.state);
    drawSessions(m.state);
    drawWorkspaces(m.state);
  });
  vscode.postMessage({ type: 'ready' });
})();
</script></body></html>`;
}
