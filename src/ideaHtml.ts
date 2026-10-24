import { formatElapsed } from './agentBoard';
import { afterLine, findQuote, isAgent, isOpen, occurrences, openUnder, personReplied, pickOccurrence, sentLabel, sharedHead, sharedTail, statusLabel, typeLabel, waitsOnPerson } from './idea';

/** The pure functions the page script shares with the host, by their source: each references nothing but the others. */
export const sharedFunctions = [sharedTail, sharedHead, occurrences, pickOccurrence, findQuote, isAgent, personReplied, waitsOnPerson, isOpen, statusLabel, typeLabel, afterLine, openUnder, sentLabel, formatElapsed];

/**
 * The shared functions as the webview's own script: each is emitted under
 * the name it has at runtime (what the bodies of the others refer to) and
 * under the name the page script calls. Webpack is told not to mangle or
 * rename (webpack.config.js), so the two are the same in a release build;
 * the alias keeps the page working even if that changes.
 */
export const sharedNames = ['sharedTail', 'sharedHead', 'occurrences', 'pickOccurrence', 'findQuote', 'isAgent', 'personReplied', 'waitsOnPerson', 'isOpen', 'statusLabel', 'typeLabel', 'afterLine', 'openUnder', 'sentLabel', 'formatElapsed'];

export function sharedScript(): string {
    return sharedFunctions.map((f, i) => {
        const runtime = f.name || sharedNames[i];
        const source = f.toString();
        const declared = /^(?:async\s+)?function\b/.test(source) ? source : `const ${runtime} = ${source};`;
        return runtime === sharedNames[i] ? declared : `${declared}\nconst ${sharedNames[i]} = ${runtime};`;
    }).join('\n');
}

/**
 * The idea page beside the code: the page the agent wrote on the left,
 * the comments on the right. One HTML string on VS Code's theme tokens,
 * one script under a nonce. The script draws what the extension posts
 * (`corgi idea show --json`) and sends back what the person did; it never
 * runs corgi. The page's own `html` is rendered by corgi with raw HTML
 * stripped, and is the only thing set as innerHTML - comments, names and
 * every other string are built with createElement and textContent. Pure,
 * so it is tested without vscode.
 *
 * Webview → host: ready, comment {text, quote, prefix, suffix, heading, link?, files?},
 * pickFiles, reply {id, text}, status {id, status}, build, send {to},
 * openMarkdown, openBrowser, openLink {url}. Host → webview: doc {doc},
 * picked {files}, busy {what}, error {msg}.
 */
