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
    - Minutes: blend the prior MPG with the last 5 and last 15 games, weighted toward recent games. Players with no prior and no games get no projection.
    - Per-minute rates: shrink this season's rates toward the prior rate, `rate = (prior_rate * k + season_total) / (k_minutes + season_minutes)` with `k` worth about 15 games of minutes. Make `k` a parameter.
    - Spread: per-category standard deviation per game from the player's game logs once he has 10 or more games; before that, a default dispersion per category estimated from 2025-26 logs.
    - FG% and FT% are projected as makes and attempts, never as percentages.
6. **Daily output.** `scripts/project.mjs` writes `local/projections/YYYY-MM-DD.json`: per player, per category, mean and standard deviation per game, plus projected minutes.

## Done when

- [ ] `docs/sources.md` names the source, its terms and rate limit.
- [ ] Schedule check against `playoff-weeks.json` passes, or mismatches are listed and explained.
- [ ] 95% or more of players with a 2025-26 line are matched in `data/ids.json`; the rest are listed.
- [ ] Backtest on 2025-26: for each week from week 4 on, project each player's next-7-day category totals from games before that week. The model beats a "season average so far" baseline on mean absolute error in at least 7 of 9 categories. Results table in `docs/backtest-01.md`.
- [ ] Unit tests cover the shrinkage formula, the name normalizer and the makes/attempts handling for FG% and FT%.
