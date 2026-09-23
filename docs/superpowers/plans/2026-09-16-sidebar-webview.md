# Sidebar Webview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three tree views in the Corgi activity-bar container with one webview view that shows usage bars, the inbox and the sessions as rows with status dots and hover buttons, and fold the command wall into a toolbar plus one quick pick.

**Architecture:** A pure `sidebarModel.ts` turns the board, the inbox and the hidden-workspace setting into a `SidebarState`; a pure `sidebarHtml.ts` returns the page; `sidebar.ts` is the `WebviewViewProvider` that posts state on change (hash-gated, only while visible) and runs existing commands on request. The three tree providers are deleted.

**Tech Stack:** TypeScript, VS Code extension API (`WebviewViewProvider`), webpack, mocha (plain node tests in `src/test`).

**Spec:** `docs/superpowers/specs/2026-09-16-sidebar-webview-design.md`

## Global Constraints

- No new polling, no new file watchers; reuse `AgentBoardWatcher.onDidChangeBoard` and the 60 s `readInbox` poll.
- `retainContextWhenHidden` stays false; post only while `view.visible`; resend on show.
- No framework, no external script or font; nonce CSP; every board/inbox string via `textContent`.
- Webview → extension command ids pass an allowlist; `open` accepts http(s) only.
- Every existing `corgi.*` / `corgi.agent.*` command id and behaviour stays.
- Commits: subject line only, no body, no trailers (user rule).
- Tests run in plain node: add each new test file name to `src/test/runTest.ts`.

---

### Task 1: `sidebarModel.ts` - the pure state

**Files:**
- Create: `src/sidebarModel.ts`
- Create: `src/test/sidebarModel.test.ts`
- Modify: `src/test/runTest.ts` (add `'sidebarModel'`)

**Interfaces:**
- Consumes: `Board`, `BoardSession`, `BoardAccount`, `liveSessions`, `hideWorkspaces`, `sessionName`, `statusWord`, `statusRank`, `formatElapsed`, `isDrifting`, `isCrossing`, `overlapLine`, `limitLine`, `changesLine`, `testsLine`, `spendLine`, `formatTokens`, `Bot`, `botTitle` from `./agentBoard`; `InboxItem`, `itemName`, `itemDetail`, `elapsed`, `openableUrl`, `groupByWorkspace` from `./watchInbox`.
- Produces:

```ts
export type SessionNode = { kind: 'session'; session: BoardSession };
export type InboxNode = { kind: 'item'; item: InboxItem };
export type Tone = 'ask' | 'bad' | 'live' | 'quiet';
export interface UsageWindow { name: '5h' | '7d'; percent: number; resets: string; warn: string }
export interface SessionRow { id: string; title: string; clause: string; tooltip: string; elapsed: string; tone: Tone; crossing: boolean; can: ('chat' | 'allow' | 'fresh' | 'pr')[]; node: SessionNode }
export interface InboxRow { key: string; name: string; detail: string; tooltip: string; elapsed: string; tone: Tone; url?: string; can: ('work' | 'open' | 'ignore' | 'unblock' | 'pr')[]; node: InboxNode }
export interface SidebarState {
  accounts: { profile: string; windows: UsageWindow[] }[];
  inbox: { workspace: string; rows: InboxRow[] }[];
  sessions: { workspace: string; rows: SessionRow[] }[];
  counts: { inbox: number; active: number };
}
export function groupSessions(board: Board | undefined): { label: string; sessions: BoardSession[] }[]  // moved from agentTree.ts
export function sessionRow(s: BoardSession, bots: Bot[], now: Date): SessionRow
export function inboxRow(item: InboxItem, now: number): InboxRow
export function usageWindows(a: BoardAccount, now: Date): UsageWindow[]
export function build(board: Board | undefined, inbox: InboxItem[], hidden: readonly string[], bots: Bot[], now: Date): SidebarState
```

- [ ] **Step 1: Write the failing tests**

