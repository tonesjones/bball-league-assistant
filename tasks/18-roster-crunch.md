# Task 18: packed-day roster crunch

Requested by Tony on 2026-10-25. Needs Task 17. Report only: it doesn't change the advice score,
ranking or decision, so `MODEL_VERSION` stays the same.

## Problem

On a packed NBA day, more of Tony's players have games than he has active slots, or their
positions don't fit the open slots. Those games produce nothing. `projectTeam` already fits a
legal lineup each day with `assignLineup`, but only the totals reach the report. Tony can't see
who sits, how often, or what it costs.

## Behavior

- `rosterCrunch({ snapshot, schedule, lines, fromDate, endDate })` in
  `src/engine/crunch.mjs` is pure. `lines` maps each player to the per-game line the advice used.
  For each date it uses the same eligibility and `assignLineup` call as `projectTeam`, and the
  league's games cap when set.
- It returns:
  - by day: players with a game, who starts in which slot, and who sits, with the reason
    (no open slot, no eligible position, or games cap);
  - by player: games, starts, games sat, and the production lost in each category (games sat
    times the per-game line). Shooting losses show makes and attempts, not a percentage;
  - chronic sitters: players who sit 2 or more games in the window.
- An unknown line makes that player's lost production "unknown", never 0.
- `advise` adds the crunch for the current week to its JSON and a short text section. It also
  adds a crunch for the 7 days after the week ends, as context only, like `nextWeek` in Task 12.
- The Task 17 brief replaces its count-only daily table with the crunch: who sits each day and
  the chronic sitters.

## Done when

- [ ] A synthetic day with more players than slots benches the lowest-priority player, the same
  one `projectTeam` leaves out.
- [ ] A position-only conflict (a free slot the player can't fill) shows "no eligible position".
- [ ] The games cap shows "games cap" for games after it is reached.
- [ ] Lost production equals games sat times the per-game line; an unknown line shows "unknown".
- [ ] `advise` output and saved decisions are otherwise unchanged: existing advice tests pass
  without edits to expected scores.
- [ ] The brief shows who sits and the chronic sitters.
- [ ] `npm test` passes.
