# Corgi sidebar as one webview

Date: 2026-09-16. Status: approved in chat, spec written for the plan.

## Why

The Corgi activity-bar container holds three tree views: Woof (30 command
rows in five collapsible groups), Inbox, and Agent sessions. A tree row is an
icon, a label and one grey string. That cannot show a usage bar, a status
dot, or a button on hover, and the command wall hides the two things a person
presses every day: Run and Stop. The Claude Code extension shows what the
same space can do with a webview. This design replaces the three trees with
one webview view and folds the command wall into the view's toolbar plus one
quick pick.

## Scope

In: the sidebar view, its toolbar, the quick pick of corgi commands, the
README mockup for the sidebar.

Out: the YAML schema, completion, validation, the chat panel
(`agentChat.ts`), the status bar items, the phone, corgi-bar, the Stream
Deck, the daemon. Every `corgi.*` and `corgi.agent.*` command keeps its id
and behaviour; the webview only calls them.

## Layout

```
┌ Corgi ────────────────────────  ▶  ■  ↻  ⋯ ┐   view/title menu (native)
│ ▾ USAGE                                     │
│   default  5h  ▓▓░░░░░░ 12%   resets in 3h  │   one block per board account
│            7d  ▓▓▓░░░░░ 35%   resets in 5d  │
│ ▾ INBOX                                  2  │   count badge
│   ● IMP-13427   review requested      2h    │   hover: Work on it · Open · Ignore · ⋯
│   ● api #77     checks ✗ · needs you  1d    │
│ ▾ SESSIONS                        active·1  │
│   ● Corgi vulnerabilities research    now   │   hover: Chat · Allow · Deny · ⋯
│   ⚠ MCP features on core   drifting   19h   │
│   + New session      + Isolated             │
└─────────────────────────────────────────────┘
```

Section headings are VS Code style: uppercase 11 px, `descriptionForeground`,
a chevron, a count on the right. Each section collapses; the collapsed set is
kept in the webview's `vscode.getState()` so it survives hide and show.

### Toolbar (native `view/title` menu, not HTML)

`corgi.runFromRoot` (▶), `corgi.stop` (■), `corgi.sidebar.reload` (↻),
`corgi.commands` (⋯). The reload runs `corgi agent refresh`, re-reads the
inbox and the board, and re-sends state. Using the native menu keeps the
buttons in the title row where VS Code puts them and costs no HTML.

### The ⋯ quick pick (`corgi.commands`)

One `showQuickPick` with separators. Items map 1:1 onto the command ids that
exist today, so `registerCorgiCommands` is untouched:

- Stack: Run, Run (omit beforeStart), Stop, Init, Pull, Doctor, Create, Fork, Clean
- Databases: All, Up, Stop, Down, Seed
- Info: Docs, Help
- Examples: every `exampleProjects` entry and every `Your Projects` entry
  (from `corgi-*.json` in the workspace root), each running `corgi.runExample`
  with the example as its argument; the modal "Download and run" confirmation
  stays.
- Sessions: New session, New isolated session, Open a bot, Ask corgi

"From workspace root" is the only variant listed. `executeCorgiCommand`
already asks which compose file when the workspace has more than one, so
the "from chosen location" twins add nothing and are dropped from the pick
(their command ids stay registered for the palette and keybindings).

### Usage

One block per `board.accounts[]` entry. A row per window: `5h` from
`limits.fiveHour`, `7d` from `limits.sevenDay`. Bar width = `percent`. Colour:
`progressBar.background` below 70, `notificationsWarningIcon.foreground` from
70, `notificationsErrorIcon.foreground` from 90. Right label: "resets in Nh"
from `resetsAt`, computed at render time. A forecast that is not `safe` adds
"runs out HH:MM" after the label. No accounts → the section is not drawn.

### Inbox

Rows from `readInbox()`, grouped by workspace when there is more than one
workspace (a small grey workspace label above each group, no nesting).
Row: dot, `itemName(item)`, `itemDetail(item, now)` in grey, `elapsed` on the
right. Dot colour: `notificationsErrorIcon.foreground` when `blocked`,
`notificationsWarningIcon.foreground` when `session` is set, else
`descriptionForeground`. Click opens `openableUrl` when there is one, the
same as today's `corgi.agent.inboxOpen`.

