# sources

## Overview

Data loading and parsing. This directory fetches and parses ESPN data, checks Yahoo URLs against the read-only allow-list, validates league snapshots, loads and refreshes game logs, and parses each captured Yahoo page for the facts sheet. The Yahoo page parsers are in [`yahoo-pages/`](./yahoo-pages/README.md).

## Interface

**Yahoo**

- `yahoo-urls.mjs:checkUrl`: returns `null` when a Yahoo URL is on the read-only allow-list, or a refusal reason. `scripts/guard-yahoo-url.mjs` uses it.
- `sheet-pages.mjs:parsePages(texts, {publicView})`: parses each captured page on its own. Returns `{ok: true, value}` or `{ok: false, reason}` per page, plus lists for `fa` and `teams`. When a team page has a `-tree` file, it falls back to `yahoo-pages/roster-tree.mjs`. With `publicView` (a signed-out public capture), the parsers skip the signed-out check, and Tony's team page is also read as `team-public` (name and roster only); when the full team parse fails there, `team` gets the reason `PUBLIC_TEAM_REASON`.
- `public-capture.mjs`: the public capture's page plan (`firstPages`, `laterPages`), `teamCount` and `matchupWeek` from page text, the folder `stamp` in a time zone, and `isPublicLog` for the `_log.txt` mode line. Pure.
- `yahoo-pages/team-values.mjs:parseTeamValues`: reads the FAAB balance from the first `Waiver Budget: $N` match in `team-values.txt`. It reads nothing else from that file.
- `sheet-pages.mjs:shortReason`: shortens an error message and drops any quoted page text.
- `league-state.mjs:validate`: checks a snapshot's shape, throws one "invalid snapshot" error listing every problem, and returns the snapshot.
- `id-map.mjs:matchSnapshot`: matches snapshot roster, opponent and free-agent names to the ID map. Returns `{matched, unmatched}`.
- [`yahoo-pages/`](./yahoo-pages/README.md): parsers for saved Yahoo page text, and `buildSnapshot`.

**ESPN**

- `espn.mjs:getJson`: cached, rate-limited GET with retries that returns parsed JSON. `BASE` is the ESPN NBA API base URL.
- `espn.mjs:TEAM_CODES`, `standardCode`: map ESPN team codes (`GS`, `SA`, `NY`, `NO`, `UTAH`, `WSH`) to standard ones.
- `espn-parse.mjs:parseTeams`, `parseSchedule`, `parseRoster`: ESPN teams, schedule (Eastern calendar days) and rosters.
- `espn-boxscore.mjs:parseScoreboard`, `parseBoxScore`: event IDs and statuses, and per-player box-score rows.
- `espn-injuries.mjs:parseInjuries`, `trimComment`: the injuries feed as `{fetchedAt, entries}` (ESPN ID from the player-card link, team, status, report date, return date or `null`, short comment), and a comment cut to 160 characters. Pure.
- `espn-injuries-load.mjs:loadInjuries`: fetches the feed with a 2-hour cache, or reads only the cached file with `noFetch`. Returns `{ok, value}` or `{ok: false, reason}` and never throws.
- `gamelogs.mjs:refreshGameLogs`: fetches box scores for a date range into `local/gamelogs/<season>/` and writes `_coverage.json`.
- `gamelogs.mjs:loadProjectionLogs`: loads and verifies the per-day game logs for a projection window.
- `gamelogs.mjs:loadGameLogs`: concatenates per-day log rows in a date range.
- `gamelogs.mjs:logHash`, `easternDate`: SHA-256 of text, and the `America/New_York` date.

## Invariants

- `checkUrl` guards Yahoo only. It allows any URL outside yahoo.com, and empty or non-string input. On yahoo.com it allows only `https://basketball.fantasysports.yahoo.com` with paths of the form `/nba/<league>/<page or team number>`. When a league ID is given, the league must match it; without one, any league passes. Named pages allow only the query keys listed in `PAGES`, and team-number pages allow none. It refuses `back`, `forward` and strings that do not parse as a URL.
- `parsePages` does not throw. A missing page, an empty file or a parse error becomes `{ok: false, reason}`, and the reason leaves out page text.
- `getJson` waits at least 500 ms between requests, times out after 30 s, and makes up to 4 attempts with `2000 * 2^attempt` ms backoff. It retries on 429, 500, 502, 503 and 504, on network errors, and on a 2xx response whose body is not valid JSON. Other statuses fail at once. It uses a cache file younger than `maxAgeHours` (default 24). A cache read error other than a missing file, such as a corrupt cache file, is thrown, not refetched.
- `refreshGameLogs` writes `_coverage.json` only after every day succeeds, and merges with existing coverage when the two ranges touch.
- `loadProjectionLogs` throws on a bad window, coverage checked before `asOf` or not spanning the window, a missing day file, a hash mismatch, or rows missing `didNotPlay` or `starter`. `loadGameLogs` skips missing days.
- `parseBoxScore` throws on missing stat labels or invalid stats. A coach's-decision row counts as 0 minutes when the player did not play, or when the row is active with placeholder minutes.
- `parseSchedule` skips and reports games with a missing or TBD team.

## Side Effects

- `espn.mjs:getJson`: network GET to the URL the caller passes (every caller passes an ESPN URL under `BASE`), and reads and writes the caller's cache file.
- `gamelogs.mjs`: reads `local/gamelogs/<season>/_coverage.json` and `<date>.json`. `refreshGameLogs` also writes them and the ESPN cache.
- `espn-injuries-load.mjs`: reads and writes `local/cache/espn/injuries.json` and calls the injuries endpoint through `getJson`.
- The other files are pure. `espn.mjs` keeps the time of the last request in module state.

## Verification

- Run: `npm test`