```ts
import * as assert from 'node:assert';
import { build, inboxRow, sessionRow, usageWindows } from '../sidebarModel';
import type { Board, BoardSession } from '../agentBoard';

const now = new Date('2026-09-16T10:00:00Z');
const s = (over: Partial<BoardSession>): BoardSession => ({ id: 'a', label: 'api', status: 'working', statusSince: '2026-09-16T09:50:00Z', ...over });

describe('sidebarModel', () => {
  it('draws two usage windows with a warning past 70', () => {
    const w = usageWindows({ profile: 'p', limits: { fiveHour: { percent: 12, resetsAt: '2026-09-16T13:00:00Z' }, sevenDay: { percent: 75, resetsAt: '2026-09-21T10:00:00Z' } } }, now);
    assert.deepStrictEqual(w.map((x) => [x.name, x.percent, x.resets]), [['5h', 12, 'resets in 3h'], ['7d', 75, 'resets in 5d']]);
  });
  it('says when the forecast runs out', () => {
    const w = usageWindows({ profile: 'p', limits: { fiveHour: { percent: 40 } }, forecast: { fiveHour: { safe: false, exhaustAt: '2026-09-16T11:30:00Z' } } }, now);
    assert.ok(w[0].warn.startsWith('runs out '));
  });
  it('ranks a pending session as ask with allow in can', () => {
    const r = sessionRow(s({ status: 'needs_input', pending: { tool: 'Bash' } }), [], now);
    assert.strictEqual(r.tone, 'ask');
    assert.ok(r.can.includes('allow'));
    assert.ok(r.clause.startsWith('needs you · asks Bash'));
  });
  it('ranks a drifting session as bad with fresh in can', () => {
    const r = sessionRow(s({ drift: ['context 92%'] }), [], now);
    assert.strictEqual(r.tone, 'bad');
    assert.ok(r.can.includes('fresh'));
    assert.ok(r.clause.startsWith('drifting · context 92%'));
  });
  it('adds pr when the session linked one', () => {
    assert.ok(sessionRow(s({ pr: 'https://x/pr/1' }), [], now).can.includes('pr'));
  });
  it('uses the bot title when the session runs as a bot', () => {
    assert.strictEqual(sessionRow(s({ bot: 'reviewer' }), [{ name: 'reviewer', title: 'Reviewer bot' }], now).title, 'Reviewer bot');
  });
  it('groups sessions by workspace only when there are two', () => {
    const one: Board = { sessions: [s({ id: '1' })] };
    const two: Board = { sessions: [s({ id: '1' }), s({ id: '2', label: 'web' })] };
    assert.deepStrictEqual(build(one, [], [], [], now).sessions.map((g) => g.workspace), ['']);
    assert.deepStrictEqual(build(two, [], [], [], now).sessions.map((g) => g.workspace), ['api', 'web']);
  });
  it('drops hidden workspaces and counts the rest', () => {
    const b: Board = { sessions: [s({ id: '1' }), s({ id: '2', label: 'web', status: 'needs_input' })] };
    const st = build(b, [], ['web'], [], now);
    assert.strictEqual(st.sessions[0].rows.length, 1);
    assert.deepStrictEqual(st.counts, { inbox: 0, active: 1 });
  });
  it('marks a blocked inbox row bad with unblock, and an issue with work', () => {
    const r = inboxRow({ key: 'k', ref: 'IMP-1', kind: 'issue.new', blocked: 'breaker', url: 'https://t/1' }, now.getTime());
    assert.strictEqual(r.tone, 'bad');
    assert.deepStrictEqual(r.can, ['work', 'open', 'ignore', 'unblock']);
    assert.strictEqual(r.url, 'https://t/1');
  });
  it('gives a pull request row the pr action', () => {
    assert.ok(inboxRow({ key: 'k', kind: 'pr.review', pr: 'https://g/p/1' }, now.getTime()).can.includes('pr'));
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd corgi_vscode_extension && pnpm run compile-tests && node out/test/runTest.js`
Expected: FAIL, `Cannot find module '../sidebarModel'`

- [ ] **Step 3: Implement `src/sidebarModel.ts`**

