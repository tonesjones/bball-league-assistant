# engine

## Overview

Pure planning and scoring logic. It holds the week planner (`planWeek`), the per-category win model (`needs`, `projectTeam`), player projections and season values, the drop guardrails, preference and lineup-lock handling, and the shadow-log validation and replay. Nothing here does I/O: callers pass data in and get results back.

## Interface

**Planner and win model**

- `week-plan.mjs:planWeek`: beam-search planner. Returns `{action: 'add' | 'wait' | 'hold', step, plan, gain, bar, runnersUp, dependsOn, guardrail, decision, ...}`.
- `needs.mjs:needs`: per-category margin, spread, win probability and label (`close`, `safe`, `lost`, `lean` or `unknown`), plus `expectedCategories`.
- `needs.mjs:projectTeam`: projected totals and starts over a date range, with swaps applied by start date.
- `needs.mjs:dayLineup`, `assignLineup`, `fits`, `openRosterSpots`: lineup assignment for one day, slot eligibility (an exact position, or G, F or Util) and open non-IL roster spots.
- `needs.mjs:strongLine`: a strong per-game line from the top of the prior pool: the 90th percentile per stat (10th for TO). FGM and FTM are the 90th-percentile attempts times the 90th-percentile percentage.
- `needs.mjs:normalCdf`: standard normal CDF approximation.
- `needs.mjs` constants: `STAT` (category to stat key), `DEFAULT_PHI` (per-category multiplier on the variance of remaining production), `BLOCKED` (`O`, `D`, `INJ`, `SUSP`, `NA`) and `UNKNOWN_MPG` (24).

**Projections and value**

- `projections.mjs:projectPlayers`: blends prior minutes and rates with this season's game logs. Returns `{players, k, asOf, version: 'current-season-rates-v4'}`.
- `projections.mjs:minutesCase`: rescales a player to a prior or season minutes case, using prior or season rates (`rateMode`).
- `season-value.mjs:seasonValues`: `Map` of name to `{value, rank, ...}` from z-scores against the top `poolSize` players.
- `shooting-volume.mjs:estimateVolume`: rebuilds this week's banked FGM/FGA/FTM/FTA from game logs. Returns `{status: 'matched' | 'unknown', ...}`.

**Shared advice rules**

- `advice-common.mjs:MODEL_VERSION`: the model version, currently 8.
- `advice-common.mjs:dropBlock`: the reason a drop is blocked (`core`, `ilCapacity`, `lineupLock`, `noPrior`, `rank` or `seasonValue`), or `null`.
- `advice-common.mjs:matchPlayers`, `normalizeRoles`, `identity`, `pickupStart`, `monthDay`: player matching, core/stream roles, player identity, earliest add date and Yahoo month-day parsing.
- `preferences.mjs:applyPreferences`: applies `ilCandidates`, `notIlCandidates` and `lineupLocks` to a copy of the snapshot. Returns `{snapshot, notes}`.

**Shadow log and replay**

- `bakeoff.mjs:validateEntry`, `validateReview`: validate a log entry or review, or throw.
- `bakeoff.mjs:latestEntries`, `differs`, `flips`, `summarize`, `replaySummary`, `realizedGain`: newest entry per decision and source, comparison, category flips and replay totals. `realizedGain` is `replayLineups`.
- `bakeoff.mjs:TONY_TAGS`: `changed-decision`, `caught-mistake`, `no-effect`, `wasted-time`.
- `lineup-replay.mjs:replayLineups`: replays saved lineups over box scores. Returns `{status: 'scored' | 'unscored', gain, ...}`.
- `lineup-replay.mjs:STATS`, `zeroLine`, `categoryTotals`: the stat keys, an all-zero stat line, and category totals from a stat line.
- `brief.mjs:buildBrief`: renders a saved decision as the context-check brief that `npm run brief` writes. It never shows the action, steps or gains.

**Dates and names**

- `weeks.mjs:addDays`, `tomorrow`: UTC day arithmetic, and the next day in `America/Los_Angeles`.
- `games-left.mjs:gameDates`, `gamesLeft`: a player's team game dates in a range, and their count.
- `schedule-check.mjs:gamesPerWeek`, `checkPlayoffWeeks`: games per team per week, and playoff weeks whose counts differ from the expected ones.
- `names.mjs:normalizeName`, `findPlayer`: name keys without accents or suffixes, and name lookup that returns `{player}` or `{reason: 'ambiguous' | 'not found'}`.

## Invariants

- No randomness. `planWeek` gives the same output for the same input. `comparePlans` breaks ties by gain (rounded to 1e-9), then step count, then each step's start date and the pickup's and drop's `identity()` (ESPN ID, or the normalized name when there is none).
- `planWeek` builds two scenarios per side: unprojected games filled with zeros, and, when there are any, filled with `strongLine`. A plan's gain is the worst of the four pairs, each measured as `expectedCategories` minus the same pair's no-move baseline. A plan clears only if its gain meets `dropBar` when it drops a rostered player, or `addBar` otherwise.
- Minutes cases (`minutesCase`) do not change the gain or the action. They feed only the cautious check reported in `dependsOn`.
- `planWeek` considers only free agents with a prior, not in `BLOCKED`, not already claimed and able to start by the window's end. Adds left equal `maxAddsPerWeek` (default 4) minus adds used and pending claims in the window, never below 0. `maxSteps` is capped at adds left.
- `week-plan.mjs:checkOptions` throws on non-positive or non-integer `candidates`, `beam` (which may be `Infinity`) or `dropsPerPickup`, a negative or non-integer `maxSteps`, a non-finite `seasonMargin`, a negative or non-finite `dropBar` or `addBar`, or a `fromDate` that is not `YYYY-MM-DD` or is before the window start. A negative `seasonMargin` is allowed.
- The returned `decision.action` is `move` or `hold`, so a `wait` action is recorded as `hold`.
- `dropBlock` checks in order: core player; IL drop with no open spot; lineup lock on or after the start; stream or earlier-plan pickup (allowed); no season line from the prior source; rank within `protectRank`; pickup value below drop value plus `seasonMargin`.
- `needs` marks a category `unknown` with null values when its shooting or counting totals are unknown, and never projects it as zero. TO is inverted: fewer wins.
- `projectTeam` caps total starts at `settings.maxGamesPerWeek`.
- `projectPlayers` throws on a bad `k`, duplicate log rows or invalid minutes. A coach's-decision DNP counts as 0 minutes, and other DNP rows are skipped.
- `applyPreferences` throws on a name not on the roster, a name in both IL lists, a bad lock date or slot, a player who cannot play the locked slot, a player locked twice on one date, or more locks than a slot holds. Only listed `ilCandidates` move to IL, and only when their status is O, INJ or NA and an IL or IL+ slot is free. Otherwise the player stays and a note says why.
- `replayLineups` returns `unscored` when lineups or the decision window's box scores are incomplete. A missing log row is not a DNP.
- `estimateVolume` returns `unknown` when the search passes 2,000,000 nodes or the answer is ambiguous.
- `validateEntry` enforces the decision ID format, real dates, `hold` with no add or drop, a known `source`, and a `TONY_TAGS` tag for `tony` entries.
- A change that alters recommendations or scores bumps `MODEL_VERSION` (see [`AGENTS.md`](../../AGENTS.md)).

## Side Effects

- None. No file, network, clock or random-number access.

## Verification

- Run: `npm test`
