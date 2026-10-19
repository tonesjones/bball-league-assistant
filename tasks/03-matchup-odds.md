# Task 03: Matchup odds

Needs Tasks 01 and 02.

## Goal

For this week's matchup, the probability of winning each of the 9 categories and the matchup, updated as games finish, shown on a static report page.

## Steps

1. **Lineup model** in `src/engine/lineup.mjs`, pure. For each remaining day of the week, choose each team's starters from players with a game that day, respecting position slots from league settings and injury status. Assign by projected value with an exact matching (the slot count is small). Respect the games-played cap if the league has one.
2. **Simulator** in `src/engine/simulate.mjs`, pure. Inputs: both rosters, projections, schedule, banked totals so far this week, settings, a seed. For each of N runs (default 10,000):
    - Draw each started player's game line per remaining game from his projected mean and spread. Counting stats cannot go below zero. Draw makes and attempts for FG and FT, not percentages.
    - Add to banked totals and compute each category; fewer turnovers wins TO.
    - Score the matchup by the league's scoring type from settings (each-category record or most-categories win). Count ties as Yahoo does.
3. **Outputs.** Per category: P(win), P(tie), expected margin. For the matchup: P(win) and the expected category score (for example 5.4 to 3.6). Seeded, so the same inputs give the same numbers.
4. **Report.** `scripts/report.mjs` writes `local/report/index.html`: a table of the 9 categories with your projection, your opponent's, the margin and P(win), colored by P(win); the matchup P(win) at the top; the data's as-of time. Plain HTML and CSS, no framework, readable on a phone.
5. **Calibration log.** Each Sunday night, append the week's predicted per-category P(win) to `local/calibration.jsonl`. After the week ends, add the outcomes. `scripts/calibration.mjs` prints the Brier score per category and overall.

## Done when

- [ ] Two identical teams give P(win) between 0.47 and 0.53 per category.
- [ ] A team with every projection 30% higher wins each counting category with P > 0.95; FG% and FT% stay near 0.5 when attempts and percentages are equal.
- [ ] With the week's games all played, P(win) is exactly 0 or 1 per category and matches the banked totals.
- [ ] The same seed gives identical output; a different seed changes P(win) by less than 0.02 at N = 10,000.
- [ ] 10,000 runs for one matchup finish in under 5 seconds on a laptop.
- [ ] The report renders at 375 px wide without horizontal scrolling.
- [ ] The Brier score script runs on a synthetic calibration log in `tests/fixtures/`.