```ts
import { Board, BoardAccount, BoardSession, Bot, botTitle, changesLine, formatElapsed, formatTokens, hideWorkspaces, isCrossing, isDrifting, limitLine, liveSessions, overlapLine, sessionName, spendLine, statusRank, statusWord, testsLine } from './agentBoard';
import { InboxItem, elapsed, groupByWorkspace, itemDetail, itemName, openableUrl } from './watchInbox';

// types as in Interfaces above

/** "resets in 3h" / "resets in 5d" / "resets in 40m"; "" without a time. */
function resetsIn(at: string | undefined, now: Date): string {
    if (!at) { return ''; }
    const ms = Date.parse(at) - now.getTime();
    if (Number.isNaN(ms) || ms <= 0) { return ''; }
    const m = Math.round(ms / 60_000);
    if (m < 60) { return `resets in ${m}m`; }
    const h = Math.round(m / 60);
    if (h < 48) { return `resets in ${h}h`; }
    return `resets in ${Math.round(h / 24)}d`;
}

export function usageWindows(a: BoardAccount, now: Date): UsageWindow[] {
    const out: UsageWindow[] = [];
    const five = a.limits?.fiveHour;
    if (five && typeof five.percent === 'number') {
        const f = a.forecast?.fiveHour;
        const warn = f && f.safe === false && f.exhaustAt ? `runs out ${new Date(f.exhaustAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
        out.push({ name: '5h', percent: Math.max(0, Math.min(100, five.percent)), resets: resetsIn(five.resetsAt, now), warn });
    }
    const seven = a.limits?.sevenDay;
    if (seven && typeof seven.percent === 'number') {
        out.push({ name: '7d', percent: Math.max(0, Math.min(100, seven.percent)), resets: resetsIn(seven.resetsAt, now), warn: '' });
    }
    return out;
}

export function groupSessions(board: Board | undefined) { /* body moved verbatim from agentTree.ts */ }

export function sessionRow(s: BoardSession, bots: Bot[], now: Date): SessionRow {
    const bot = s.bot ? bots.find((b) => b.name === s.bot) : undefined;
    const drifting = isDrifting(s);
    const crossing = isCrossing(s);
    const meta = [drifting ? 'drifting' : statusWord(s.status)];
    if (drifting) { meta.push(s.drift![0]); }
    else if (crossing) { meta.push(`⚠ ${overlapLine(s)}`); }
    else if (s.pending?.tool) { meta.push(`asks ${s.pending.tool}`); }
    else if (s.note) { meta.push(`"${s.note}"`); }
    else if (limitLine(s, now)) { meta.push(limitLine(s, now)); }
    else if (s.detail) { meta.push(s.detail); }
    else if (s.branch) { meta.push(s.branch); }
    for (const line of [changesLine(s), testsLine(s), spendLine(s)]) { if (line) { meta.push(line); } }
    if (typeof s.context?.percent === 'number' && s.context.percent > 0) { meta.push(`ctx ${s.context.percent}%`); }
    const tooltip = [ /* the same list agentTree.ts builds for item.tooltip */ ].filter(Boolean).join('\n');
    const tone: Tone = drifting || s.overCap ? 'bad' : s.status === 'needs_input' ? 'ask' : s.status === 'working' ? 'live' : 'quiet';
    const can: SessionRow['can'] = ['chat'];
    if (s.pending) { can.push('allow'); }
    if (drifting) { can.push('fresh'); }
    if (s.pr) { can.push('pr'); }
    return { id: s.id, title: bot ? botTitle(bot) : s.title || sessionName(s), clause: meta.join(' · '), tooltip, elapsed: formatElapsed(s.statusSince, now), tone, crossing, can, node: { kind: 'session', session: s } };
}

export function inboxRow(item: InboxItem, now: number): InboxRow {
    const url = openableUrl(item);
    const issue = (item.kind ?? '').startsWith('issue.') || item.kind === 'task';
    const can: InboxRow['can'] = [];
    if (issue) { can.push('work'); }
    if (url) { can.push('open'); }
    can.push('ignore');
    if (item.blocked) { can.push('unblock'); }
    if (item.pr) { can.push('pr'); }
    return {
        key: item.key, name: itemName(item), detail: itemDetail(item, now), elapsed: elapsed(item.at, now),
        tooltip: [item.title || itemName(item), item.author && item.body ? `${item.author}: ${item.body}` : '', item.blocked ? `blocked: ${item.blocked}` : ''].filter(Boolean).join('\n'),
        tone: item.blocked ? 'bad' : item.session ? 'ask' : 'quiet', url, can, node: { kind: 'item', item },
    };
}

