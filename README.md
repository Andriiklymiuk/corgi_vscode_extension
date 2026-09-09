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

## Claude Code sessions

With [corgi agent mode](https://github.com/Andriiklymiuk/corgi/blob/main/docs/agent.md)
the corgi daemon keeps a board of every Claude Code session on the machine.
This extension shows it inside each VS Code window and lets you act on it.

<p align="center"><img src="docs/media/window.png" width="800" alt="VS Code with the Agent sessions view, a session asking for permission in the terminal, the status bar item and a toast with a Go button"></p>

**Agent sessions** view in the Corgi side bar: workspaces, their sessions,
what each is doing, its context fill, how long since it changed. Click to
focus that terminal tab or Claude Code panel. A session waiting on a
permission gets **Allow** and **Deny** inline. Right-click to set a note or
dismiss.

<p align="center"><img src="docs/media/story.gif" width="800" alt="A session asks, the row turns to needs you with Allow and Deny, Allow is clicked, the session works on and finishes"></p>

**Status bar**: `⌁ 3 · 🔔 1 · 5h 62%` — sessions working, sessions that
need you (the text tints when there are any), the tightest 5-hour usage
limit across accounts. Hover for every session. Click to pick one.

<p align="center"><img src="docs/media/statusbar.png" width="600" alt="The status bar item: 3 working, 1 needs you, 5h 62 percent"></p>

**A toast with Go** when a session in *another* window starts waiting, shown
only by the window in front (`corgi.agentToasts`).

<p align="center"><img src="docs/media/toast.png" width="435" alt="Toast: acme-api needs you: Bash go test, with a Go button"></p>

**Commands** (Shift+Cmd+P): **Corgi Agent: Sessions** picks one to focus,
grouped by workspace; **New Claude Code session in this window**; **Go to the
session that needs you**; **Send text to the front session**; **Talk to the
front session** (presses Ctrl+Y in its terminal).

<p align="center"><img src="docs/media/quickpick.png" width="700" alt="The sessions quick pick, grouped by workspace, each with status, what it does, context and account"></p>

Under the hood the extension puts `CORGI_VSCODE_WINDOW` into every
integrated terminal so a `claude` started there knows its window, tells the
daemon which terminal tabs and Claude Code panels this window has, and
reveals the exact tab when `corgi agent focus`, a Stream Deck key or
corgi-bar asks. `corgi agent new` opens a fresh `claude` terminal here
(`corgi.claudeCommand`); `corgi agent send` types text into a session's
terminal as keystrokes, never as a shell command.

It also offers, once, to set `terminal.integrated.tabs.title` to
`${sequence}`, so a tab reads `▲ acme-api NEEDS YOU` instead of "claude".
Nothing happens until `corgi agent` has been used on the machine;
`corgi.sessionTracking: false` turns it off. If the Claude Code panel does
not come forward, set `corgi.claudePanelCommand` to the command that
focuses it.

The same board lives in the menu bar with
[corgi-bar](https://github.com/Andriiklymiuk/corgi-bar) and on Stream Deck
keys with [Corgi Agent Deck](https://github.com/Andriiklymiuk/corgi-agent-deck).
