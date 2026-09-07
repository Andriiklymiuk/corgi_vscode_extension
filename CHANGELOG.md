### Changelog

All extension changes are here
[vscode extension changelog](https://github.com/Andriiklymiuk/corgi_vscode_extension/releases)

All corgi cli changes are here
[corgi cli changelog](https://github.com/Andriiklymiuk/corgi/releases)

## 1.16.7

- Session tracking companion for `corgi agent track`: injects `CORGI_VSCODE_WINDOW` into integrated terminals, reports this window's terminals to the corgi daemon, and reveals the terminal tab or Claude Code panel a session runs in when `corgi agent focus` (or a Stream Deck key) asks. Settings: `corgi.sessionTracking`, `corgi.claudePanelCommand`. The window id is stable across restarts so restored terminals still bind, and the extension offers once to set `terminal.integrated.tabs.title` to `${sequence}` so tabs show the session status.
