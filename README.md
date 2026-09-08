<div align="center">

# 🐶 Corgi vscode extension 🐶

[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=Andriiklymiuk_corgi_vscode_extension&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=Andriiklymiuk_corgi_vscode_extension)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=Andriiklymiuk_corgi_vscode_extension&metric=bugs)](https://sonarcloud.io/summary/new_code?id=Andriiklymiuk_corgi_vscode_extension)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=Andriiklymiuk_corgi_vscode_extension&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=Andriiklymiuk_corgi_vscode_extension)

[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=Andriiklymiuk_corgi_vscode_extension&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=Andriiklymiuk_corgi_vscode_extension)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=Andriiklymiuk_corgi_vscode_extension&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=Andriiklymiuk_corgi_vscode_extension)

[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=Andriiklymiuk_corgi_vscode_extension&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=Andriiklymiuk_corgi_vscode_extension)
[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=Andriiklymiuk_corgi_vscode_extension&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=Andriiklymiuk_corgi_vscode_extension)
[![Technical Debt](https://sonarcloud.io/api/project_badges/measure?project=Andriiklymiuk_corgi_vscode_extension&metric=sqale_index)](https://sonarcloud.io/summary/new_code?id=Andriiklymiuk_corgi_vscode_extension)

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=Andriiklymiuk_corgi_vscode_extension&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=Andriiklymiuk_corgi_vscode_extension)

Extension link in
[vscode marketplace](https://marketplace.visualstudio.com/items?itemName=Corgi.corgi)

Public docs in [corgi docs](https://andriiklymiuk.github.io/corgi/)

</div>

[Corgi](https://github.com/Andriiklymiuk/corgi) is how you run your project
locally — every day, with one command. You describe your stack once in a
`corgi-compose.yml` and `corgi run` brings the whole thing up: repos cloned,
databases seeded, `.env` files wired, every service started (it even starts
Docker for you). Run the whole thing locally, just the databases (`corgi db -u`),
or only the frontend against staging (`corgi run --tier staging --services web`).

This extension makes that nicer right inside the editor. It:

- highlights syntax and autocompletes `corgi-compose.yml` files
- adds commands in the activity bar, status bar, and editor to run corgi and its
  helpers (run, doctor, status, db, tunnel, …)
- lets you browse and run the showcase examples
- ships an **AI assistant** (see below)

## 🤖 AI assistant

**`@corgi` in Copilot Chat** — knows the corgi-compose.yml schema and the CLI:

- `@corgi /new a go api with a postgres db` — scaffold a corgi-compose.yml
- `@corgi /explain` — explain the current compose file (what starts, env wiring)
- `@corgi /debug` — runs `corgi doctor` + `corgi status` and diagnoses issues
- `@corgi how do I add a redis cache?` — grounded Q&A

Each reply offers one-click **corgi doctor** / **corgi run** buttons.

**Copilot agent-mode tools** — in agent mode Copilot can call corgi directly:
`corgi-status`, `corgi-doctor`, `corgi-validate`, `corgi-list` (read-only) and
`corgi-run` (asks before starting your stack). So "get my stack running and fix
issues" just works. Reference them explicitly with `#corgiStatus`, `#corgiDoctor`,
etc.

The CLI must be installed (the assistant shells out to it).

# Requirements (only needed for running corgi directly in vscode)

You can install corgi in any of these ways:

- from vscode SHIFT+CMD+P and type `Corgi install with Homebrew`

- manually install [Corgi](https://github.com/Andriiklymiuk/corgi) with
  [Homebrew](https://brew.sh)

```bash
brew install andriiklymiuk/homebrew-tools/corgi
```

Try it with expo + hono server example
```bash
corgi run -t https://github.com/Andriiklymiuk/corgi_examples/blob/main/honoExpoTodo/hono-bun-expo.corgi-compose.yml
```

In order to update corgi run
```bash
corgi update
```

## Attribution

Credits:

- <a href="https://www.freepik.com/icon/pawprint_1076877#fromView=keyword&term=Dog&page=1&position=14">Icon
  by Freepik</a>
- <a href="https://www.freepik.com/free-vector/cute-corgi-dog-astronaut-floating-space-cartoon-vector-icon-illustration-animal-science-icon-concept-isolated-premium-vector-flat-cartoon-style_22271104.htm#query=corgi%20icon&position=7&from_view=keyword">Corgi
  image by catalyststuff</a>

## Session tracking for `corgi agent`

With [corgi agent mode](https://github.com/Andriiklymiuk/corgi/blob/main/docs/agent.md) the corgi daemon
keeps a board of every Claude Code session on the machine — for a Stream Deck, or `corgi agent sessions`.
This extension is the half that lives inside each VS Code window:

- it puts `CORGI_VSCODE_WINDOW` into every integrated terminal, so a `claude` started there knows which window it is in;
- it tells the daemon which terminal tabs (and which extension host, for the Claude Code panel) this window has;
- when `corgi agent focus <session>` or a Stream Deck key asks for it, it reveals that exact terminal tab or the Claude Code panel;
- when `corgi agent new` (the deck's "+" key) asks, it opens a fresh terminal running `claude` (`corgi.claudeCommand`) in this window;
- when `corgi agent send <session> --enter "text"` asks, it types the text into that session's terminal tab as keystrokes (never as a shell command), and when a window has several Claude Code chat tabs it brings up the one the daemon names.

It also reads the board itself:

- a status bar item — `$(pulse) 2 · $(bell) 1 · 5h 62%` — with sessions working, sessions that need you (highlighted), and the tightest 5-hour usage limit across accounts; hover for every session's status, detail and context fill; click to pick a session (`corgi.agentStatusBar`);
- a toast with a **Go** button when a session in *another* window starts waiting for you, shown only by the focused window (`corgi.agentToasts`);
- commands: **Corgi Agent: Sessions** (`corgi.agent.sessions`, pick and focus), **New Claude Code session in this window** (`corgi.agent.new`), **Go to the session that needs you** (`corgi.agent.next`), **Send text to the front session** (`corgi.agent.send`), **Talk to the front session** (`corgi.agent.talk`, presses Ctrl+Y in the session's terminal — the panel has no command for it, so it tells you the key).

The **Agent sessions** view in the Corgi side bar shows the same board as a tree: workspaces, their sessions, status, what each is doing and its context fill. Click focuses; a session waiting on a permission gets Allow and Deny inline; the context menu sets a note or dismisses.

It also offers, once, to set `terminal.integrated.tabs.title` to `${sequence}`, which is what lets a tab read `▲ repo NEEDS YOU` instead of "claude".
Nothing happens until `corgi agent` has been used on the machine, and `corgi.sessionTracking: false` turns it off.
If the Claude Code panel does not come forward, set `corgi.claudePanelCommand` to the command id that focuses it.
