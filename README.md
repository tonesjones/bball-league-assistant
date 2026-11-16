# bball-league-assistant

A nightly check for one Yahoo head-to-head, 9-category fantasy basketball league. Each night it reads Tony's Yahoo pages, builds a sheet of computed numbers, and gives advice on which waiver claims to place, or to hold. It never makes a move. Tony makes every move by hand in Yahoo.

League data comes from Yahoo pages read in Chrome, where Tony is already signed in, not from the Yahoo API. An agent saves the pages unchanged, plain Node code computes every number, and Claude decides by following a written playbook.

## Status

[`PLAN.md`](PLAN.md) has the decisions, the work list and what is next. [`docs/league-playbook.md`](docs/league-playbook.md) is the prompt Claude follows. Rules for coding agents are in [`AGENTS.md`](AGENTS.md). The earlier recommendation engine was retired on 2026-11-14. [`docs/designs/league-move-checker.md`](docs/designs/league-move-checker.md) and [`tasks/archive/`](tasks/archive/) keep the record of that trial.

## Set up

Node 20 or later is required.

```
cp .env.example .env        # add your league and team IDs
npm test
```

Chrome must be open and signed in to Yahoo, with the Claude in Chrome extension connected.

## Run a league check

In Claude Code, say "update league". The `update-league` skill (`.claude/skills/update-league/SKILL.md`) does the following:

1. Checks that Chrome is signed in to Yahoo. If not, it stops and tells you.
2. Starts the `yahoo-reader` agent, which saves the Yahoo pages unchanged to `local/raw/YYYY-MM-DD-HHmm/`. See [`docs/update-league.md`](docs/update-league.md).
3. Builds the facts sheet:

   ```
   npm run sheet -- local/raw/YYYY-MM-DD-HHmm
   ```

   The command writes `local/sheets/YYYY-MM-DD-HHmm.md`: adds and FAAB left, the matchup by category, open lineup days, last-5 lines and candidates, with no recommendation. It refreshes ESPN box scores itself. Add `--no-fetch` to reuse the cached ones.
4. Follows the playbook and writes the advice file `local/playbook-tests/YYYY-MM-DD.md`. The file opens with three lines: `HEADLINE`, `Move` and `Why`. Claude sends it to you.
5. Fills the previous journal line's `did` field in `local/journal.md` from the transactions page, and asks you only for the `why`.

Run it after the night's games are final and before the claim deadline, usually midnight Pacific.

## Data commands

| Command | What it does |
|---|---|
| `npm run sheet -- local/raw/<stamp> [--no-fetch]` | Builds the facts sheet for a capture. |
| `npm run import:draftlab` | Imports last season's priors into `data/priors/` from a [Draft Lab](https://github.com/tonesjones/fantasy-basketball-mock-draft) checkout next to this repo. Never hand-edit that folder. |
| `npm run fetch:schedule` | Writes the 2026-27 NBA schedule to `data/schedule-2026-27.json`. |

## Where outputs go

Everything the tool reads from Yahoo or writes about your team goes in `local/`, which Git ignores: `raw/`, `sheets/`, `playbook-tests/`, `journal.md` and `regression/`. Preferences that change advice, such as the protected players in `local/protected.json`, live there too. Another checkout needs its own copies.

## Directories

- `scripts/`: command-line entry points and the Yahoo URL guard hook.
- `src/`: library code. `src/engine/` is pure logic with no I/O. `src/sources/` fetches ESPN data and holds the Yahoo URL allowlist.
- `tests/`: `node:test` suites with small synthetic fixtures in `tests/fixtures/`.
- `data/`: generated inputs: `data/priors/`, `data/ids.json` and `data/schedule-2026-27.json`.
- `docs/`: the playbook, the capture reference, data sources, limits, designs and the [regression set](docs/playbook-regression.md).
- `tasks/`: the first two task specs. [`tasks/archive/`](tasks/archive/) holds retired ones.

## Global invariants

- The tool reads Yahoo and never changes anything there. `.claude/settings.json` denies the browser click, type, form and script tools. On `navigate` calls, `scripts/guard-yahoo-url.mjs` blocks any Yahoo URL that `src/sources/yahoo-urls.mjs` refuses.
- An agent only saves Yahoo page text. Code computes every number on the facts sheet.
- `src/engine/` does no I/O and uses no randomness, so the same inputs give the same output.
- A change to a number on the sheet bumps `SHEET_VERSION`. A change to the playbook's rules bumps its version line.
- Anything about your league goes in `local/`, which Git ignores. Tests use synthetic fixtures only.

## Global side effects

- Network: ESPN's public API (`https://site.api.espn.com`), with caching in `local/cache/espn/`, at least 500 ms between requests, and backoff on 429, 500, 502, 503 and 504.
- Files: generated data in `data/`, and everything else in `local/`.

## System verification

Run `npm test`.
