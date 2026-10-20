# Task 05: v0 advice and the chatbot bakeoff

Phase 0. Needs Task 02 (league read) and Task 01 steps 2 and 3 (schedule, ID map).

## Goal

Rough add/drop advice for the current week, good enough to test the project's core bet: that
code-computed advice beats posting roster screenshots into a chatbot. See [`PLAN.md`](../PLAN.md).

## Inputs

- League snapshot from Task 02: Tony's roster, the opponent's roster, free agents, adds used this
  week, banked category totals, settings.
- `data/schedule-2026-27.json` and `data/ids.json` from Task 01.
- `data/priors/players.json`: last season's per-game lines. A player with no prior gets no score
  and is listed as unscored, never ranked silently.
- `config/protected.json`.

## Steps

1. **Games left.** In `src/engine/games-left.mjs`, pure: for each player, games remaining from
   tomorrow to the end of the current Yahoo week, from his current team in the snapshot (not the
   prior's team, which may be stale).
2. **Category needs.** In `src/engine/needs.mjs`, pure: for each of the 9 categories, how far Tony
   is ahead or behind this week, from banked totals plus a simple projection of both rosters'
   remaining games. Turn that into a weight per category: close categories weigh most, categories
   already won or lost by a wide margin weigh least. FG% and FT% are handled as makes and
   attempts. Fewer TO wins TO.
3. **Value of a swap.** In `src/engine/v0-advice.mjs`, pure: for each pair (free agent in, rostered
   player out), the change in Tony's projected week totals per category, and a weighted score from
   the needs. Rank pairs; keep at most one suggestion per add Tony has left this week.
4. **Guardrails** from `AGENTS.md`: never drop a protected player, never add a player who is out or
   has no return timeline, never suggest a drop without a pickup that scores better.
5. **Output.** `scripts/advise.mjs` prints the top suggestions. Each one: pickup, drop, games left
   for each, per-category change, score, and the snapshot's as-of time.
6. **Bakeoff log.** `scripts/bakeoff.mjs`:
    - `record`: saves the tool's suggestions and the chatbot's to `local/bakeoff.jsonl`, with the
      chatbot name, the date and Tony's 1 to 5 usefulness rating for each.
    - `score`: once the week ends, uses box scores (Task 01) to compute each suggested move's
      realized category gain (what the pickup produced minus what the drop produced over the same
      games) and whether it flipped a category. Prints tool vs chatbot.
7. **Fixed chatbot prompt** in `docs/bakeoff-prompt.md`: what to screenshot (roster, matchup,
   free agents) and the exact prompt text. The same prompt every time.

## Design for steps 2 and 3 (draft, 2026-10-19)

Goal: score each (pickup, drop) pair by how many more categories Tony expects to win this week.
One number, in "categories", that a person can read: +0.4 means the swap is worth about 0.4 of a
category won this week.

### 1. Project each team's week (pure, `src/engine/needs.mjs`)

For each team (Tony's and the opponent's), per category:

- **Banked:** `matchup.totals` and `matchup.volume` from the snapshot. Null (no games yet) counts as 0.
- **Remaining:** for each day from `fromDate` (default tomorrow) to the end of the Yahoo week:
  - Eligible players: those with a game that day (schedule, by their snapshot team), not in an IL
    slot, and not status `O`, `INJ` or `SUSP`. Players with no prior are unscored and contribute
    nothing; list them.
  - Started players: if more eligible players than active slots (roster positions minus BN and IL
    slots), keep the top N by prior minutes per game. v0 ignores positional eligibility; Task 03's
    lineup model replaces this.
  - Add each started player's per-game prior line: counting stats, plus FGM, FGA, FTM and FTA.
  - If `settings.maxGamesPerWeek` is set, stop adding games once the team reaches it.
- **Final projection** = banked + remaining. FG% and FT% are total makes over total attempts.

### 2. Turn margins into win chances

Per category, margin `m` = Tony minus opponent, with TO flipped (opponent minus Tony), and FG%/FT% as
the difference in percentages.

The spread `s` comes from the remaining games only (banked numbers are fixed):

- Counting stats: variance per player-game = `phi[c] × mean per game`, summed over both teams'
  remaining started games. Starting values for `phi`: PTS 4, REB 1.5, AST 1.5, 3PM 1.5, STL 1.2,
  BLK 1.5, TO 1.2. Make `phi` a parameter. Task 01 step 5 replaces it with dispersion fitted from
  2025-26 game logs.
- FG% and FT%: each side's variance of the final percentage = remaining attempts × p(1 − p) / (total
  attempts)², where p is that side's projected percentage. Then `s` = the square root of the sum
  over both sides.

