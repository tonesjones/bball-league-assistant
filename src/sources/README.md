# sources

## Overview

Data loading and storage. This directory fetches and parses ESPN data, checks Yahoo URLs against the read-only allow-list, validates league snapshots, loads game logs with hash checks, and reads and writes decision records and the shadow log. The Yahoo page parsers are in [`yahoo-pages/`](./yahoo-pages/README.md).

## Interface

**Yahoo**

- `yahoo-urls.mjs:checkUrl`: returns `null` when a Yahoo URL is on the read-only allow-list, or a refusal reason. `scripts/guard-yahoo-url.mjs` uses it.
- `league-state.mjs:validate`: checks a snapshot's shape, throws one "invalid snapshot" error listing every problem, and returns the snapshot.
- `id-map.mjs:matchSnapshot`: matches snapshot roster, opponent and free-agent names to the ID map. Returns `{matched, unmatched}`.
- [`yahoo-pages/`](./yahoo-pages/README.md): parsers for saved Yahoo page text, and `buildSnapshot`.

**ESPN**

- `espn.mjs:getJson`: cached, rate-limited GET with retries that returns parsed JSON. `BASE` is the ESPN NBA API base URL.
- `espn.mjs:TEAM_CODES`, `standardCode`: map ESPN team codes (`GS`, `SA`, `NY`, `NO`, `UTAH`, `WSH`) to standard ones.
- `espn-parse.mjs:parseTeams`, `parseSchedule`, `parseRoster`: ESPN teams, schedule (Eastern calendar days) and rosters.
- `espn-boxscore.mjs:parseScoreboard`, `parseBoxScore`: event IDs and statuses, and per-player box-score rows.
- `gamelogs.mjs:loadProjectionLogs`: loads and verifies the per-day game logs for a projection window.
- `gamelogs.mjs:loadGameLogs`: concatenates per-day log rows in a date range.
- `gamelogs.mjs:logHash`, `easternDate`: SHA-256 of text, and the `America/New_York` date.

**Decisions and shadow log**

- `decisions.mjs:saveDecision`, `readDecision`, `validDecisionId`, `DECISIONS_DIR`: write and read decision records in `local/decisions`.
- `bakeoff-log.mjs:appendEntries`, `readEntries`, `BAKEOFF_LOG`: append to and read the shadow log `local/bakeoff.jsonl`.
- `bakeoff-records.mjs:decisionInputs`: loads a decision's snapshot, ID map and schedule after checking their hashes.
- `bakeoff-records.mjs:attachLineups`: rebuilds the baseline, proposed and opponent lineups for a log entry, or marks it unscored.
- `bakeoff-records.mjs:hash`: SHA-256 of a value.

## Invariants

- `checkUrl` guards Yahoo only. It allows any URL outside yahoo.com, and empty or non-string input. On yahoo.com it allows only `https://basketball.fantasysports.yahoo.com` with paths of the form `/nba/<league>/<page or team number>`. When a league ID is given, the league must match it; without one, any league passes. Named pages allow only the query keys listed in `PAGES`, and team-number pages allow none. It refuses `back`, `forward` and strings that do not parse as a URL.
- `getJson` waits at least 500 ms between requests, times out after 30 s, and makes up to 4 attempts with `2000 * 2^attempt` ms backoff. It retries on 429, 500, 502, 503 and 504, on network errors, and on a 2xx response whose body is not valid JSON. Other statuses fail at once. It uses a cache file younger than `maxAgeHours` (default 24). A cache read error other than a missing file, such as a corrupt cache file, is thrown, not refetched.
- `saveDecision` writes with the `wx` flag under a new random UUID, so it never overwrites a record. `readDecision` throws on a bad ID or when the stored `id` differs.
- `appendEntries` throws on a duplicate decision and source unless `replaces` is `true`.
- `loadProjectionLogs` throws on a bad window, coverage checked before `asOf` or not spanning the window, a missing day file, a hash mismatch, or rows missing `didNotPlay` or `starter`. `loadGameLogs` skips missing days.
- `decisionInputs` throws when a snapshot, ID map or schedule hash differs from the decision's provenance.
- `decisionInputs` also throws "Decision predates replay evidence" when the record has no `projections.players` or `report.banked`.
- `attachLineups` throws when an entry's week or `asOf` differs from the decision. It then returns the entry unscored if the decision has no replay evidence, and skips the remaining checks. Otherwise it throws when a `none` entry does not hold, a `tool` entry differs from the saved recommendation, or a move is illegal. A `tony` entry with an illegal move is returned unscored instead, and may pick up from the opponent's roster as well as free agents. Core players cannot be dropped.
- `parseBoxScore` throws on missing stat labels or invalid stats. A coach's-decision row counts as 0 minutes when the player did not play, or when the row is active with placeholder minutes.
- `parseSchedule` skips and reports games with a missing or TBD team.

## Side Effects

- `espn.mjs:getJson`: network GET to the URL the caller passes (every caller passes an ESPN URL under `BASE`), and reads and writes the caller's cache file.
- `decisions.mjs`: creates `local/decisions/` and writes `<uuid>.json`; reads records from it.
- `bakeoff-log.mjs`: appends to and reads `local/bakeoff.jsonl`.
- `gamelogs.mjs`: reads `local/gamelogs/<season>/_coverage.json` and `<date>.json`.
- `bakeoff-records.mjs`: reads the decision's snapshot, `data/ids.json` and `data/schedule-2026-27.json`.
- The other files are pure. `espn.mjs` keeps the time of the last request in module state.

## Verification

- Run: `npm test`
