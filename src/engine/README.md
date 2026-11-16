# engine

## Overview

Pure logic. It holds the facts sheet builder (`buildSheet`), the lineup and per-category model it leans on (`needs.mjs`), season values, the role-change watch list, the shooting-volume estimate, and date and name helpers. Nothing here does I/O: callers pass data in and get results back.

## Interface

**Facts sheet**

- `sheet.mjs:buildSheet({folder, captureDate, captureTime, pages, ids, schedule, logs, coverage, scoreboard, warnings})`: takes the parsed pages from `sources/sheet-pages.mjs:parsePages`, the ID map, the schedule and the game logs. Returns `{markdown, status}`. The markdown has eight sections: Header, Budget and slots, Matchup by category, Open-day grid, Roster lines, Candidates, Role-change watch list and Transactions. `status` is one line per section: `ok`, `partial` or `UNAVAILABLE`.
- `sheet.mjs:SHEET_VERSION`, `OUT`, `DOUBTFUL`, `weekday`, `monthDayIso`, `indexLogs`, `lastLine`: the format version, the out and doubtful status codes, and helpers for dates and per-player game-log lines.

**Lineup and category model**

- `needs.mjs:needs`: per-category margin, spread, win probability and label (`close`, `safe`, `lost`, `lean` or `unknown`), plus `expectedCategories`.
- `needs.mjs:projectTeam`: projected totals and starts over a date range, with swaps applied by start date.
- `needs.mjs:dayLineup`, `assignLineup`, `fits`, `openRosterSpots`: lineup assignment for one day, slot eligibility (an exact position, or G, F or Util) and open non-IL roster spots. The sheet uses `assignLineup` and `openRosterSpots`.
- `needs.mjs:strongLine`: a strong per-game line from the top of the prior pool: the 90th percentile per stat (10th for TO).
- `needs.mjs:normalCdf`: standard normal CDF approximation.
- `needs.mjs` constants: `STAT` (category to stat key), `DEFAULT_PHI`, `BLOCKED` (`O`, `D`, `INJ`, `SUSP`, `NA`) and `UNKNOWN_MPG` (24).

**Values and watch list**

- `season-value.mjs:seasonValues`: `Map` of name to `{value, rank, ...}` from z-scores against the top `poolSize` players.
- `role-change.mjs:roleChanges`: players whose minutes or starting role grew on a night, sorted by one-game z.
- `role-change.mjs:roleChangeReport`: runs `roleChanges` on a snapshot after checking that every league roster is present. Returns `{status: 'ok', date, players}` or `{status: 'skipped', reason}`.
- `shooting-volume.mjs:estimateVolume`: rebuilds this week's banked FGM/FGA/FTM/FTA from game logs. Returns `{status: 'matched' | 'unknown', ...}`.

**Dates and names**

- `weeks.mjs:addDays`, `tomorrow`, `easternDate`, `isoDay`: UTC day arithmetic, the next day in `America/Los_Angeles`, the `America/New_York` date, and a Yahoo month-day as an ISO date.
- `schedule-check.mjs:gamesPerWeek`, `checkPlayoffWeeks`: games per team per week, and playoff weeks whose counts differ from the expected ones.
- `names.mjs:normalizeName`, `findPlayer`: name keys without accents or suffixes, and name lookup that returns `{player}` or `{reason: 'ambiguous' | 'not found'}`.

## Invariants

- The sheet holds numbers only: no recommendation, no value ranking and no category labels. A missing input prints `UNAVAILABLE: <file> (<reason>)` in the section that needs it, and the other sections still build.
- `buildSheet` reads the roster from `team.txt`, then `team-tree.txt`, then `matchup.txt`. On a Sunday it uses `matchup-next.txt` for the opponent, because a claim placed that night counts in next week.
- `buildSheet` does not read FAAB, adds used or pending claims from any page yet. The Budget section prints FAAB as `UNAVAILABLE`.
- No randomness. The same inputs give the same output.
- `needs` marks a category `unknown` with null values when its shooting or counting totals are unknown, and never projects it as zero. TO is inverted: fewer wins.
- `projectTeam` caps total starts at `settings.maxGamesPerWeek`.
- `estimateVolume` returns `unknown` when the search passes 2,000,000 nodes or the answer is ambiguous.
- `roleChangeReport` skips the list, with a reason, when league rosters are missing, duplicated or empty, the league size is unknown, or a rostered player has no ID-map match.

## Side Effects

- None. No file, network, clock or random-number access.

## Verification

- Run: `npm test`