export function build(board: Board | undefined, inbox: InboxItem[], hidden: readonly string[], bots: Bot[], now: Date): SidebarState {
    const shown = hideWorkspaces(board, hidden);
    const groups = groupSessions(shown);
    const sessions = groups.length === 1
        ? [{ workspace: '', rows: groups[0].sessions.map((s) => sessionRow(s, bots, now)) }]
        : groups.map((g) => ({ workspace: g.label, rows: g.sessions.map((s) => sessionRow(s, bots, now)) }));
    const inboxGroups = groupByWorkspace(inbox);
    const inboxOut = inboxGroups.length === 1
        ? [{ workspace: '', rows: inboxGroups[0].items.map((i) => inboxRow(i, now.getTime())) }]
        : inboxGroups.map((g) => ({ workspace: g.workspace, rows: g.items.map((i) => inboxRow(i, now.getTime())) }));
    const live = liveSessions(shown);
    return {
        accounts: (shown?.accounts ?? []).map((a) => ({ profile: a.profile, windows: usageWindows(a, now) })).filter((a) => a.windows.length),
        inbox: inboxOut, sessions,
        counts: { inbox: inbox.length, active: live.filter((s) => s.status === 'working' || s.status === 'needs_input').length },
    };
}
```

Note: `itemDetail` already ends with the elapsed clause; `inboxRow.detail` therefore strips a trailing ` · <elapsed>` when `elapsed` is non-empty, so the page does not show it twice.

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm run compile-tests && node out/test/runTest.js`

- [ ] **Step 5: Commit**

`git add src/sidebarModel.ts src/test/sidebarModel.test.ts src/test/runTest.ts && git commit -m "The sidebar's state is built in one pure module"`

---

### Task 2: `sidebarHtml.ts` - the page

**Files:**
- Create: `src/sidebarHtml.ts`
- Create: `src/test/sidebarHtml.test.ts`
- Modify: `src/test/runTest.ts` (add `'sidebarHtml'`)

**Interfaces:**
- Produces: `export function page(nonce: string): string`.
- The page script expects `{ type: 'state', state: SidebarState }` and posts `{ type: 'ready' }`, `{ type: 'run', command, node }`, `{ type: 'open', url }`, `{ type: 'menu', node }` (the ⋯ on a row: the extension shows the quick pick).

- [ ] **Step 1: Failing tests**

```ts
import * as assert from 'node:assert';
import { page } from '../sidebarHtml';

describe('sidebar page', () => {
  const html = page('abc123');
  it('locks scripts to the nonce', () => {
    assert.ok(html.includes(`script-src 'nonce-abc123'`));
    assert.ok(html.includes(`<script nonce="abc123">`));
  });
  it('never assigns innerHTML', () => {
    assert.ok(!html.includes('innerHTML'));
  });
  it('has the three sections', () => {
    for (const id of ['usage', 'inbox', 'sessions']) { assert.ok(html.includes(`id="${id}"`)); }
  });
});
```

- [ ] **Step 2: Run, expect FAIL (module missing)**

- [ ] **Step 3: Implement**

Structure of the returned string:

