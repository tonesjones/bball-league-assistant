# Task 24: Role-change screen

Requested by Tony on 2026-11-06. One PR, buildable by Sonnet.

## Why

On 2026-11-06 Tony asked for long-term pickups from that night's games. He had two players in
mind, and the free-agent ranking missed both. There were two reasons:

- Neither player was in the capture. `fa-1.txt` to `fa-4.txt` hold the top 100 available players
  by Yahoo season rank, and both ranked lower.
- Neither stood out by one-game 9-category value. Ranked across every box score that night, one
  came 22nd and the other missed the top 25, mostly behind rostered players.

What Tony saw was a change in role. One player had started three games in a row after six off the
bench, and played 38 minutes against an earlier 18 per game. The other played 24 minutes against
16 per game and took 17 rebounds. More minutes and a starting spot usually show up before season
averages or Yahoo's rank move.

## What to build

A watch list of players whose role grew in the last night of games, added to the advice report.
It is information, not a recommendation: it pairs no drop, feeds nothing into the planner and
changes no score. No `MODEL_VERSION` bump.

### Engine: `src/engine/role-change.mjs`

Pure, no I/O. Export `roleChanges({ logs, date, exclude, available, options })`.

- `logs`: the game-log rows `advise` already loads (`loadProjectionLogs`). Ignore rows with
  `didNotPlay: true`.
- `date`: the night to screen (`YYYY-MM-DD`).
- `exclude`: a set of ESPN IDs to leave out (Tony's roster and the opponent's).
- `available`: a set of ESPN IDs a Yahoo page confirms as available (the captured free agents).
- `options`, with these defaults:
  - `minJump: 8`: the minutes jump that flags a player.
  - `minMinutes: 24`: the fewest minutes on `date` for a minutes flag.
  - `minPriorGames: 3`: the fewest games before `date`. Players with fewer are left out.
  - `limit: 10`: the length of the list.

For each player who played on `date` and isn't in `exclude`:

- **Earlier games**: all of the player's games before `date`.
- **Recent games**: the player's last 3 games up to and including `date`.
- **Minutes jump**: minutes on `date` minus mean minutes over the earlier games.
- **Minutes flag**: the jump is at least `minJump` and minutes on `date` are at least
  `minMinutes`.
- **Starter flag**: the player started at least 2 of the recent games, and at most 1 of the
  earlier games that aren't among the recent games.

Keep a player if either flag is set. For each one, return:

- the ESPN ID, name and team from the log row
- the flags
- earlier mean minutes, minutes on `date`, the jump, and starts in recent and earlier games
- the box score on `date`
- the one-game z and the season z
- `availability`: `confirmed` if the ID is in `available`, else `unconfirmed`

Compute both z values with `seasonValues` from `src/engine/season-value.mjs`. The reference pool
is every player with at least 3 games, at their season per-game averages. The season z is the
player's entry in that pool. The one-game z scores the box score on `date` against the same pool.

Sort by jump, highest first, then one-game z, highest first, then ESPN ID. Return the first
`limit`.

### Wiring: `scripts/advise.mjs`

- `date`: the latest date in the loaded logs that has a played row, up to the snapshot's Eastern
  date (`easternDate` in `src/sources/gamelogs.mjs`).
- `exclude`: Tony's roster and `snapshot.matchup.opponentRoster`, matched to ESPN IDs with
  `findPlayer(ids.players, name, nbaTeam)` as `advise` already does for shooting volume.
- `available`: `snapshot.freeAgents` matched the same way.
- If `snapshot.league.teams` exists (a `--trades` capture), add every player on those rosters to
  `exclude`, and mark the rest `confirmed`, because every roster in the league is known.
- Store the result as `report.roleChanges`, so it lands in the advice JSON and the decision
  record.
- Add a "Role changes (watch list)" section to `formatPlan`, after "Runners-up". One line per
  player, wrapped like the other sections, for example:
  `Name (TEAM) 38 min vs 18 earlier (+20), started 3 of last 3; 21p 11r 6a 0s 1b 1x3 8/14 4/5 2to; game z +1.2, season z -2.1; availability unconfirmed`.
  If the list is empty, print `  none`.
- `planSummary` (what `refresh:analyze` prints) adds one line: `Role changes: N (see full
  advice)`.

Leave the brief alone. It hides the chosen action, and this list is not part of the decision.

## Tests

Add `tests/role-change.test.mjs` with a synthetic fixture in `tests/fixtures/`. Use made-up
names. This repo is public.

| Player | Shape | Expected |
|---|---|---|
| A | 6 bench games at about 18 min, then 3 starts ending at 38 min | Kept, both flags |
| B | 8 bench games at about 16 min, then 24 min | Kept, minutes flag only |
| C | 8 games at 30 min, then a big box score at 31 min | Left out |
| D | Same shape as A, but in `exclude` | Left out |
| E | 2 games before `date` | Left out |
| F | Same shape as B, and in `available` | Kept, `confirmed` |

Also test:

- The sort order (jump, then one-game z, then ID) and `limit`.
- A DNP row on `date` doesn't count as playing.
- The same inputs give byte-identical output.
- `formatPlan` prints the section, and `none` for an empty list.

## Done when

- [ ] `npm test` passes, with the new tests.
- [ ] `npm run advise local/snapshots/2026-11-06-2225.json --allow-stale` lists both players Tony
  named on 2026-11-06 in the role-change section. Check this locally. Put no player names in the
  PR, only "both found" or which one is missing and why.
- [ ] The planner's chosen action and runners-up in that run match the run before the change.
- [ ] The PR description says there is no `MODEL_VERSION` bump, and why.

## Out of scope

- Confirming availability past the top 100. That needs a Yahoo page for available players sorted
  by recent stats ("Today (live)" or "Last 7 Days"), and its query parameter isn't on the
  read-only URL list. Tony can paste that URL from his own browser, and adding it is a separate
  PR that needs his OK.
- Scoring rest-of-season adds in the planner, or pairing a drop with a watch-list player.
- Injury or news context for a role change.
