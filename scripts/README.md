# scripts

## Overview

Command-line entry points. They fetch ESPN data, turn a Yahoo capture folder into a snapshot, run the week planner, record decisions in the shadow log and replay them. The Claude Code hook that guards Yahoo URLs lives here too. The logic they call lives in [`../src/engine/`](../src/engine/README.md) and [`../src/sources/`](../src/sources/README.md).

## Interface

| Script | npm command | What it does |
|---|---|---|
| `analyze-refresh.mjs` | `refresh:analyze -- local/raw/YYYY-MM-DD-HHmm` | Runs `build-snapshot`, `fetch-gamelogs` and `advise` on one capture folder, as child processes, and prints a summary. |
| `build-snapshot.mjs` | none | Parses a capture folder (default: the newest under `local/raw/`) into `local/snapshots/<folder>.json`. |
| `fetch-gamelogs.mjs` | `fetch:gamelogs` | Fetches ESPN box scores. Takes `--season 2026-27 \| 2025-26` (required), and optionally `--from`, `--to` and `--snapshot <path>`. |
| `advise.mjs` | `advise` | Runs the planner on one snapshot (default: the newest) and prints the report. Flags: `--from` (alias `--adds-from`), `--allow-stale`, `--max-age-hours N`, `--drop-bar`, `--add-bar`, `--margin`, `--minutes-k`, `--protect-rank`, `--candidates`, `--beam`, `--drops-per-pickup`, `--max-steps`, `--pool-size`. |
| `brief.mjs` | `brief` | Writes a ChatGPT context-check prompt for a decision (default: the newest). Accepts `--fa` (a nonnegative integer) and `--state <path>` for compatibility, checks them, and does not use them. |
| `did.mjs` | `did` | Records your decision: `<decisionId> hold` or `<decisionId> add "<player>" --on YYYY-MM-DD`, with `--tag` (required), `--drop`, `--minutes N`, `--rescue`, `--reason` and `--replace`. |
| `bakeoff.mjs` | `bakeoff` | Subcommands `record <entries.json>`, `score --week N --from D --to D` and `replay --to D`. |
| `import-draftlab.mjs` | `import:draftlab` | Imports last season's priors from a Draft Lab checkout. The npm command always reads `../fantasy-basketball-mock-draft`. To read another checkout, run `node scripts/import-draftlab.mjs --from <dir> [--out <dir>]` (default `--out` is `data/priors`). |
| `fetch-schedule.mjs` | `fetch:schedule` | Writes the NBA regular-season schedule to `data/schedule-2026-27.json`. |
| `build-ids.mjs` | `build:ids` | Builds the player ID map `data/ids.json` from ESPN rosters and the priors. |
| `match-ids.mjs` | `match:ids` | Matches a snapshot's players (default: the newest) against the ID map. |
| `guard-yahoo-url.mjs` | none | `PreToolUse` hook. Reads the tool call on stdin and blocks any Yahoo URL that `checkUrl` refuses. |

Run each with `npm run <command>`, putting `--` before any arguments.

## Invariants

- `advise.mjs:snapshotFreshness` refuses a snapshot older than `--max-age-hours` (default 12) unless `--allow-stale` is passed, and says how old it is.
- `advise.mjs` throws on unknown flags, extra arguments or integer flags below their minimums. `local/protected.json` must have the shape `{"protected": [names]}`. A failed shadow-log write is reported on stderr, and the advice is still written.
- `build-snapshot.mjs` requires a folder named `YYYY-MM-DD-HHmm`, which supplies `asOf`. It refuses an incomplete capture: an empty page file, or a `_log.txt` line marked skipped or sign-in.
- `analyze-refresh.mjs` takes exactly one capture folder. It stops at the first failed step, records `failedStep` in `status.json`, prints "No decision was made." and exits 1. It moves earlier logs for the same capture into `attempt-<n>/`.
- `fetch-gamelogs.mjs` accepts only seasons 2026-27 and 2025-26. With `--snapshot`, `--to` must equal the snapshot's Eastern date. It throws when a final game has no box score, and writes `_coverage.json` only after every requested day succeeds.
- `did.mjs` requires `--tag`. `hold` rejects `--drop` and `--on`, and `add` requires `--on`. A player with no ESPN ID in `data/ids.json` is an error.
- `brief.mjs` writes with the `wx` flag and never overwrites a brief. `docs/chatgpt-brief.md` must contain the prompt start and end markers and a prompt version line.
- `bakeoff.mjs record` requires a positive-integer `promptVersion` on `chatbot` entries and rejects one on `tool`, `none` and `tony` entries. An entry's week and `asOf` must match its decision. `score` refuses `--final`.
- `guard-yahoo-url.mjs` exits 2 with "Blocked by the read-only Yahoo guard" when `checkUrl` returns a reason, exits 1 when stdin is not valid JSON, and exits 0 otherwise. It reads `YAHOO_LEAGUE_ID` from `.env` in `CLAUDE_PROJECT_DIR`, or in the working directory. If the key is missing, it does not check the league number.
- `import-draftlab.mjs` exits 2 when run directly without `--from`. It runs each Draft Lab file in a `vm` context with a 5-second timeout.

## Side Effects

- Network: `build-ids`, `fetch-schedule` and `fetch-gamelogs` call ESPN through `getJson` and cache responses in `local/cache/espn/`. `fetch-gamelogs` always refetches scoreboards and reuses game summaries for a year.
- `data/` writes: `import-draftlab` writes `data/priors/` (and runs `git rev-parse HEAD` in the Draft Lab checkout), `fetch-schedule` writes `data/schedule-2026-27.json` and `build-ids` writes `data/ids.json`.
- `local/` writes: `build-snapshot` writes `local/snapshots/`, `fetch-gamelogs` writes `local/gamelogs/<season>/`, `advise` writes `local/decisions/` and `local/advice/` and appends to `local/bakeoff.jsonl`, `did` and `bakeoff record` append to `local/bakeoff.jsonl`, `brief` writes `local/briefs/`, `analyze-refresh` writes `local/refreshes/<stamp>/`, and `build-ids` and `match-ids` write unmatched reports to `local/reports/`.
- `advise` reads `data/ids.json`, `data/priors/players.json`, `data/schedule-2026-27.json`, `local/gamelogs/`, `local/roles.json`, `local/protected.json` and `local/preferences.json`, and runs `git rev-parse HEAD` and `git status --porcelain` for provenance.
- `guard-yahoo-url` reads `YAHOO_LEAGUE_ID` from `.env` and writes to stderr only when it blocks.

## Verification

- Run: `npm test`