Hover buttons, left to right, by the same markers the tree used for
`contextValue`: Work on it (`Issue`), Open (has url), Ignore, ⋯ . The ⋯
opens a quick pick with the rest: Work on it in a worktree, Unblock
(`Blocked`), Assign to me, Move, PR ready / merge / close (`Pr`). Each runs
the existing `corgi.agent.inbox*` command with an `{ kind: 'item', item }`
node, so `WatchInboxTree`'s command bodies move as they are into the new
provider.

Empty state: the same two sentences the tree's welcome shows today, plus a
"Check again" link that runs the reload.

### Sessions

Rows from `liveSessions(board)` after `hideWorkspaces`, grouped by workspace
when more than one, ordered by `statusRank` inside a group. Row: dot, title
(`botTitle` / `title` / `sessionName`, as `agentTree.ts` chooses now), one
grey clause, elapsed on the right.

The clause is the first line `agentTree.ts` builds today (drift reason,
overlap, `asks <tool>`, note, limit, detail, branch), then `changesLine`,
`testsLine`, `spendLine`, `ctx N%` — joined with ` · `, and clipped with
CSS ellipsis. The tooltip carries the long form (`title` attribute) with the
same content the tree tooltip has.

Dot: `notificationsWarningIcon.foreground` for `needs_input`,
`notificationsErrorIcon.foreground` for drifting or `overCap`,
`charts.green` for `working` (a soft pulse animation, respecting
`prefers-reduced-motion`), `descriptionForeground` for done, stale, unknown;
a ⚠ glyph replaces the dot when crossing (`isCrossing`).

Click = `corgi.agent.focusNode`. Hover buttons: Chat, Allow + Deny (only
when `pending`), Fresh (only when drifting), Open PR (only when `pr`), ⋯ with
Note, Send, Always, Interrupt, Dismiss, Copy id, Hide workspace. Each runs
the existing `corgi.agent.*` command with a `{ kind: 'session', session }`
node.

Footer links: "+ New session" (`corgi.agent.new`) and "+ Isolated"
(`corgi.agent.newIsolated`).

Empty state: "No sessions. Start one with + New session." plus the two links.

### Not installed

`viewsWelcome` for the new view id keeps today's install text and the
Homebrew button; `corgiNotInstalled` context stays.

## Architecture

```
sessions.json ──▶ AgentBoardWatcher.onDidChangeBoard ─┐
                                                        │      hash same → skip
inbox: corgi agent watch inbox (60 s, as today) ────────┼─▶ sidebarModel.build() ─▶ JSON ─▶ postMessage
config: corgi.agent.hiddenWorkspaces ───────────────────┘      (only while visible; resent on show)
                                                                          │
webview: sidebarHtml.page() ◀──────────────────────────────────────────────┘
   │ click / button
   └─▶ postMessage {command, node} ─▶ vscode.commands.executeCommand(command, node)
```

### Files

New:

- `src/sidebarModel.ts` — pure. `build(board, inbox, hidden, now): SidebarState`
  and the row builders. No vscode import. Reuses `agentBoard.ts` and
  `watchInbox.ts` helpers. Everything the page shows is decided here, so the
  page script only draws.
- `src/sidebarHtml.ts` — pure. `page(nonce: string): string`. One HTML
  string with inline CSS and one inline script under a nonce CSP
  (`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-…'`).
  No external files, no framework. The script holds the last state, draws
  it with `replaceChildren`, and keeps the collapsed set in `getState()`.
- `src/sidebar.ts` — `CorgiSidebar implements vscode.WebviewViewProvider`.
  Owns the inbox poll (moved from `WatchInboxTree`), the inbox commands
  (moved from `WatchInboxTree.start`), `corgi.commands`, and
  `corgi.sidebar.reload`. Subscribes to `AgentBoardWatcher.onDidChangeBoard`
  and configuration changes. Debounces 150 ms, hashes the state JSON,
  posts only on change and only while `view.visible`; on
  `onDidChangeVisibility` → visible, posts the current state.
  `retainContextWhenHidden` stays false.
