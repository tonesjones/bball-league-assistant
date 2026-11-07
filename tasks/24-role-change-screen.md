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
  - `limit: 15`: the length of the list.

Ignore log rows dated after `date`, so the screen gives the same answer for a past night as it
did on that night.

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

Compute both z values with `seasonValues` from `src/engine/season-value.mjs`, and use its
`perGameZ` (the sum over the 9 categories), not `value`. The reference pool is every player with
at least 3 games through `date`, at their per-game averages. Pass `poolSize` as the pool's length,
because the default keeps only the top 150. The season z is the player's entry in that pool. The
one-game z scores the box score on `date` against the same pool: pass it in as an extra entry and
keep it out of the reference with `poolFilter`.

Sort by one-game z, highest first, then jump, highest first, then ESPN ID. Return the first
`limit`. The flags decide who is on the list, and the night's production decides the order.
Sorting by jump alone pushes down players who barely cleared `minJump` but had big nights, and
lifts players who got minutes but did little with them.

### Wiring: `scripts/advise.mjs`

- `date`: the latest date in the loaded logs that has a played row, up to the snapshot's Eastern
  date (`easternDate` in `src/sources/gamelogs.mjs`).
- `exclude`: Tony's roster and `snapshot.matchup.opponentRoster`, matched to ESPN IDs with
  `findPlayer(ids.players, name, nbaTeam)` as `advise` already does for shooting volume.
- `available`: `snapshot.freeAgents` matched the same way.
- Add every player in `snapshot.league.teams[].roster[]` (each entry has `name` and `nbaTeam`) to
  `exclude`, and mark the rest `confirmed`, because every roster in the league is known.
- **No league rosters, no list.** If `snapshot.league.teams` is missing, don't screen. Print
  `Role changes: skipped (no league rosters in this capture)` in the section and the summary.
  An unconfirmed list mostly names players other managers already have: on 2026-11-06 it put 4
  rostered players in the top 11.
- If any rostered player fails to match an ESPN ID, list those names under the section as
  `Unmatched rostered players: ...`, because they could show up as available by mistake.
- Store the result as `report.roleChanges`, so it lands in the advice JSON and the decision
  record.
- Add a "Role changes (watch list)" section to `formatPlan`, after "Runners-up". One line per
  player, wrapped like the other sections, for example:
  `Name (TEAM) 38 min vs 18 earlier (+20), started 3 of last 3; 21p 11r 6a 0s 1b 1x3 8/14 4/5 2to; game z +1.2, season z -2.1; availability unconfirmed`.
  If the list is empty, print `  none`.
- `planSummary` (what `refresh:analyze` prints) adds one line: `Role changes: N (see full
  advice)`.

Leave the brief alone. It hides the chosen action, and this list is not part of the decision.

### Capture: `docs/update-league.md`

The screen needs every other team's roster, so the team pages move from "Trade research pages
(only when Tony asks)" into the routine page table: read `/{L}/{N}` for every team number from 1
to the league size except `{T}`, and save it as `teams/<N>.txt`. `build-snapshot` already parses
them into `league.teams`. These URLs are already on the read-only list, so nothing in
`src/sources/yahoo-urls.mjs` or the hook changes. This adds 11 page reads to each refresh in a
12-team league.

### Codex report: `docs/codex-briefing.md`

Codex shows Tony the summary and the brief, not `advice.txt`, so without this step the list
never reaches him. In step 5's report list, after the engine's suggestion, add:

- The "Role changes (watch list)" section from this run's full advice, verbatim, in one fenced
  block. Read it from the run's `advice.txt`; do not rephrase it or add players. If the section
  says `none`, print `Role changes: none`.

The rule that the vault runs note holds no player names stays. The list goes in the chat report
only.

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

- The sort order (one-game z, then jump, then ID) and `limit`. Include a player with a jump of
  exactly `minJump` and a big night who must rank above a player with a larger jump and a poor
  night.
- Log rows after `date` don't change the result.
- A DNP row on `date` doesn't count as playing.
- The same inputs give byte-identical output.
- `formatPlan` prints the section, and `none` for an empty list.
- A player on another team in `league.teams` is left out, and every listed player is
  `confirmed` when `league.teams` exists.
- Without `league.teams`, the section and the summary print the `skipped` line and no players.
- A rostered name that matches no ESPN ID is listed under `Unmatched rostered players`.

## Done when

- [ ] `npm test` passes, with the new tests.
- [ ] `npm run advise local/snapshots/2026-11-06-2226.json --allow-stale` lists both players Tony
  named on 2026-11-06 in the role-change section, and no player on any league roster. That
  snapshot is the 2026-11-06 capture plus all 11 other team pages. Check this locally. Put no
  player names in the PR, only "both found" or which one is missing and why.
- [ ] `npm run advise local/snapshots/2026-11-06-2225.json --allow-stale` (no team pages) prints
  the `skipped` line.
- [ ] `docs/update-league.md` lists the team pages as routine pages, as above.
- [ ] The planner's chosen action and runners-up in that run match the run before the change.
- [ ] The PR description says there is no `MODEL_VERSION` bump, and why.
- [ ] `docs/codex-briefing.md` has the report step above, and a Codex refresh after the merge
  prints the role-change section in its chat report.

## Blind test of this spec (2026-11-06)

An agent that hadn't seen the two names built a throwaway prototype from the first version of
this spec, and it ran on that night's box scores. 200 players played, and 23 were flagged. With
the first version's order (jump first, limit 10), one of Tony's two players ranked 3rd. The other
was flagged but ranked 15th, because his jump was exactly `minJump`. Sorting by one-game z put
them 10th and 6th, so this version sorts by one-game z with a limit of 15.

The thresholds were set after seeing these two players, so this was a check, not proof. The
earlier nights also showed that:

- one of the players was flagged on 2026-11-02, his first start, four days before Tony spotted
  him, but outside the top 10.
- many `unconfirmed` players are on other teams' rosters.

The real test runs forward: on later nights, compare the list with Tony's picks before he names
them.

Later the same night, Codex ran the same screen by hand from a prompt and got the same numbers.
Tony rejected the list because it named players other managers already had. Four of its top 11
were on other teams. The 11 other team pages were then captured into `2026-11-06-2226`, and the
prototype reran with every league roster excluded. All 187 rostered players matched an ESPN ID.
18 players were flagged, all available, and Tony's two picks ranked 4th and 6th. That is why this
version requires the team pages and skips the list without them.

## Out of scope

- A Yahoo page for available players sorted by recent stats ("Today (live)" or "Last 7 Days").
  The team pages already confirm availability, so this is no longer needed for the screen.
- Telling a free agent from a player on waivers. "Confirmed" means on no roster; the player may
  still need a waiver claim.
- Scoring rest-of-season adds in the planner, or pairing a drop with a watch-list player.
- Injury or news context for a role change.
