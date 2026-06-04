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

This is helpful corgi extension, that:

- highlights syntax, autocompletion in corgi-compose.yml files
- adds commands in activity bar, status bar or editing view to run corgi or its
  helpers
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