export function ideaPage(nonce: string, cspSource = ''): string {
    const img = cspSource ? `${cspSource} data:` : `'none'`;
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${img};">
<style>
  :root {
    color-scheme: light dark;
    --fg: var(--vscode-foreground);
    --dim: var(--vscode-descriptionForeground);
    --bg: var(--vscode-editor-background);
    --panel: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
    --line: var(--vscode-panel-border, var(--vscode-editorWidget-border, rgba(128,128,128,.35)));
    --link: var(--vscode-textLink-foreground);
    --btn: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --quiet: var(--vscode-button-secondaryBackground);
    --quiet-fg: var(--vscode-button-secondaryForeground);
    --input: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, transparent);
    --focus: var(--vscode-focusBorder);
    --badge: var(--vscode-badge-background);
    --badge-fg: var(--vscode-badge-foreground);
    --code: var(--vscode-textCodeBlock-background, rgba(128,128,128,.15));
    --mono: var(--vscode-editor-font-family, monospace);
    --bar: var(--vscode-progressBar-background, var(--link));
    --hover: var(--vscode-list-hoverBackground);
    --open: var(--vscode-editor-findMatchHighlightBackground, rgba(234,160,0,.35));
    --answered: rgba(0,122,204,.22);
    --fixed: rgba(60,180,90,.25);
    --resolved: rgba(128,128,128,.18);
    --live: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
    --warn: var(--vscode-notificationsWarningIcon-foreground);
    --err: var(--vscode-errorForeground);
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 var(--vscode-font-family); color: var(--fg); background: var(--bg); -webkit-font-smoothing: antialiased; }
  button { font: inherit; color: var(--btn-fg); background: var(--btn); border: 0; border-radius: 4px; padding: 4px 12px; cursor: pointer; white-space: nowrap; }
  button:hover { background: var(--btn-hover); }
  button.quiet { background: var(--quiet); color: var(--quiet-fg); }
  button.link { background: transparent; color: var(--link); padding: 2px 4px; }
  button.link:hover { text-decoration: underline; background: transparent; }
  button:disabled { opacity: .5; cursor: default; }
  textarea, input { font: inherit; color: var(--input-fg); background: var(--input); border: 1px solid var(--input-border); border-radius: 4px; padding: 6px 8px; width: 100%; }
  textarea { resize: vertical; min-height: 56px; }
  textarea.quick { min-height: 0; height: 30px; padding: 5px 8px; resize: none; overflow: hidden; }
  textarea:focus, input:focus { outline: 1px solid var(--focus); }
  a { color: var(--link); text-decoration: none; cursor: pointer; }
  a:hover { text-decoration: underline; }
  #progress { position: fixed; top: 0; left: 0; height: 3px; width: 0; background: var(--bar); z-index: 6; transition: width .08s linear; }
  #top { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 10px; padding: 8px 16px; background: var(--bg); border-bottom: 1px solid var(--line); }
  #top h1 { margin: 0; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  #top .sp { flex: 1; }
  .pill { display: inline-block; padding: 0 7px; border-radius: 9px; font-size: 11px; line-height: 18px; color: var(--badge-fg); background: var(--badge); white-space: nowrap; }
  .pill.type { background: transparent; color: var(--dim); border: 1px solid var(--line); text-transform: none; }
  .pill.prop { background: var(--warn); color: #000; }
  .pill.st-open { background: var(--open); color: var(--fg); }
  .pill.st-answered { background: var(--answered); color: var(--fg); }
  .pill.st-fixed { background: var(--fixed); color: var(--fg); }
  .pill.st-resolved { background: var(--resolved); color: var(--dim); }
  #answering { display: inline-flex; align-items: center; gap: 6px; color: var(--dim); font-size: 12px; white-space: nowrap; }
  #answering .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--live); animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .3; } }
  @media (prefers-reduced-motion: reduce) { #answering .dot { animation: none; } #progress { transition: none; } }
  #busy, #err { padding: 6px 16px; font-size: 12px; border-bottom: 1px solid var(--line); }
  #busy { color: var(--dim); }
  #err { color: var(--err); }
  main { display: flex; gap: 0; align-items: flex-start; }
  #left { flex: 1 1 0; min-width: 0; padding: 12px 28px 48px; max-width: 860px; }
  #side { flex: 0 0 360px; position: sticky; top: 41px; max-height: calc(100vh - 41px); overflow: auto; border-left: 1px solid var(--line); background: var(--panel); padding: 10px 12px 24px; }
  @media (max-width: 760px) {
    main { flex-direction: column; }
    #left { padding: 12px 16px 24px; }
    #side { position: static; flex: none; width: 100%; max-height: none; border-left: 0; border-top: 1px solid var(--line); }
  }
  article { font-size: 14px; line-height: 1.6; }
  article h1 { font-size: 24px; margin: 8px 0 12px; }
  article h2 { font-size: 18px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
  article h3 { font-size: 15px; margin: 18px 0 6px; }
  article h2, article h3 { position: relative; padding-right: 96px; scroll-margin-top: 48px; }
  article h2.cur::before { content: ""; position: absolute; left: -14px; top: 6px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--bar); }
  /* The section's comment button: no text node of its own, so the article's text stays the markdown's. */
  button.hc { position: absolute; right: 0; top: 50%; transform: translateY(-50%); display: none; font-size: 11px; line-height: 20px; padding: 0 8px; background: var(--quiet); color: var(--quiet-fg); }
  button.hc::before { content: "+ comment"; }
  article h2:hover button.hc, article h3:hover button.hc, button.hc:focus-visible { display: inline-block; }
  article p, article ul, article ol { margin: 0 0 10px; }
  article li { margin: 2px 0; }
  article code { font-family: var(--mono); font-size: 12px; background: var(--code); padding: 1px 4px; border-radius: 3px; }
  article pre { background: var(--code); padding: 10px 12px; border-radius: 4px; overflow: auto; }
  article pre code { background: transparent; padding: 0; }
  article blockquote { margin: 0 0 10px; padding: 2px 12px; border-left: 3px solid var(--line); color: var(--dim); }
  article table { border-collapse: collapse; margin: 0 0 10px; }
  article th, article td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; }
  article img { max-width: 100%; }
  article mark { color: inherit; background: var(--open); border-radius: 2px; cursor: pointer; padding: 1px 0; }
  article mark.st-answered { background: var(--answered); }
  article mark.st-fixed { background: var(--fixed); }
  article mark.st-resolved { background: var(--resolved); }
  article mark.lit { outline: 2px solid var(--focus); }
  #empty { color: var(--dim); padding: 24px 0; }
  .endcap { margin-top: 24px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
  .endcap h3 { margin: 0; font-size: 14px; }
  #tickets .head { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer; user-select: none; }
  #tickets .head .chev { width: 12px; font-size: 10px; color: var(--dim); text-align: center; }
  #tickets.closed .list { display: none; }
  #tickets .list { padding: 0 8px 8px; }
  .tk { padding: 6px 8px; border-radius: 4px; cursor: pointer; }
  .tk:hover { background: var(--hover); }
  .tk .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .tk .n { color: var(--dim); font-variant-numeric: tabular-nums; min-width: 22px; }
  .tk .title { flex: 1; min-width: 120px; }
  .tk .ref { font-family: var(--mono); font-size: 12px; }
  .tk .after { color: var(--dim); font-size: 12px; }
  .tk .body { display: none; margin: 6px 0 2px 30px; color: var(--dim); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  .tk.open .body { display: block; }
  #sent { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 12px; }
  #sent:empty { display: none; }
  .chip { display: inline-block; padding: 1px 9px; border-radius: 10px; font-size: 12px; border: 1px solid var(--line); color: var(--fg); background: var(--bg); }
  a.chip { color: var(--link); }
  #hand { padding: 14px 16px; }
  #hand h3 { margin-bottom: 6px; }
  #hand .line { color: var(--dim); font-size: 12px; margin-bottom: 8px; }
  #hand ul { margin: 0 0 10px; padding-left: 18px; }
  #hand li .state { color: var(--dim); font-size: 12px; margin-left: 6px; }
  #hand .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  #outline { margin-bottom: 10px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  #outline .head { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--dim); cursor: pointer; user-select: none; padding: 2px 0 6px; }
  #outline .head .chev { width: 12px; font-size: 10px; text-align: center; }
  #outline.closed .list { display: none; }
  #outline .h { display: flex; align-items: center; gap: 6px; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 12px; color: var(--dim); }
  #outline .h:hover { background: var(--hover); color: var(--fg); }
  #outline .h.cur { color: var(--fg); font-weight: 600; }
  #outline .h .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #outline .h .n { font-size: 11px; padding: 0 6px; border-radius: 8px; background: var(--open); color: var(--fg); }
  #filter { display: flex; gap: 4px; margin-bottom: 10px; }
  #filter button { background: transparent; color: var(--dim); padding: 2px 8px; border-radius: 10px; font-size: 12px; }
  #filter button.on { background: var(--badge); color: var(--badge-fg); }
  #filter button:hover { color: var(--fg); }
  .card { padding: 10px 12px; margin-bottom: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); }
  .card.resolved { opacity: .7; }
  .card.lit { outline: 2px solid var(--focus); }
  .head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; margin-bottom: 4px; }
  .head .by { font-weight: 600; }
  .head .by.agent::before { content: "✦ "; color: var(--live); }
  .head .when { color: var(--dim); }
  .head .sp { flex: 1; }
  .quote { font-size: 12px; color: var(--dim); border-left: 3px solid var(--open); padding: 2px 8px; margin: 4px 0 6px; cursor: pointer; white-space: pre-wrap; word-break: break-word; max-height: 64px; overflow: hidden; }
  .quote.st-answered { border-color: var(--answered); }
  .quote.st-fixed { border-color: var(--fixed); }
  .quote.st-resolved { border-color: var(--resolved); }
  .quote:hover { color: var(--fg); }
  .text { white-space: pre-wrap; word-break: break-word; }
  .links { margin-top: 4px; font-size: 12px; }
  .links a { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .files { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
  .files img { max-width: 100%; max-height: 180px; border-radius: 4px; border: 1px solid var(--line); }
  .files .file { font-size: 12px; color: var(--dim); background: var(--code); padding: 1px 6px; border-radius: 3px; }
  .reply { margin-top: 8px; padding: 6px 0 0 10px; border-left: 2px solid var(--line); }
  .reply .changed { color: var(--live); font-size: 11px; }
  .acts { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
  .acts button { font-size: 12px; padding: 2px 8px; }
  .acts button.yes { background: var(--live); color: #000; }
  .quickbox { margin-top: 8px; }
  .box .row, #composer .row { display: flex; gap: 6px; margin-top: 6px; justify-content: flex-end; }
  #composer { padding: 10px 12px; margin-bottom: 10px; border: 1px solid var(--focus); border-radius: 6px; background: var(--bg); }
  #composer .what { font-size: 12px; color: var(--dim); margin-bottom: 6px; }
  #composer .quote { cursor: default; }
  #composer input { margin-top: 6px; }
  #composer .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  #composer .chips:empty { display: none; }
  #composer .chip button { padding: 0 4px; margin-left: 4px; font-size: 12px; line-height: 1; background: transparent; color: var(--dim); }
  #composer .chip button:hover { color: var(--err); }
  #composer .row .left { margin-right: auto; }
  #float { position: absolute; z-index: 5; padding: 3px 10px; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
  .none { color: var(--dim); font-size: 12px; padding: 8px 2px; }
</style></head><body>
<div id="progress"></div>
<header id="top">
  <h1 id="title">idea</h1>
  <span id="type" class="pill type" hidden></span>
  <span id="status" class="pill" hidden></span>
  <span id="answering" hidden><span class="dot"></span><span>agent is answering…</span></span>
  <span class="sp"></span>
  <button id="editMd" class="quiet" title="Open idea.md in an editor; comments show as threads there">Edit markdown</button>
  <button id="browser" class="quiet" title="The same page in the browser (needs corgi agent up)">Open in browser</button>
  <button id="buildTop" title="Hand the page to the agent: it plans the work and starts">Build it</button>
</header>
<div id="busy" hidden></div>
<div id="err" hidden></div>
<main>
  <div id="left">
    <article id="page"></article>
    <div id="empty" hidden>Loading the page…</div>
    <section id="tickets" class="endcap closed" hidden></section>
    <div id="sent"></div>
    <section id="hand" class="endcap" hidden></section>
  </div>
  <aside id="side">
    <div id="outline" hidden></div>
    <div id="filter"></div>
    <div id="composer" hidden></div>
    <div id="comments"></div>
  </aside>
</main>
<button id="float" hidden>Comment</button>
<script nonce="${nonce}">
${sharedScript()}
(() => {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  let filter = typeof saved.filter === 'string' ? saved.filter : 'all';
  let outlineOpen = saved.outlineOpen !== false;
  let ticketsOpen = saved.ticketsOpen === true;
  let doc = null;
  let pending = null;
  let composing = null;
  let attached = [];
  // Drafts in the quick reply boxes survive a redraw (the page re-reads whenever a file changes).
  const drafts = {};
  const openTickets = new Set();
  const CONTEXT = 40;
  const $ = (id) => document.getElementById(id);
  const page = $('page');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const post = (m) => vscode.postMessage(m);
  const button = (label, cls, onClick) => { const b = el('button', cls, label); b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b; };
  const persist = () => vscode.setState({ filter, outlineOpen, ticketsOpen });
  const ago = (at) => formatElapsed(at) || (at ? 'just now' : '');
  const httpUrl = (u) => typeof u === 'string' && /^https?:\\/\\//i.test(u);
  const idOf = (c) => String(c.id);

  // The article as one string: its text nodes in order, with offsets.
  const textNodes = () => {
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const out = [];
    let off = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { out.push({ node: n, start: off, end: off + n.data.length }); off += n.data.length; }
    return out;
  };
  const textOf = (nodes) => nodes.map((n) => n.node.data).join('');
  const offsetOf = (nodes, node, offset) => {
    if (node.nodeType === 3) { const t = nodes.find((x) => x.node === node); return t ? t.start + offset : -1; }
    const child = node.childNodes[offset];
    if (child) { for (const t of nodes) if (child === t.node || child.contains(t.node)) return t.start; }
    let end = -1;
    for (const t of nodes) if (node.contains(t.node)) end = t.end;
    return end;
  };
  // findQuote, waitsOnPerson, statusLabel and the rest come from the shared block above: the host's own code.
  const headingAbove = (nodes, start) => {
    let h = '';
    for (const e of page.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const t = nodes.find((n) => e.contains(n.node));
      if (!t) continue;
      if (t.start > start) break;
      h = e.textContent.trim();
    }
    return h;
  };
  // Wrap text[start, end) in <mark>: each text node it crosses is split and wrapped on its own.
  const wrap = (start, end, cls, id) => {
    for (const t of textNodes()) {
      const s = Math.max(start, t.start), e = Math.min(end, t.end);
      if (s >= e) continue;
      let node = t.node;
      if (s > t.start) node = node.splitText(s - t.start);
      if (e < t.end) node.splitText(e - s);
      const m = el('mark', 'st-' + cls);
      m.dataset.id = id;
      node.parentNode.insertBefore(m, node);
      m.appendChild(node);
    }
  };
  const markAnchors = () => {
    const comments = (doc.comments || []).filter((c) => c.anchor && c.anchor.quote);
    // Resolved first, so a live mark sits inside a resolved one, not under it.
    comments.sort((a, b) => Number(b.status === 'resolved') - Number(a.status === 'resolved'));
    for (const c of comments) {
      const hit = findQuote(textOf(textNodes()), c.anchor);
      if (hit) wrap(hit.start, hit.end, c.status || 'open', idOf(c));
    }
    for (const m of page.querySelectorAll('mark[data-id]')) m.addEventListener('click', () => lit(m.dataset.id, true));
  };
  const lit = (id, toCard) => {
    for (const x of document.querySelectorAll('.lit')) x.classList.remove('lit');
    for (const m of page.querySelectorAll('mark[data-id]')) if (m.dataset.id === id) m.classList.add('lit');
    const card = $('c-' + id);
    if (card) card.classList.add('lit');
    const target = toCard ? card : page.querySelector('mark[data-id="' + CSS.escape(String(id)) + '"]');
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const drawTop = () => {
    const idea = doc.idea || {};
    $('title').textContent = idea.title || idea.name || idea.slug || 'idea';
    document.title = $('title').textContent;
    const ty = $('type');
    ty.hidden = false;
    ty.textContent = typeLabel(idea.type);
    const st = $('status');
    st.hidden = false;
    st.textContent = idea.status === 'building' ? 'building' : idea.status === 'built' ? 'built' : 'draft';
    $('answering').hidden = !idea.answering;
    $('buildTop').disabled = idea.status === 'building';
  };

  // Every h2 and h3 gets a "+ comment" at its right end on hover: a comment on the section, quote = the heading.
  const headingButtons = () => {
    for (const h of page.querySelectorAll('h2, h3')) {
      const text = h.textContent.trim();
      if (!text) continue;
      const b = el('button', 'hc');
      b.title = 'Comment on this section';
      b.setAttribute('aria-label', 'Comment on ' + text);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => { e.stopPropagation(); openComposer({ quote: text, prefix: '', suffix: '', heading: text }); });
      h.appendChild(b);
    }
  };

  const drawPage = () => {
    // The one place markup is set from data: corgi rendered the markdown with raw HTML stripped and safe links only.
    page.innerHTML = String(doc.html || '');
    $('empty').hidden = !!doc.html;
    $('empty').textContent = 'The page is empty.';
    for (const a of page.querySelectorAll('a[href]')) a.addEventListener('click', (e) => { e.preventDefault(); const u = a.getAttribute('href'); if (httpUrl(u)) post({ type: 'openLink', url: u }); });
    markAnchors();
    headingButtons();
  };

  const tickets = () => (Array.isArray(doc.tickets) && doc.tickets.length ? doc.tickets : Array.isArray(doc.idea && doc.idea.tickets) ? doc.idea.tickets : []).filter((t) => t && t.title);

  // The agent's split into tickets, folded: number, title, ref, state, "after 1, 2"; a click shows the body.
  const drawTickets = () => {
    const sec = $('tickets');
    const list = tickets();
    sec.hidden = list.length === 0;
    sec.classList.toggle('closed', !ticketsOpen);
    if (!list.length) { sec.replaceChildren(); return; }
    const head = el('div', 'head');
    head.append(el('span', 'chev', ticketsOpen ? '▾' : '▸'), el('h3', '', 'Tickets (' + list.length + ')'));
    head.addEventListener('click', () => { ticketsOpen = !ticketsOpen; persist(); drawTickets(); });
    const box = el('div', 'list');
    for (const t of list) {
      const d = el('div', 'tk' + (openTickets.has(String(t.id)) ? ' open' : ''));
      const row = el('div', 'row');
      row.append(el('span', 'n', String(t.id)), el('span', 'title', t.title));
      if (t.ref) {
        if (httpUrl(t.url)) { const a = el('a', 'ref', t.ref); a.addEventListener('click', (e) => { e.stopPropagation(); post({ type: 'openLink', url: t.url }); }); row.appendChild(a); }
        else row.appendChild(el('span', 'ref', t.ref));
      }
      if (t.state) row.appendChild(el('span', 'pill', t.state));
      if (afterLine(t)) row.appendChild(el('span', 'after', afterLine(t)));
      d.appendChild(row);
      d.appendChild(el('div', 'body', t.body || 'No description.'));
      d.addEventListener('click', () => { const k = String(t.id); if (openTickets.has(k)) openTickets.delete(k); else openTickets.add(k); d.classList.toggle('open'); });
      box.appendChild(d);
    }
    sec.replaceChildren(head, box);
  };

  // Where the page went: an epic, tickets, a wiki page, as chips.
  const drawSent = () => {
    const list = (Array.isArray(doc.sent) && doc.sent.length ? doc.sent : Array.isArray(doc.idea && doc.idea.sent) ? doc.idea.sent : []).filter((l) => l && (l.ref || l.title));
    const out = [];
    for (const l of list) {
      const label = sentLabel(l);
      if (httpUrl(l.url)) { const a = el('a', 'chip', label); a.title = l.url; a.addEventListener('click', () => post({ type: 'openLink', url: l.url })); out.push(a); }
      else out.push(el('span', 'chip', label));
    }
    $('sent').replaceChildren(...out);
  };

  const drawHand = () => {
    const hand = $('hand');
    hand.hidden = false;
    const idea = doc.idea || {};
    const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
    const plan = doc.plan;
    const out = [el('h3', '', 'Hand it to the agent')];
    const bits = [];
    if (idea.status === 'building') bits.push('building now');
    else if (idea.status === 'built') bits.push('built');
    else bits.push('a draft: comment until it reads right, then build it');
    if (plan && plan.ref) bits.push('plan ' + plan.ref + (plan.state ? ' · ' + plan.state : '') + (typeof plan.done === 'number' ? ' · ' + plan.done + ' done' : '') + (typeof plan.doing === 'number' && plan.doing ? ' · ' + plan.doing + ' doing' : '') + (typeof plan.todo === 'number' && plan.todo ? ' · ' + plan.todo + ' to do' : ''));
    if (typeof doc.forAgent === 'number' && doc.forAgent) bits.push(doc.forAgent + ' waiting on the agent');
    out.push(el('div', 'line', bits.join(' · ')));
    // The tasks list only when the agent has not split the page into tickets.
    if (tasks.length && !tickets().length) {
      const ul = el('ul');
      for (const t of tasks) {
        const li = el('li', '', [t.ref || t.key, t.title].filter(Boolean).join('  '));
        if (t.state) li.appendChild(el('span', 'state', t.state));
        ul.appendChild(li);
      }
      out.push(ul);
    }
    const acts = el('div', 'acts');
    const build = button(idea.status === 'building' ? 'Building…' : 'Build it', '', () => post({ type: 'build' }));
    build.disabled = idea.status === 'building';
    acts.appendChild(build);
    const send = doc.send || {};
    for (const to of ['jira', 'linear', 'confluence']) {
      if (send[to]) acts.appendChild(button('Send to ' + to, 'quiet', () => post({ type: 'send', to })));
    }
    acts.appendChild(button('Comment on the whole page', 'quiet', () => openComposer(null)));
    out.push(acts);
    hand.replaceChildren(...out);
  };

  const shown = (c) => filter === 'open' ? c.status !== 'resolved' : filter === 'proposals' ? c.kind === 'proposal' : filter === 'resolved' ? c.status === 'resolved' : true;

  // On this page: the h2 headings, how many open comments sit under each, the one in view marked.
  const drawOutline = () => {
    const box = $('outline');
    const heads = [...page.querySelectorAll('h2')].filter((h) => h.textContent.trim());
    box.hidden = heads.length === 0;
    box.classList.toggle('closed', !outlineOpen);
    if (!heads.length) { box.replaceChildren(); return; }
    const comments = doc.comments || [];
    const head = el('div', 'head');
    head.append(el('span', 'chev', outlineOpen ? '▾' : '▸'), el('span', '', 'On this page'));
    head.addEventListener('click', () => { outlineOpen = !outlineOpen; persist(); drawOutline(); });
    const list = el('div', 'list');
    for (const h of heads) {
      const text = h.textContent.trim();
      const row = el('div', 'h');
      row.dataset.heading = text;
      row.appendChild(el('span', 't', text));
      const n = openUnder(comments, text);
      if (n) row.appendChild(el('span', 'n', String(n)));
      row.addEventListener('click', () => h.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      list.appendChild(row);
    }
    box.replaceChildren(head, list);
    current();
  };
  // The heading in view: the last h2 that starts above the fold.
  const current = () => {
    const heads = [...page.querySelectorAll('h2')];
    let cur = null;
    for (const h of heads) { if (h.getBoundingClientRect().top <= 70) cur = h; else break; }
    for (const h of heads) h.classList.toggle('cur', h === cur);
    const text = cur ? cur.textContent.trim() : '';
    for (const row of document.querySelectorAll('#outline .h')) row.classList.toggle('cur', !!text && row.dataset.heading === text);
  };
  // The reading bar: how far down the article the window is.
  const progress = () => {
    const top = page.offsetTop;
    const span = Math.max(1, page.offsetHeight - window.innerHeight + 60);
    const pct = Math.max(0, Math.min(1, (window.scrollY - top + 60) / span));
    $('progress').style.width = (pct * 100) + '%';
  };
  window.addEventListener('scroll', () => { progress(); current(); }, { passive: true });
  window.addEventListener('resize', () => { progress(); current(); });

  const drawFilter = () => {
    const comments = doc.comments || [];
    const counts = { all: comments.length, open: comments.filter((c) => c.status !== 'resolved').length, proposals: comments.filter((c) => c.kind === 'proposal').length, resolved: comments.filter((c) => c.status === 'resolved').length };
    const out = [];
    for (const [key, label] of [['all', 'All'], ['open', 'Open'], ['proposals', 'Proposals'], ['resolved', 'Resolved']]) {
      const b = button(label + (counts[key] ? ' ' + counts[key] : ''), filter === key ? 'on' : '', () => { filter = key; persist(); drawFilter(); drawComments(); });
      out.push(b);
    }
    $('filter').replaceChildren(...out);
  };

  const linksOf = (list) => {
    const urls = (list || []).filter(httpUrl);
    if (!urls.length) return null;
    const box = el('div', 'links');
    for (const u of urls) { const a = el('a', '', u); a.title = u; a.addEventListener('click', () => post({ type: 'openLink', url: u })); box.appendChild(a); }
    return box;
  };
  const filesOf = (list) => {
    const files = (list || []).filter((f) => f && f.name);
    if (!files.length) return null;
    const box = el('div', 'files');
    for (const f of files) {
      if (f.uri && /^image\\//.test(f.type || '')) { const im = el('img'); im.src = f.uri; im.alt = f.name; im.title = f.name; box.appendChild(im); }
      else box.appendChild(el('span', 'file', f.name + (f.size ? ' · ' + Math.max(1, Math.round(f.size / 1024)) + ' KB' : '')));
    }
    return box;
  };
  // The one-line reply box under every card: Enter sends, Shift+Enter a new line.
  const quickReply = (c) => {
    const id = idOf(c);
    const box = el('div', 'quickbox');
    const ta = el('textarea', 'quick');
    ta.rows = 1;
    ta.placeholder = waitsOnPerson(c) ? 'Reply to accept - say how, if you like' : 'Reply - Enter sends';
    ta.value = drafts[id] || '';
    const grow = () => { ta.style.height = '30px'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; };
    ta.addEventListener('input', () => { drafts[id] = ta.value; grow(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const t = ta.value.trim();
      if (!t) return;
      delete drafts[id];
      ta.value = '';
      grow();
      post({ type: 'reply', id: c.id, text: t });
    });
    box.appendChild(ta);
    if (ta.value) setTimeout(grow, 0);
    return box;
  };
  const card = (c) => {
    const d = el('div', 'card ' + (c.status || 'open') + (c.kind === 'proposal' ? ' proposal' : ''));
    d.id = 'c-' + idOf(c);
    const head = el('div', 'head');
    head.append(el('span', 'by' + (isAgent(c.by) ? ' agent' : ''), c.by || '?'), el('span', 'when', ago(c.at)));
    if (c.kind === 'proposal') head.appendChild(el('span', 'pill prop', 'proposal'));
    head.appendChild(el('span', 'sp'));
    head.appendChild(el('span', 'pill st-' + (c.status || 'open'), statusLabel(c.status)));
    d.appendChild(head);
    if (c.anchor && c.anchor.quote) {
      const q = el('div', 'quote st-' + (c.status || 'open'), c.anchor.quote);
      q.title = (c.anchor.heading ? 'under ' + c.anchor.heading + ' - ' : '') + 'show on the page';
      q.addEventListener('click', () => lit(idOf(c), false));
      d.appendChild(q);
    }
    d.appendChild(el('div', 'text', c.text || ''));
    const links = linksOf(c.links); if (links) d.appendChild(links);
    const files = filesOf(c.files); if (files) d.appendChild(files);
    for (const r of c.replies || []) {
      const rd = el('div', 'reply');
      const rh = el('div', 'head');
      rh.append(el('span', 'by' + (isAgent(r.by) ? ' agent' : ''), r.by || '?'), el('span', 'when', ago(r.at)));
      if (r.changed) rh.appendChild(el('span', 'changed', '✎ changed the page'));
      rd.append(rh, el('div', 'text', r.text || ''));
      const rl = linksOf(r.links); if (rl) rd.appendChild(rl);
      const rf = filesOf(r.files); if (rf) rd.appendChild(rf);
      d.appendChild(rd);
    }
    const acts = el('div', 'acts');
    if (waitsOnPerson(c)) {
      acts.appendChild(button('Accept', 'yes', () => post({ type: 'reply', id: c.id, text: 'Go ahead.' })));
      acts.appendChild(button('Dismiss', 'quiet', () => post({ type: 'status', id: c.id, status: 'resolved' })));
    } else if (c.status === 'resolved') {
      acts.appendChild(button('Reopen', 'link', () => post({ type: 'status', id: c.id, status: 'open' })));
    } else {
      acts.appendChild(button('Resolve', 'link', () => post({ type: 'status', id: c.id, status: 'resolved' })));
    }
    d.appendChild(acts);
    d.appendChild(quickReply(c));
    return d;
  };
  const drawComments = () => {
    const all = doc.comments || [];
    const list = all.filter(shown).slice().sort((a, b) => String(b.updatedAt || b.at || '').localeCompare(String(a.updatedAt || a.at || '')));
    const out = list.map(card);
    if (!out.length) out.push(el('div', 'none', all.length ? 'Nothing under this filter.' : 'No comments yet. Select words on the page and press Comment.'));
    $('comments').replaceChildren(...out);
  };

  const openComposer = (sel) => {
    composing = sel ? { quote: sel.quote, prefix: sel.prefix, suffix: sel.suffix, heading: sel.heading } : { quote: '', prefix: '', suffix: '', heading: '' };
    const box = $('composer');
    box.hidden = false;
    const onSection = composing.quote && composing.quote === composing.heading;
    const what = el('div', 'what', onSection ? 'On the section ' + composing.heading : composing.quote ? 'On these words' + (composing.heading ? ' under ' + composing.heading : '') : 'On the whole page');
    const ta = el('textarea');
    ta.placeholder = composing.quote ? 'What about this? The agent answers in the thread and amends the page.' : 'What should change? The agent answers and amends the page.';
    const link = el('input');
    link.type = 'url'; link.placeholder = 'Link (optional)';
    const chips = el('div', 'chips');
    const row = el('div', 'row');
    const attach = button('Attach…', 'quiet left', () => post({ type: 'pickFiles' }));
    attach.title = 'Files to attach to the comment';
    row.appendChild(attach);
    row.appendChild(button('Cancel', 'quiet', closeComposer));
    row.appendChild(button('Comment', '', () => {
      const t = ta.value.trim();
      if (!t) return;
      const m = { type: 'comment', text: t, quote: composing.quote, prefix: composing.prefix, suffix: composing.suffix, heading: composing.heading, files: attached.map((f) => f.path) };
      if (httpUrl(link.value.trim())) m.link = link.value.trim();
      post(m);
      closeComposer();
    }));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); row.lastChild.click(); } });
    const parts = [what];
    if (composing.quote && !onSection) parts.push(el('div', 'quote', composing.quote));
    parts.push(ta, link, chips, row);
    box.replaceChildren(...parts);
    $('float').hidden = true;
    $('side').scrollTop = 0;
    box.scrollIntoView({ block: 'nearest' });
    ta.focus();
  };
  const closeComposer = () => { composing = null; attached = []; const box = $('composer'); box.hidden = true; box.replaceChildren(); };
  // The picked files as chips in the composer, each with an × that drops it.
  const drawChips = () => {
    const chips = document.querySelector('#composer .chips');
    if (!chips) return;
    chips.replaceChildren(...attached.map((f) => {
      const c = el('span', 'chip', f.name);
      c.title = f.path;
      const x = button('×', '', () => { attached = attached.filter((g) => g.path !== f.path); drawChips(); });
      x.title = 'Remove';
      c.appendChild(x);
      return c;
    }));
  };

  // Highlight to comment: a floating button over the selection, inside the article only.
  document.addEventListener('selectionchange', () => {
    const float = $('float');
    const sel = document.getSelection();
    if (!doc || !sel || sel.isCollapsed || !sel.rangeCount) { float.hidden = true; return; }
    const r = sel.getRangeAt(0);
    if (!page.contains(r.startContainer) || !page.contains(r.endContainer)) { float.hidden = true; return; }
    const nodes = textNodes();
    const text = textOf(nodes);
    const start = offsetOf(nodes, r.startContainer, r.startOffset);
    const end = offsetOf(nodes, r.endContainer, r.endOffset);
    if (start < 0 || end <= start || !text.slice(start, end).trim()) { float.hidden = true; return; }
    pending = { quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - CONTEXT), start), suffix: text.slice(end, end + CONTEXT), heading: headingAbove(nodes, start) };
    const rect = r.getBoundingClientRect();
    float.style.left = Math.max(8, rect.left + window.scrollX) + 'px';
    float.style.top = Math.max(8, rect.top + window.scrollY - 30) + 'px';
    float.hidden = false;
  });
  $('float').addEventListener('mousedown', (e) => e.preventDefault());
  $('float').addEventListener('click', () => { if (pending) openComposer(pending); });
  $('editMd').addEventListener('click', () => post({ type: 'openMarkdown' }));
  $('browser').addEventListener('click', () => post({ type: 'openBrowser' }));
  $('buildTop').addEventListener('click', () => post({ type: 'build' }));

  const render = () => {
    const y = window.scrollY;
    const focused = document.activeElement && document.activeElement.classList.contains('quick') ? document.activeElement.closest('.card').id : '';
    drawTop();
    drawPage();
    drawTickets();
    drawSent();
    drawHand();
    drawOutline();
    drawFilter();
    drawComments();
    window.scrollTo(0, y);
    progress();
    current();
    if (focused) { const ta = document.querySelector('#' + CSS.escape(focused) + ' textarea.quick'); if (ta) ta.focus({ preventScroll: true }); }
  };
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.type === 'doc' && m.doc) { doc = m.doc; $('err').hidden = true; render(); }
    else if (m.type === 'picked') {
      if (!composing) return;
      for (const f of Array.isArray(m.files) ? m.files : []) if (f && typeof f.path === 'string' && !attached.some((g) => g.path === f.path)) attached.push({ path: f.path, name: String(f.name || f.path) });
      drawChips();
    }
    else if (m.type === 'busy') { const b = $('busy'); b.textContent = m.what || ''; b.hidden = !m.what; }
    else if (m.type === 'error') { const e = $('err'); e.textContent = m.msg || ''; e.hidden = !m.msg; $('busy').hidden = true; }
  });
  // Times move: "4m" becomes "5m" without a change on disk.
  setInterval(() => { if (doc && !(document.activeElement && document.activeElement.classList.contains('quick'))) drawComments(); }, 60000);
  post({ type: 'ready' });
})();
</script></body></html>`;
}
