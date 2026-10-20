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

## Done when

- [ ] Unit tests on a synthetic snapshot in `tests/fixtures/` cover: games left across a week
      boundary, a player who changed teams, FG%/FT% computed from makes and attempts, TO counted
      as fewer-is-better, and each guardrail.
- [ ] `scripts/advise.mjs` runs on a real snapshot and every suggestion shows its numbers.
- [ ] `docs/bakeoff-prompt.md` exists and has been used at least once.
- [ ] `scripts/bakeoff.mjs score` runs on a synthetic log in `tests/fixtures/`.
- [ ] Two full weeks of bakeoff logged, with the result and the gate decision written into
      `PLAN.md` under Status.
