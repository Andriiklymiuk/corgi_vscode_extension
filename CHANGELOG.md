### Changelog

All extension changes are here
[vscode extension changelog](https://github.com/Andriiklymiuk/corgi_vscode_extension/releases)

All corgi cli changes are here
[corgi cli changelog](https://github.com/Andriiklymiuk/corgi/releases)

## 1.17.3

- Typed text is submitted: Enter goes as a raw key after the paste, not inside it.

## 1.17.2

- Agent sessions view in the Corgi side bar: grouped by workspace, click to focus, Allow/Deny inline on a pending permission, note and dismiss in the context menu.

## 1.17.1

- Session quick pick grouped by workspace, a separator per workspace.

## 1.17.0

- Board in the window: a status bar item with working / needs-you counts and the tightest 5h usage limit (`corgi.agentStatusBar`), a session quick pick (`corgi.agent.sessions`), `corgi.agent.new`, `corgi.agent.next`, `corgi.agent.send`, `corgi.agent.talk`, and a Go toast when a session in another window starts waiting (`corgi.agentToasts`).
- Reveal requests can carry `text` + `enter` (`corgi agent send` types into the session's terminal tab as keystrokes) and `title` (which Claude Code chat tab to bring up).

## 1.16.7

- Session tracking companion for `corgi agent track`: injects `CORGI_VSCODE_WINDOW` into integrated terminals, reports this window's terminals to the corgi daemon, and reveals the terminal tab or Claude Code panel a session runs in when `corgi agent focus` (or a Stream Deck key) asks. Settings: `corgi.sessionTracking`, `corgi.claudePanelCommand`. The window id is stable across restarts so restored terminals still bind, and the extension offers once to set `terminal.integrated.tabs.title` to `${sequence}` so tabs show the session status. `corgi agent new` opens a fresh terminal running `claude` in the window (`corgi.claudeCommand`).