P(Tony wins c) = Φ(m / s), where Φ is the normal cumulative distribution function. When `s` = 0 (no
games left), the probability is 1, 0 or 0.5 by the sign of `m`.

Expected categories won = the sum over the 9 categories of P(win).

### 3. Value of a swap (`src/engine/v0-advice.mjs`)

For a pair (pickup in, drop out), recompute Tony's remaining projection with the pickup's games and
line in place of the drop's (same starting rule, same games cap), then:

**score = expected categories won after the swap − expected categories won before.**

Compute the difference directly, not with a linear weight times a change, so a big swap in a
close category isn't overcounted.

Per-category needs, for display only: P(win) per category, and a label. "Close" means P(win) is
between 0.25 and 0.75. "Safe" means above 0.9, and "lost" means below 0.1. This is the "close
categories weigh most" rule from the task spec: a category at 0.5 moves most per added stat, and one
at 0.98 barely moves.

### 4. Scoring type

- **H2H each category:** expected categories won is the right target.
- **H2H most categories:** v0 uses the same score. Task 03's simulator scores P(win matchup)
  directly; until then, note this approximation in the output.

### 5. Tests (synthetic snapshot)

- Two identical teams give P(win) of 0.5 in every category, and a pickup equal to the drop scores 0.
- A 40-point banked lead in REB with one game left gives P(win REB) above 0.99, and a REB-only
  pickup scores near 0.
- TO: more projected turnovers lower P(win TO).
- FG%: a pickup with high volume and a low percentage lowers FG%, even with more makes.
- No games left: every P(win) is 0, 0.5 or 1, and every swap scores 0.
- The games cap stops counting games once the team reaches it.

### Decisions (Tony, 2026-10-19)

1. Remaining games count from the day after the snapshot (Los Angeles date).
2. A pickup plays for Tony from the day Yahoo processes it: the later of tomorrow, the player's
   waiver clear date, and `--adds-from`. The dropped player keeps his games before that day. Before
   the season, Yahoo holds every add until Oct 21.
3. The week's dates come from the matchup page's day columns (`matchup.start`, `matchup.end`).
   Counting back from the playoff weeks doesn't work: Yahoo has longer weeks, so week 1 isn't
   simply 7 days.

## Done when

- [x] Unit tests on a synthetic snapshot in `tests/fixtures/` cover: games left across a week
      boundary, a player who changed teams, FG%/FT% computed from makes and attempts, TO counted
      as fewer-is-better, and each guardrail.
- [x] `scripts/advise.mjs` runs on a real snapshot and every suggestion shows its numbers.
- [ ] `docs/bakeoff-prompt.md` exists and has been used at least once.
- [ ] `scripts/bakeoff.mjs score` runs on a synthetic log in `tests/fixtures/`.
- [ ] Two full weeks of bakeoff logged, with the result and the gate decision written into
      `PLAN.md` under Status.

## Notes from steps 1 to 5 (2026-10-19)

Codex (Sol) wrote steps 1 to 5 from the design above. First run on the pre-season snapshot:

- **v0 only sees this week.** It will drop one of Tony's core starters for a
  pickup who adds a few rebounds over 6 days. Nothing yet weighs the rest of the season. Before
  Tony acts on a suggestion, add a guardrail: only drop a player whose rest-of-season value from
  the priors is below the pickup's, or within a margin Tony sets. Δ P(title) comes later.
- Players with no prior (missed last season) don't count toward Tony's projection, so it runs
  low. They're listed as unscored.