- `src/test/sidebarModel.test.ts`, `src/test/sidebarHtml.test.ts`.

Changed:

- `package.json` — `views.corgi` becomes one entry `{ id: 'corgiSidebar', type: 'webview', name: 'Corgi' }`;
  `viewsWelcome` retargets to it; `view/title` lists the four toolbar
  commands; every `view/item/context` entry goes (the webview has its own
  hover buttons and quick picks); new commands `corgi.commands`,
  `corgi.sidebar.reload`; version bump.
- `src/extension.ts` — registers the provider, drops `CorgiTreeProvider`;
  `corgi.reload` and `corgi.installWithHomebrew` refresh the sidebar
  instead of the tree.
- `src/agentStatus.ts` — `registerAgentBoard` builds the sidebar instead of
  `WatchInboxTree` + `AgentSessionsTree`; `registerView` goes when no tree
  is left. Session command bodies keep their `AgentNode` argument shape.
- `scripts/showcase.mjs` — the sessions/window mockups draw the new sidebar.
- `README.md` — sidebar picture and the list of what it shows.

Deleted: `src/corgiTreeProvider.ts`, `src/agentTree.ts` (its
`groupSessions` moves to `sidebarModel.ts`), `src/watchInboxTree.ts`.

### Messages

Extension → webview:

- `{ type: 'state', state: SidebarState }` — the whole state, every time.

Webview → extension:

- `{ type: 'run', command: string, node?: SessionNode | InboxNode }`
- `{ type: 'open', url: string }` — for inbox rows with a url
- `{ type: 'ready' }` — first paint, asks for state

`SidebarState`:

```ts
interface SidebarState {
  accounts: { profile: string; windows: { name: '5h' | '7d'; percent: number; resets: string; warn: string }[] }[];
  inbox: { workspace: string; rows: InboxRow[] }[];
  sessions: { workspace: string; rows: SessionRow[] }[];
  counts: { inbox: number; active: number };
}
interface SessionRow { id: string; title: string; clause: string; tooltip: string; elapsed: string; tone: 'ask' | 'bad' | 'live' | 'quiet'; crossing: boolean; can: ('chat' | 'allow' | 'fresh' | 'pr')[]; node: SessionNode }
interface InboxRow { key: string; name: string; detail: string; tooltip: string; elapsed: string; tone: 'bad' | 'ask' | 'quiet'; url?: string; can: ('work' | 'open' | 'ignore' | 'unblock' | 'pr')[]; node: InboxNode }
```

The webview never reads the board or the inbox itself; `node` is opaque to
it and goes back verbatim in `run`.

### Efficiency rules

- No new polling. The board watcher and the 60 s inbox poll already exist.
- One `postMessage` per changed state; a JSON hash gate in `sidebar.ts`.
- Nothing is posted while the view is hidden; the last state is posted on show.
- Full redraw in the page (rows < 100); `replaceChildren` on each section.
- No framework, no external script, no font. Page string is built once.
- `retainContextWhenHidden: false`; the page rebuilds from state on show.

### Security

- CSP with a per-page nonce; `enableScripts: true`; `localResourceRoots: []`.
- Every string from the board or inbox goes through `textContent` in the
  page, never `innerHTML`.
- `open` only accepts http(s) urls; the extension checks before
  `openExternal`.
- `run` only accepts command ids from an allowlist in `sidebar.ts`
  (`corgi.agent.*` session and inbox commands, `corgi.agent.new*`,
  `corgi.commands`, `corgi.sidebar.reload`).

## Testing

- `sidebarModel.test.ts`: accounts with and without limits and forecast;
  grouping by workspace with one and many workspaces; the session clause
  matches the tree's order; the `can` list for pending, drifting, pr rows;
  hidden workspaces removed; counts.
- `sidebarHtml.test.ts`: nonce in the CSP and on the script; no `innerHTML`
  in the page script; the page has the three section ids.
- Manual: F5, sidebar draws both empty and full states; hover buttons
  run; collapse survives hide/show; light theme readable; the not-installed
  welcome shows when `corgi` is off PATH.
- `pnpm test` green, `pnpm run lint` clean.
