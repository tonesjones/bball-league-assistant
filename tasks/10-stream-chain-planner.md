# Task 10: stream-chain planner

A side tool beside `npm run advise`. It doesn't change advice output, decision records or the
bakeoff, so it doesn't affect the pilot. Needs Tasks 02, 05 and 08.

## Goal

Get the most started games out of one stream slot in a week by chaining pickups across teams'
back-to-backs. For example: a player whose team plays Monday and Tuesday, dropped on Wednesday for
a team that plays Wednesday and Thursday, dropped on Friday for a team that plays Friday and
Saturday, then a Sunday player. Return the best chain for 2, 3 and 4 adds.

Schedule efficiency never outranks a long-term pickup. If an available player is worth holding
for the season, the report lists that player first and gives them an add, and the chain plans
only with the adds left over (see "Long-term pickups come first").

## Inputs

- The league snapshot (Task 02): Tony's roster with positions and status, free agents with team,
  positions, status and `waiverClears`, the league's lineup slots, max adds per week and adds used.
- `data/schedule-2026-27.json`.
- Projections from `projectPlayers` (`src/engine/projections.mjs`) and the advice result from
  `advise()` on the same snapshot.
- `local/roles.json` (git-ignored). The stream slot is a roster player in `stream`, chosen with
  `--slot "<name>"`, or an empty roster spot (`--slot empty`). A core player is refused.
- `--from` and `--to` dates. The default is tomorrow through the end of the current matchup week.

## Behavior

All logic goes in a new pure module, `src/engine/stream-chain.mjs`. I/O goes in
`scripts/stream-plan.mjs` (`npm run stream`).

### Open slot per day

A back-to-back is worth only the days the pickup can start. Tony's other players and the
league's roster slots decide that, not the schedule alone. For example:

- On Monday, if only SG and SF are open, a center pickup starts zero games that day.
- On Wednesday, if Tony already has more players with games than slots, a Wednesday–Thursday
  pickup starts only Thursday. Wednesday is a wash.

For each day, take Tony's roster without the stream-slot player, keeping the players whose team
plays that day and whose status is not in `BLOCKED`. Run `assignLineup`
(`src/engine/needs.mjs`) on them to get the rostered starters. A candidate starts that day only if
their team plays and a legal lineup exists with all of those rostered starters plus the
candidate. Rostered players may move to other slots they're eligible for (a G/F can move from
G to F to open G). Rostered starters are never benched for the candidate.

`assignLineup` finds lineups by augmenting paths, so placing the candidate after every rostered
player keeps all rostered starters. Add an option or a small exported helper to place one player
last. Don't decide by checking the candidate against one arrangement's unfilled slots: that misses
lineups where a flexible player moves over.

A day with a game but no legal start counts zero started games for that candidate. The planner
gets no credit for it, so a Wednesday–Thursday team on a full Wednesday ties a Thursday-only
team, and the chain may make the add effective Thursday instead.

### Candidates

Free agents and waiver players who:

- aren't in `BLOCKED` and have a return timeline (the `AGENTS.md` pickup guardrail);
- have a known current team in the snapshot;
- can be active by the day their link starts: `pickupStart` (`src/engine/v0-advice.mjs`) on or
  before that day;
- aren't long-term hold candidates (next section);
- weren't dropped earlier in the same chain (dropped players go to waivers).

A candidate with no projection still counts for games and is labeled "unprojected".

### Chains

A chain is a list of links. Each link holds one player over a run of days. The next link's add
is effective the day after the last day of the previous link, and that add drops the previous
player. A link's value is the started games inside its run. If the current stream player plays
early in the window, the first link may be that player, using no add.

For each budget of 2, 3 and 4 adds, return the chain with the most started games, then break
ties in this order:

1. More games from projected players.
2. Higher summed season value (`seasonValues` on the projections) over started games.
3. Player names, alphabetically, so the same inputs give the same output.

A budget larger than the adds left (after any reserve below) is shown as "not available", not
planned. Each link also lists up to 3 alternatives that start the same days, so Tony can choose
by category fit.

### Long-term pickups come first

An available player is a long-term hold candidate if either is true:

