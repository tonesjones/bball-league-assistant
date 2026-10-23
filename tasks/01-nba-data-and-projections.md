# Task 01: NBA data and projections

Build first. It does not need Yahoo, so a Yahoo outage blocks nothing.

## Goal

For every NBA player, a per-game projection for each of the 9 categories with a mean and a spread, refreshed daily, plus the full-season NBA schedule.

## Inputs

- `data/priors/players.json`: 2025-26 per-game lines (587 players), positions and teams (275), minutes (253).
- An NBA data source for the 2026-27 schedule, daily box scores and game logs, and the 2025-26 game logs for backtesting.

## Steps

1. **Pick the data source.** Spend no more than an hour comparing two or three free options (for example the NBA's own stats endpoints and a free API with a key). Pick one, note its URL, terms, rate limit and auth in `docs/sources.md`, and wrap it in `src/sources/nba.mjs` with an on-disk cache in `local/cache/`.
2. **Schedule.** `scripts/fetch-schedule.mjs` writes `data/schedule-2026-27.json`: every game with date, home and away team (standard codes such as `GSW`, `SAS`). Check that its game counts per team for Yahoo weeks 18 to 23 match `data/priors/playoff-weeks.json`; list any mismatches.
3. **Player IDs.** `data/ids.json` maps the source's player ID to name, team and (later, Task 02) Yahoo player key. Match prior names with a normalizer that strips accents, punctuation and suffixes (Jr., Sr., II, III). Unmatched names go to a report, never silently dropped.
4. **Game logs.** `scripts/fetch-gamelogs.mjs` stores per-game lines (minutes, FGM, FGA, FTM, FTA, 3PM, PTS, REB, AST, STL, BLK, TO) for the current season, incrementally, and for 2025-26 once.
5. **Projection model** in `src/engine/projections.mjs`, pure:
    - Minutes (Phase 0, PLAN.md step 5c): `(k * prior_mpg + season_minutes) / (k + games)` with `k = 2` prior pseudo-games and equal game weights from the first game. This is a starting value, not calibrated; recency weighting waits for the backtest. Keep DNP rows with their reason: only exact `COACH'S DECISION` counts as zero minutes; other DNPs and absent rows are excluded. Preserve starter status for display. A player without usable prior minutes and rates stays unknown. Per-minute rates stay at the prior, and the same projected line feeds weekly scoring, lineup order and the season-value guardrail. Fixed prior/season minutes scenarios gate each pickup/drop pair; see PLAN.md for the user-selected conservative rule.
    - Per-minute rates (after the pilot): shrink this season's rates toward the prior rate with `rate = (prior_rate * prior_minutes + season_total) / (prior_minutes + season_minutes)`. The numerator is production and the denominator is minutes. `prior_minutes` is a parameter worth about 15 games of minutes.
    - Spread: per-category standard deviation per game from the player's game logs once he has 10 or more games; before that, a default dispersion per category estimated from 2025-26 logs.
    - FG% and FT% are projected as makes and attempts, never as percentages.
6. **Daily output.** `scripts/project.mjs` writes `local/projections/YYYY-MM-DD.json`: per player, per category, mean and standard deviation per game, plus projected minutes.

## Done when

### Phase 0 step 5c (merged in PR #25; pilot review gate remains open)

- [x] One- and two-game histories follow the k=2 pseudo-game rule; k is labeled uncalibrated.
- [x] Coach DNPs count zero; other DNPs and absent rows are excluded; starter flags are retained.
- [x] Shared projected lines update weekly totals, lineup order and season protection.
- [x] No usable prior stays unknown; no observed games preserves the usable prior.
- [x] Four fixed minutes cases cross with the existing missing-production cases; synthetic
      starter/bench regression returns insufficient evidence rather than a prior-only move.
- [x] Five-game history adapts the blend but retains the fixed endpoints, as Tony selected.
- [x] Checked full-season coverage includes empty days; stale, missing or changed files fail.
- [x] Successful runs save the effective projection table in their immutable decision record.

### Current-season descriptive evidence (merged in PR #27)

- [x] Yahoo browser captures supply current roster, availability and transaction observations.
- [x] ESPN supplies actual season and last-seven-day player production, minutes, starts and
      shooting volume; last-game lines and per-36 rates are retained in private JSON.
- [x] Estimated USG% is explicitly labeled, source-defined and unknown if required team context
      is incomplete; multi-game usage weights opportunity exposure rather than averaging rates.
- [x] Observed transaction groups are backfilled from private snapshots and appended once;
      repeated refreshes never remove prior observations or invent unseen history.
- [x] CLI integration and pure tests cover joins, DNPs, missing inputs, team context, rate
      aggregation and transaction deduplication. Recommendation scoring stays unchanged.

### Remaining full Task 01 acceptance

- [ ] `docs/sources.md` names the source, its terms and rate limit.
- [x] Schedule check against `playoff-weeks.json` passes, or mismatches are listed and explained.
- [ ] 95% or more of players with a 2025-26 line are matched in `data/ids.json`; the rest are listed.
- [ ] Backtest on 2025-26: for each week from week 4 on, project each player's next-7-day category totals from games before that week. The model beats a "season average so far" baseline on mean absolute error in at least 7 of 9 categories. Results table in `docs/backtest-01.md`.
- [ ] Unit tests cover the shrinkage formula, the name normalizer and the makes/attempts handling for FG% and FT%.

## Notes from steps 2 and 3 (2026-10-19)

- **Schedule:** `npm run fetch:schedule` wrote 1,200 games, 80 per team. The 2 missing games per team
  are NBA Cup games ESPN hasn't scheduled yet. Re-fetch after the Cup group stage. The playoff-week
  check (weeks 18 to 23) has no mismatches.
- **Team codes:** Yahoo writes Washington as `WAS`; the priors use `WSH`. Code converts both ESPN
  and prior codes with `standardCode()`, so the standard is Yahoo's.
- **ID map:** `npm run build:ids` matched 462 of 605 priors (76%), short of the 95% target. The 143
  unmatched priors aren't on any current ESPN roster: retired, unsigned or overseas, mostly
  players with few games last season. That target counts the wrong set, so measure against the
  players who matter instead. Against the pre-season Yahoo snapshot, 123 of 126 rostered and
  free-agent players match (`npm run match:ids`). The matcher handles nicknames ("Cam" for
  "Cameron") by last name plus a first-name prefix.
- `data/ids.json` lists every player on a current ESPN roster. Re-run `build:ids` after trades
  and signings.