```html
<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style> /* tokens: --fg: var(--vscode-foreground); --dim: var(--vscode-descriptionForeground); --hover: var(--vscode-list-hoverBackground); --ask: var(--vscode-notificationsWarningIcon-foreground); --bad: var(--vscode-notificationsErrorIcon-foreground); --live: var(--vscode-charts-green); --bar: var(--vscode-progressBar-background); --track: var(--vscode-scrollbarSlider-background); --link: var(--vscode-textLink-foreground); --btn: var(--vscode-toolbar-hoverBackground) */
  body { margin:0; font: 13px/1.4 var(--vscode-font-family); color: var(--fg); background: transparent; }
  section > h2 { margin:0; padding: 6px 12px 4px 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--dim); display:flex; align-items:center; gap:4px; cursor:pointer; user-select:none; }
  h2 .count { margin-left:auto; font-weight: 500; text-transform:none; letter-spacing:0; }
  h2 .chev { width: 12px; transition: transform .12s; } section.closed .chev { transform: rotate(-90deg); } section.closed .body { display:none; }
  .ws { padding: 2px 12px; font-size: 11px; color: var(--dim); }
  .row { display:flex; align-items:center; gap:8px; padding: 3px 12px 3px 14px; cursor:pointer; position:relative; }
  .row:hover { background: var(--hover); }
  .dot { width:8px; height:8px; border-radius:50%; flex:none; background: var(--dim); }
  .dot.ask { background: var(--ask); } .dot.bad { background: var(--bad); } .dot.live { background: var(--live); animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } } @media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } }
  .main { flex:1; min-width:0; } .title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .clause { color: var(--dim); font-size: 12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .when { color: var(--dim); font-size: 11px; flex:none; } .row:hover .when { display:none; }
  .acts { display:none; gap:2px; position:absolute; right:8px; top:50%; transform:translateY(-50%); background: var(--hover); padding-left: 6px; } .row:hover .acts { display:flex; }
  .acts button { font: inherit; font-size: 11px; color: var(--fg); background: transparent; border: 0; border-radius: 3px; padding: 2px 6px; cursor:pointer; } .acts button:hover { background: var(--btn); }
  .usage { padding: 2px 12px 6px 14px; } .usage .line { display:flex; align-items:center; gap:8px; font-size: 12px; margin: 3px 0; } .usage .name { width: 20px; color: var(--dim); }
  .track { flex:1; height: 4px; border-radius: 2px; background: var(--track); overflow:hidden; } .fill { height: 100%; background: var(--bar); } .fill.ask { background: var(--ask); } .fill.bad { background: var(--bad); }
  .usage .pct { width: 34px; text-align:right; } .usage .resets { color: var(--dim); font-size: 11px; width: 100%; padding-left: 28px; }
  .empty { padding: 6px 14px; color: var(--dim); } .foot { display:flex; gap:12px; padding: 4px 14px 8px; } a { color: var(--link); cursor:pointer; text-decoration:none; } a:hover { text-decoration: underline; }
</style></head><body>
<section id="usage"><h2><span class="chev">▾</span>Usage</h2><div class="body"></div></section>
<section id="inbox"><h2><span class="chev">▾</span>Inbox<span class="count"></span></h2><div class="body"></div></section>
<section id="sessions"><h2><span class="chev">▾</span>Sessions<span class="count"></span></h2><div class="body"></div></section>
<script nonce="${nonce}"> ... </script></body></html>
```

The script (all DOM built with `document.createElement` + `textContent`; helper `el(tag, cls, text)`):

- `const vscode = acquireVsCodeApi(); const saved = vscode.getState() || { closed: [] };`
- Each `h2` click toggles `closed` on its section and saves `{ closed: [...] }` via `vscode.setState`.
- `draw(state)`: usage → per account a `.usage` block: profile line (only when more than one account), then per window `.line` with `.name`, `.track > .fill` (`style.width = percent + '%'`, class `ask` ≥ 70, `bad` ≥ 90), `.pct`, and a `.resets` line with `resets` + (warn ? ` · ${warn}` : ''). Section hidden (`hidden = true`) when no accounts.
- inbox → count badge; per group a `.ws` label when `workspace` is non-empty; per row `.row` with `.dot.<tone>`, `.main > .title + .clause(detail)`, `.when(elapsed)`, `.acts` with buttons from `can`: work→`corgi.agent.inboxWorkOn`, open→`open` message, ignore→`corgi.agent.inboxIgnore`, unblock→`corgi.agent.inboxUnblock`, pr→`menu`; always a trailing `⋯` → `menu`. Row click → `open` when `url`, else `menu`. `title` attribute = tooltip. Empty: `.empty` with "Nothing is waiting on you. The watch puts tickets, review requests, comments and red builds here as it finds them." and an `<a>` "Check again" → `run corgi.sidebar.reload`.
- sessions → count badge `active·N` (or empty when 0); groups as above; row `.dot` (or `⚠` text span when `crossing`), title, clause, elapsed; buttons: chat→`corgi.agent.chat`, allow→`corgi.agent.answer` + deny→`corgi.agent.deny`, fresh→`corgi.agent.fresh`, pr→`corgi.agent.openPr`, `⋯`→`menu`. Row click → `run corgi.agent.focusNode`. `.foot` with "+ New session" → `corgi.agent.new` and "+ Isolated" → `corgi.agent.newIsolated`. Empty: "No sessions. Start one below."
- Buttons call `e.stopPropagation()` so the row click does not fire.
- `window.addEventListener('message', (ev) => { if (ev.data.type === 'state') draw(ev.data.state); })`; then `vscode.postMessage({ type: 'ready' })`.

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** - `"The sidebar page: one HTML string under a nonce CSP"`