- `advise()` returns `move` or `insufficient evidence` with that player as the pickup.
- The player ranks inside `protectRank` (default 120, the same guardrail that protects rostered
  players) by season value under any minutes or rate case `minutesCase` already builds (prior or
  season minutes, prior or shrunk per-minute rates). One case is enough. A hot start therefore
  counts even when last season's rates rank the player low.

When at least one hold candidate exists:

- The report lists every hold candidate first, above all chains, with the numbers and evidence
  `advise()` gives (games, minutes and rate cases).
- One add is reserved for the top hold candidate. Chains plan with `addsLeft - 1`.
- If the hold candidate's drop is the stream-slot player, no chain is planned. The report says
  the slot goes to that player.
- Hold candidates never appear as chain links or alternatives, because a link gets dropped later.
- Games per add never compares a chain against a hold candidate. No score can put a chain above
  one.

### Output

First, a day-by-day table for the window: games scheduled for Tony's other players, rostered
starters, players benched because the day is full, and the open slots in the rostered starters'
assignment (for example "SG, SF", "none, 2 benched"). The open-slot column only explains the
plan. Whether a candidate starts is still decided by the legal-lineup check above.

For each budget: the links (player, team, run of dates, started games each day, unprojected flag),
total started games, adds used, and how many games the current stream player starts if Tony makes
no move. The report also shows the snapshot's as-of time and the schedule fetch time.

Only the first link is a recommendation. The report says to make that add, refresh, and rerun
before the next link, because the free-agent pool and lineups change. This keeps the `AGENTS.md`
rule of one move per refresh.

A chain whose adds fall in a later week, for example a Sunday add for Monday, counts those adds
against the week set by `--adds-week effective` (default, the week of the effective date) or
`--adds-week transaction` (the week of the add itself). The report names the option it used. See
"Open questions".

## Done when

All tests use synthetic fixtures in `tests/fixtures/stream/`, with no real names.

- [ ] A 7-day schedule with back-to-backs on Mon–Tue (team A), Wed–Thu (B) and Fri–Sat (C), a
      Sunday game (D), and a team E that plays Tue, Wed, Fri and Sun, with Util open every day:
      4 adds give 7 started games
      (A, B, C, D), 3 adds give 6, and 2 adds give 5 (a Monday player, then E).
- [ ] A day with no fitting open slot adds no started game. The planner picks a team that starts
      instead when one exists.
- [ ] A day with only SG and SF open (Util filled): a C-only candidate starts zero games that
      day, while an SG/SF candidate starts. `Util` fits anyone when it is open.
- [ ] A day with more rostered players playing than slots: a Wednesday–Thursday candidate counts
      one started game (Thursday), ties a Thursday-only candidate on games, and no rostered
      starter is benched.
- [ ] A flexible rostered G/F sits in G, and only F is open in that arrangement: a PG-only
      candidate still starts, because the G/F moves to F.
- [ ] The report's day table shows open slots and benched counts for each day in the window.
- [ ] A player who is out, with no return timeline, or on waivers past the link's start never
      appears. A player dropped earlier in the chain isn't added back.
- [ ] A free agent inside `protectRank` under the shrunk-rate case (but not the prior case) is
      listed first, takes one reserved add, and appears in no chain. With 4 adds left, only the
      2- and 3-add chains are planned.
- [ ] An `advise()` result of `insufficient evidence` naming an available pickup also reserves
      an add and is listed first.
- [ ] When the hold move drops the stream-slot player, no chain is planned and the report says why.
- [ ] A budget larger than the adds left is "not available". A core player as `--slot` is refused.
- [ ] Tied chains come out the same on every run, in the documented tie-break order.
- [ ] The report shows the as-of times and says only the first link is a recommendation.
- [ ] `npm test` passes.

## Limits

- This counts started games, not category value. FG%, FT% and TO risk from a weak streamer show
  only through the alternatives list and the season-value tie-break.
- The free-agent pool is read once. Players taken later in the week break later links, which is
  why the report says to rerun before each add.
- If the league has a games cap (read from settings), the planner refuses to run, because games
  used this week are unknown (PLAN step 4b gap). This league has none.

## Open questions

- Which week a Sunday add for a Monday game counts against in Yahoo. Check it on the next real
  transaction page and make that the default for `--adds-week`.
- Whether Tony wants a per-category streamer score here later. If so, it belongs after Task 03
  (matchup odds), not in this task.
