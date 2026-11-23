# AGENTS.md

<!-- cspell:ignore fanart worktrees -->

Guidance for coding agents working in medleyplay.

This file carries what an agent needs before it can act: what the project is and
how to build and test it. Everything else — conventions, engineering principles,
and the writing rules — lives in
[`.github/copilot-instructions.md`](.github/copilot-instructions.md), which is the
canonical instruction file. Read it next; this file deliberately does not repeat
it, so the two cannot drift apart.

## What this is

medleyplay plays music on your local network, from your own files and from Bilibili.
A Python 3.14 server (FastAPI is planned) keeps its library in SQLite and serves a
React, Vite, and TypeScript web client from `web/`. Design notes live in
`docs/contributing/design-notes/`.

## Build and test

Python is managed by [uv](https://docs.astral.sh/uv/); the web client needs Node 24
and npm.

```bash
# Python: full CI reproduction, not the local development loop
uv sync --locked
uv run ruff format --check
uv run ruff check
uv run bandit -q -c pyproject.toml -r src
uv run mypy
uv run pytest --cov --cov-report=term-missing
uv run pip-audit -r <(uv export --locked --format requirements-txt --no-emit-project --quiet) --disable-pip --progress-spinner off   # needs network

# Web client
cd web && npm ci && npm run check && npm run build
npx playwright install chromium   # once, for e2e
cd web && npm run e2e             # builds the client and drives the real server; needs uv sync
```

> [!IMPORTANT]
> Four details above are load-bearing, not decoration. `uv sync --locked` fails
> when `uv.lock` disagrees with `pyproject.toml`, so a dependency change always
> ships with its lock file. `ruff format --check` is a gate of its own: `ruff check`
> does not report formatting, so a clean lint is not a clean CI. And `mypy` runs in
> strict mode over `src` and `tests`; a test that is not annotated fails it. Coverage
> floors are 90% line and 85% branch, enforced in CI from the JSON report
> ([`CONTRIBUTING.md`](CONTRIBUTING.md#coverage) explains them). Finally, `pip-audit`
> reads the locked dependency set, not the active environment, and a known
> vulnerability in it fails CI ([`CONTRIBUTING.md`](CONTRIBUTING.md#security-checks)).

## Working rules

These hold for every change, whoever makes it.

### Decisions

- Read the design note for the component in `docs/contributing/design-notes/`
  before changing it, and update it when a decision changes.
- Take a large decision to the owner first, with a recommendation: an architecture
  change, a new dependency, or a visible layout with several reasonable shapes
  (show a sketch or a screenshot). Decide the rest yourself and say what you
  decided, and why, in the pull request.
- Never add or change a dependency (`pyproject.toml`, `uv.lock`, `web/package.json`,
  `web/package-lock.json`) without the owner's approval.

### Branches and pull requests

- Never commit to `main`. Each change gets its own branch and a pull request whose
  title is a Conventional Commit. The body says what changed, the decisions made,
  and the checks run.
- Bring `main` in by merging `origin/main` into the branch. Never rebase a pushed
  branch, never force-push, and never use `git stash` (parallel work shares it).
- Every change people can see gets a line in `CHANGELOG.md` under *Unreleased*, in
  plain words. On a merge conflict there, keep both sides.
- Parallel work uses git worktrees beside the main checkout, such as
  `../medleyplay-<task>`. A worktree's `web/node_modules` is a link to the main
  checkout's: `ln -s ../../stream/web/node_modules web/node_modules`. Never run
  `npm ci` or `npm install` in such a worktree: it empties the shared copy. Run
  `uv sync` in it before the end-to-end tests, which start the server.
- Write the test first, watch it fail, then make it pass. When a change is not
  obviously covered, break the behavior once and watch a test fail.

### Gates

Follow [Local checks and PR verification](CONTRIBUTING.md#local-checks-and-pr-verification):
exercise the change and its direct callers locally, then let GitHub Actions run
the full gates. Record local evidence separately from CI. Before merging,
verify required checks on the current PR revision; an unpushed commit has not
passed CI. This does not change preview, release, or approval requirements.

A test name has no contractions (the spelling check reads it). A test that fails
once under load and passes on its own is a flake: run it again, and note it for a
fix rather than changing what it checks.

### Outside sites and the owner's data

- **Bilibili:** only the tools' normal download paths. Never probe or work around
  its bot checks, never send hand-made requests to its API, and never drive the
  site with a headless browser. A refusal is final.
- **Rate Your Music:** never scrape it. **NetEase Cloud Music:** plain endpoints
  only, with no request encryption and no headers that pretend to be a browser.
  **fanart.tv** refused (403): don't work around it.
- **Tests never contact the network.** Sites are faked at the transport
  (`tests/support/transport.py`) or by a test plugin.
- Never put the owner's name, email, or project in a request to an outside service.
- Secrets, such as AI keys and tokens, never go in the database, logs, a Job's
  request, or an error. They are kept in the Keychain.
- **The owner's own data is in `~/Music/medleyplay`**, the default data folder.
  Never run tests, measurements, or a second server on it. Use a copy, with the
  Mode set Offline and a `jobs` folder of its own.

### Previewing a change

- A preview only looks. Point it at the running server on port 8000, and have the
  script block every request to `/api` that is not a `GET`, except
  `POST /api/session` to sign in, and every request to an outside site.
- In a preview, never press a control that changes data or asks a site, such as
  *Ask AI*, *Use*, *Save*, *Approve*, *Retry*, or *Link*. Never play audio, and
  never press *Show in Finder*.
- Preview a production build: `npx vite build --outDir <tmp>`, then
  `npx vite preview --outDir <tmp> --port <port>`, which sends `/api` to port 8000.
  Under the dev server, a dialog opened from a song's menu doesn't open in
  Playwright. Sign in through it with the header `Origin: http://127.0.0.1:8000`.
- Check light and dark, at 1280 and 390 pixels wide, before opening the pull request.

### Known pitfalls

- Pico styles any `role="group"` as a group of buttons (margins, stretched
  children): don't give that role to a layout container.
- Stylelint's `no-descending-specificity`: a more specific rule goes after the
  base rule it overrides, which often means at the end of `web/src/index.css`.
- Ruff's `RUF001` flags full-width and look-alike characters: write them as
  `\u` escapes in patterns.
- Vitest gives each test 20 seconds and Testing Library's `find` queries wait 5,
  for whole-page tests on a busy machine.

## Read next

| Document | What it covers |
| --- | --- |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | Conventions, engineering principles, and the path-specific rules below. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Full setup, coverage, the web client, and the pull-request checklist. |
| `docs/contributing/design-notes/` | The design notes: one per component, recording goal, decisions, and tradeoffs. |
| [`README.md`](README.md) | Project overview and status. |

Path-specific rules apply automatically in GitHub Copilot; other agents should
read whichever matches the files they touch:

- [`.github/instructions/python.instructions.md`](.github/instructions/python.instructions.md) — Python server and tests.
- [`.github/instructions/web.instructions.md`](.github/instructions/web.instructions.md) — the `web/` client.
- [`.github/instructions/docs.instructions.md`](.github/instructions/docs.instructions.md) — the `docs/` tree, including how to add a design note.