---

### Task 3: `sidebar.ts` - the provider, and the wiring

**Files:**
- Create: `src/sidebar.ts`
- Modify: `src/agentStatus.ts` (`registerAgentBoard`: build the sidebar; drop tree + inbox tree; `registerView` deleted)
- Modify: `src/extension.ts` (drop `CorgiTreeProvider`; `corgi.reload` / `corgi.installWithHomebrew` call `corgi.sidebar.reload`; add `corgi.commands` quick pick)
- Modify: `package.json` (views, viewsWelcome, menus, commands, version)
- Delete: `src/corgiTreeProvider.ts`, `src/agentTree.ts`, `src/watchInboxTree.ts`
- Modify: `scripts/showcase.mjs` - remove imports of deleted modules if any (`grep agentTree scripts/showcase.mjs`).

**Interfaces:**
- Consumes: `build`, `SessionNode`, `InboxNode`, `SidebarState` (Task 1); `page` (Task 2); `AgentBoardWatcher`, `hiddenWorkspaces` from `./agentStatus`; `readInbox`, `InboxItem`, `itemName` from `./watchInbox`; `readBots` from `./agentBoard`; `runCorgi`, `corgiBinary`, `isolateArgs` from `./corgiExec`.
- Produces: `export class CorgiSidebar implements vscode.WebviewViewProvider, vscode.Disposable { constructor(watcher: AgentBoardWatcher, agentDir: string); start(): vscode.Disposable; refresh(): Promise<void>; static readonly viewId = 'corgiSidebar' }`. Commands registered inside `start()`: every `corgi.agent.inbox*` command (bodies moved from `WatchInboxTree.start` unchanged, plus `inboxRefresh` kept for `corgi.agent.refresh`), `corgi.sidebar.reload`, `corgi.sidebar.menu` (internal: quick pick for a row's ⋯).

- [ ] **Step 1: Write `src/sidebar.ts`**

```ts
export class CorgiSidebar implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = 'corgiSidebar';
    private view: vscode.WebviewView | undefined;
    private items: InboxItem[] = [];
    private timer: NodeJS.Timeout | undefined;
    private debounce: NodeJS.Timeout | undefined;
    private lastJson = '';
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly watcher: AgentBoardWatcher, private readonly agentDir: string) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [] };
        view.webview.html = page(crypto.randomBytes(16).toString('base64'));
        view.onDidChangeVisibility(() => { if (view.visible) { this.lastJson = ''; this.push(); } });
        view.onDidDispose(() => { this.view = undefined; });
        view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    }

    private onMessage(m: { type: string; command?: string; node?: unknown; url?: string }): void {
        if (m.type === 'ready') { this.lastJson = ''; this.push(); return; }
        if (m.type === 'open' && typeof m.url === 'string' && /^https?:\/\//.test(m.url)) { void vscode.env.openExternal(vscode.Uri.parse(m.url)); return; }
        if (m.type === 'run' && typeof m.command === 'string' && ALLOWED.has(m.command)) { void vscode.commands.executeCommand(m.command, m.node); return; }
        if (m.type === 'menu') { void vscode.commands.executeCommand('corgi.sidebar.menu', m.node); }
    }

    /** Rebuild the state and post it when it changed and the view is showing. */
    private push(): void {
        if (this.debounce) { clearTimeout(this.debounce); }
        this.debounce = setTimeout(() => {
            if (!this.view?.visible) { return; }
            const state = build(this.watcher.current(), this.items, hiddenWorkspaces(), readBots(this.agentDir), new Date());
            const json = JSON.stringify(state);
            if (json === this.lastJson) { return; }
            this.lastJson = json;
            void this.view.webview.postMessage({ type: 'state', state });
        }, DEBOUNCE_MS);
    }
    // start(): registers the view + commands; subscribes watcher.onDidChangeBoard(() => this.push()) and onDidChangeConfiguration('corgi.agent.hiddenWorkspaces'); setInterval(refresh, POLL_MS); refresh() reads the inbox then push().
}
const ALLOWED = new Set(['corgi.agent.focusNode','corgi.agent.chat','corgi.agent.answer','corgi.agent.deny','corgi.agent.fresh','corgi.agent.openPr','corgi.agent.new','corgi.agent.newIsolated','corgi.agent.inboxWorkOn','corgi.agent.inboxIgnore','corgi.agent.inboxUnblock','corgi.sidebar.reload']);
```

`corgi.sidebar.menu(node)`: for a session node, `showQuickPick` of `[Send…, Note…, Always allow, Interrupt, Fresh, Open PR, Copy id, Dismiss, Hide workspace]` filtered by what applies (pending → Always allow; drifting → Fresh; pr → Open PR), each mapping to the existing command id run with the same node (Hide workspace runs `corgi.agent.hideWorkspace` with `{ kind: 'group', label: session.label }`). For an inbox node: `[Work on it, Work on it in a worktree, Open, Unblock, Assign to me, Move…, PR ready, PR merge, PR close, Ignore]` filtered by `Issue`/`Blocked`/`Pr`/url the same way the old `when` clauses did.

`corgi.sidebar.reload`: `await runCorgi(['agent','refresh'])`, `watcher.refresh()`, then `refresh()` now and again after 1500 ms.

- [ ] **Step 2: Wire `registerAgentBoard`**

Replace the `WatchInboxTree` + `AgentSessionsTree` block with:

```ts
const sidebar = new CorgiSidebar(watcher, agentDir);
context.subscriptions.push(sidebar, sidebar.start(), vscode.window.registerWebviewViewProvider(CorgiSidebar.viewId, sidebar));
```

`sessionOf` stays (`(node: SessionNode | undefined) => node?.kind === 'session' ? node.session : undefined`), `AgentNode` type import → `SessionNode` from `./sidebarModel`; `hideWorkspace` accepts `{ kind: 'group'; label: string }`. `corgi.agent.refresh` keeps calling `corgi.agent.inboxRefresh` (still registered by the sidebar).

- [ ] **Step 3: `extension.ts` and `corgi.commands`**

Remove `CorgiTreeProvider`, `registerView`, `checkCorgiInstallation`'s tree refresh (keep the `setContext`). Add:

```ts
vscode.commands.registerCommand('corgi.commands', async () => {
    const sep = (label: string) => ({ label, kind: vscode.QuickPickItemKind.Separator });
    const items = [
        sep('Stack'), ...[['Run', 'corgi.runFromRoot', '$(debug-start)'], ['Run, omit beforeStart', 'corgi.runOmitBeforeStartFromRoot', '$(run-below)'], ['Stop', 'corgi.stop', '$(stop-circle)'], ['Init repos and databases', 'corgi.initFromRoot', '$(tools)'], ['Pull all repos', 'corgi.pullFromRoot', '$(cloud-download)'], ['Doctor: install required services', 'corgi.doctorFromRoot', '$(info)'], ['Create', 'corgi.createFromRoot', '$(file-code)'], ['Fork', 'corgi.forkFromRoot', '$(repo-forked)'], ['Clean', 'corgi.cleanFromRoot', '$(trash)']].map(row),
        sep('Databases'), ...[['All databases', 'corgi.dbFromRoot', '$(notebook)'], ['Up', 'corgi.dbUpFromRoot', '$(debug-start)'], ['Stop', 'corgi.dbStopFromRoot', '$(debug-stop)'], ['Down (stop and remove)', 'corgi.dbDownFromRoot', '$(clear-all)'], ['Seed', 'corgi.dbSeedFromRoot', '$(circuit-board)']].map(row),
        sep('Sessions'), ...[['New session', 'corgi.agent.new', '$(add)'], ['New isolated session', 'corgi.agent.newIsolated', '$(git-branch)'], ['Open a bot', 'corgi.agent.openBot', '$(hubot)'], ['Ask the chief', 'corgi.agent.ask', '$(comment-discussion)']].map(row),
        sep('Info'), ...[['Docs', 'corgi.docs', '$(book)'], ['Help', 'corgi.help', '$(question)']].map(row),
        sep('Examples'), ...exampleProjects.map((p) => ({ label: `$(cloud-download) ${p.title}`, command: 'corgi.runExample', args: [p] })),
        ...(custom.length ? [sep('Your projects'), ...custom.map((p) => ({ label: `$(folder) ${p.title}`, command: 'corgi.runExample', args: [p] }))] : []),
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'corgi' });
    if (pick && 'command' in pick) { await vscode.commands.executeCommand(pick.command, ...(pick.args ?? [])); }
});
```

where `row = ([label, command, icon]) => ({ label: `${icon} ${label}`, command, args: [] })` and `custom` is `getCustomExamples()` moved from `corgiTreeProvider.ts` into `src/examples/exampleProjects.ts` (exported).

- [ ] **Step 4: `package.json`**

- `views.corgi` → `[{ "type": "webview", "id": "corgiSidebar", "name": "Corgi" }]`
- `viewsWelcome[0].view` → `"corgiSidebar"`
- `menus["view/title"]` → four entries, all `"when": "view == corgiSidebar"`, `"group": "navigation@1..4"`: `corgi.runFromRoot`, `corgi.stop`, `corgi.sidebar.reload`, `corgi.commands`.
- `menus["view/item/context"]` → removed entirely.
- `commands`: add `{ "command": "corgi.commands", "title": "Corgi: all commands", "icon": "$(ellipsis)" }`, `{ "command": "corgi.sidebar.reload", "title": "Corgi: reload the sidebar", "icon": "$(refresh)" }`; drop `corgi.reload` if nothing else uses it (grep first; keep if bound).
- Any `commandPalette` `when` that names `corgiAgentSessions` / `corgiWatchInbox` / `corgiTreeView` → retarget or drop.
- version → `2.24.0`.

- [ ] **Step 5: Delete the trees, compile, lint, test**

`git rm src/corgiTreeProvider.ts src/agentTree.ts src/watchInboxTree.ts`; `grep -rn "agentTree\|watchInboxTree\|corgiTreeProvider\|registerView" src scripts` must be empty; `pnpm run compile && pnpm run lint && pnpm run compile-tests && node out/test/runTest.js` all green.

- [ ] **Step 6: Manual check in the extension host**

F5 → Corgi icon: usage bars, inbox rows, sessions rows; hover buttons; collapse a section, switch to Explorer, back → still collapsed; light theme; `⋯` opens the quick pick; Run/Stop from the title bar.

- [ ] **Step 7: Commit** - `"One webview sidebar replaces the three trees"`

---

### Task 4: README mockup and release

**Files:**
- Modify: `scripts/showcase.mjs` (the sidebar/sessions mockups draw the new layout: section headings, dots, bars, hover buttons)
- Modify: `README.md` (the sidebar paragraph lists usage, inbox, sessions, `⋯`)
- Modify: `CHANGELOG.md` if present

- [ ] **Step 1:** Update the mockup strings to mirror `sidebarHtml.ts` classes and copy; run `npm run showcase`; look at `docs/media/*.png`.
- [ ] **Step 2:** README text.
- [ ] **Step 3:** Commit - `"README: the new sidebar"`. Push to `main` releases (CI publishes on the version bump) - only when the user says push.
