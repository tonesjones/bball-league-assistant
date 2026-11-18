# scripts

## Overview

Command-line entry points. They build the facts sheet from a Yahoo capture folder, fetch ESPN data, turn a capture folder into a snapshot, and import last season's priors. The Claude Code hook that guards Yahoo URLs lives here too. The logic they call lives in [`../src/engine/`](../src/engine/README.md) and [`../src/sources/`](../src/sources/README.md).

## Interface

| Script | npm command | What it does |
|---|---|---|
| `sheet.mjs` | `sheet -- local/raw/YYYY-MM-DD-HHmm [--no-fetch]` | Builds the facts sheet for one capture folder and writes `local/sheets/<folder>.md`. Prints the file path, any warnings, and one status line per section (`ok`, `partial` or `UNAVAILABLE`). Refreshes ESPN box scores first unless `--no-fetch` is given. |
| `capture-public.mjs` | `capture:public [-- --tz <zone>] [-- --sunday \| --no-sunday]` | Cloud capture. Reads the league's public pages signed out in headless Chromium and saves their text to `local/raw/<YYYY-MM-DD-HHmm>/`, with `_log.txt` starting `mode: public (signed out)`. Needs `YAHOO_LEAGUE_ID` and `YAHOO_TEAM_ID` in the environment or `.env`, and Playwright (preinstalled in cloud sessions). |
| `build-snapshot.mjs` | none | Parses a capture folder (default: the newest under `local/raw/`) into `local/snapshots/<folder>.json`. |
| `fetch-gamelogs.mjs` | `fetch:gamelogs` | Fetches ESPN box scores. Takes `--season 2026-27 \| 2025-26` (required), and optionally `--from`, `--to` and `--snapshot <path>`. |
| `import-draftlab.mjs` | `import:draftlab` | Imports last season's priors from a Draft Lab checkout. The npm command always reads `../fantasy-basketball-mock-draft`. To read another checkout, run `node scripts/import-draftlab.mjs --from <dir> [--out <dir>]` (default `--out` is `data/priors`). |
| `fetch-schedule.mjs` | `fetch:schedule` | Writes the NBA regular-season schedule to `data/schedule-2026-27.json`. |
| `build-ids.mjs` | `build:ids` | Builds the player ID map `data/ids.json` from ESPN rosters and the priors. |
| `match-ids.mjs` | `match:ids` | Matches a snapshot's players (default: the newest) against the ID map. |
| `guard-yahoo-url.mjs` | none | `PreToolUse` hook. Reads the tool call on stdin and blocks any Yahoo URL that `checkUrl` refuses. |

Run each with `npm run <command>`, putting `--` before any arguments.

## Invariants

- `sheet.mjs` takes exactly one capture folder, named `YYYY-MM-DD-HHmm`. It reads only `settings`, `team`, `team-tree`, `team-values` (FAAB only), `matchup`, `matchup-totals`, `matchup-next`, `transactions`, `fa-N` and `teams/N` (and `teams/N-tree`) text files. A page that `_log.txt` marks `skipped` or `sign-in` counts as missing, with that reason. A page that fails to parse prints `UNAVAILABLE: <file> (<reason>)` in its section and does not stop the others.
- `sheet.mjs` resolves `data/` and `local/` from the working directory, so run it from the checkout that holds them. It exits 1 with the message on a bad argument or folder name.
- `sheet.mjs` refreshes the last 7 days of game logs, or the whole season when `_coverage.json` is missing or starts after the season's first game (a fresh cloud checkout; about 90 seconds). When the logs still start after the first game, it adds a warning that last-5 lines and season MPG miss the earlier games.
- `sheet.mjs` does not fail when the ESPN refresh fails. It adds a warning and uses the cached game logs. A failed injuries feed prints `UNAVAILABLE` in section 9 only. With `--no-fetch`, section 9 uses `local/cache/espn/injuries.json` or prints `UNAVAILABLE` when it is missing.
- `build-snapshot.mjs` requires a folder named `YYYY-MM-DD-HHmm`, which supplies `asOf`. It refuses an incomplete capture: an empty page file, or a `_log.txt` line marked skipped or sign-in.
- `fetch-gamelogs.mjs` accepts only seasons 2026-27 and 2025-26. With `--snapshot`, `--to` must equal the snapshot's Eastern date. It throws when a final game has no box score, and writes `_coverage.json` only after every requested day succeeds.
- `guard-yahoo-url.mjs` exits 2 with "Blocked by the read-only Yahoo guard" when `checkUrl` returns a reason, exits 1 when stdin is not valid JSON, and exits 0 otherwise. It reads `YAHOO_LEAGUE_ID` from the environment, else from `.env` in `CLAUDE_PROJECT_DIR`, or in the working directory. If the key is missing, it does not check the league number.
- `import-draftlab.mjs` exits 2 when run directly without `--from`. It runs each Draft Lab file in a `vm` context with a 5-second timeout.

## Side Effects

- Network: `sheet` (unless `--no-fetch`; it also fetches the injuries feed), `build-ids`, `fetch-schedule` and `fetch-gamelogs` call ESPN and cache responses in `local/cache/espn/`. `fetch-gamelogs` always refetches scoreboards and reuses game summaries for a year.
- `data/` writes: `import-draftlab` writes `data/priors/` (and runs `git rev-parse HEAD` in the Draft Lab checkout), `fetch-schedule` writes `data/schedule-2026-27.json` and `build-ids` writes `data/ids.json`.
- `local/` writes: `sheet` writes `local/sheets/` and, through its refresh, `local/gamelogs/<season>/`. `build-snapshot` writes `local/snapshots/`, `fetch-gamelogs` writes `local/gamelogs/<season>/`, and `build-ids` and `match-ids` write unmatched reports to `local/reports/`.
- `sheet` reads the capture folder, `data/ids.json`, `data/schedule-2026-27.json`, `local/gamelogs/` and the cached scoreboard in `local/cache/espn/`.
- `guard-yahoo-url` reads `YAHOO_LEAGUE_ID` from `.env` and writes to stderr only when it blocks.

## Verification

- Run: `npm test`
