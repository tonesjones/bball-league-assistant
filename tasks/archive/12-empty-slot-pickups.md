# Task 12: empty-slot pickups

Needs Tasks 05, 08 and 09. Changes recommendations, so it bumps `MODEL_VERSION` to 2.

## Problem

`advise` only scores add/drop pairs. After an IL move opens a non-IL roster spot, it has no
add-only candidate. When the season guardrail blocks every drop, it holds with "No eligible
add/drop pairs" even though a pickup needs no drop.

## Behavior

- Open spots are the league's non-IL roster slots (from `settings.rosterPositions`) minus the
  rostered players not in an IL slot. Never hard-code the count.
- With at least one open spot, each eligible pickup also gets an add-only candidate
  (`drop: null`, `dropRole: 'open-slot'`). The pickup joins the bench on its start date; the
  baseline is the unchanged roster. No player is removed and no drop production is lost.
- The drop guardrail doesn't apply to an add-only candidate. Everything else does: blocked
  status, waiver start date, adds left, legal lineup starts, minutes, rate and missing-production
  cases, and `holdBelow`. An open spot never forces a pickup that doesn't clear the threshold.
- Reports, saved decisions, `validateEntry`, `attachLineups` and replay accept a move with
  `drop: null`. `attachLineups` refuses an add-only move when the saved snapshot had no open spot.

### Next-week context (not scored)

Each reported pair also shows the pickup's games and legal starts in the 7 days after the current
matchup ends, with the move applied and today's statuses. It is context only: it never changes the
score, ranking or decision. Whether next-week value should ever change a recommendation is an
open decision in `PLAN.md`.

## Done when

- [x] An open spot after an IL move gives an add-only candidate, and a move when it clears the
  threshold.
- [x] A full non-IL roster gives no add-only candidate.
- [x] Add-only candidates hold with no legal start this week, a blocked status, a waiver clearing
  after the week, or no adds left.
- [x] `validateEntry` and `attachLineups` accept an add-only move; `attachLineups` refuses it
  for a full roster.
- [x] Replay of an add-only move counts the pickup's production as the gain.
- [x] Next-week games and starts appear for a Sunday/Monday week boundary and don't change the
  score.
- [x] `MODEL_VERSION` is 2 and `npm test` passes.
