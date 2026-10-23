# Task 08: check current production before recommending a drop

Pre-pilot repair, following Phase 0 step 5c. Resolve the rejected move with a conservative
sensitivity check rather than promoting a one-game sample to a calibrated rate projection.

## Behavior

Nominal projections keep prior per-minute production and the existing minutes blend. For each
pickup/drop with a usable prior and complete played box scores, also test season per-minute
production shrunk toward the prior using the minutes blend's same k pseudo-games:
`(k * prior.perGame[stat] + observedSum[stat]) / (k * prior.mpg + playedMinutes)`.
The prior contributes `k * prior.mpg` pseudo-minutes. Keep the raw rate as descriptive
`rates.observedPerMinute` and expose `rates.priorMinutes` (null without a usable prior).
Multiply the shrunk rate by each fixed minutes endpoint. Cross prior/season rate choices
for both players with the existing minutes and missing-production cases. Every case must clear
the move threshold. A conflict yields insufficient evidence when any case supports a move;
when none supports it, hold. Core/season protection and legal lineup rules remain in force.

No played games uses the prior. Incomplete played production withholds an otherwise supported
move. DNPs add no production or rate denominator; coach DNPs still affect the minutes blend.
Players without usable priors stay unknown: their sensitivity rate is null, while observed
status, games, minutes and complete raw rates remain descriptive. Usage is not an extra scoring bonus.
The rate endpoint, like the minutes endpoints, stays in the check as more games arrive;
more games update the blend rather than retire an endpoint.
This is a conservative disagreement check, not calibrated uncertainty or a full rate model.

## Done when

- [x] A failing-before test reproduces a drop that clears all minutes-only cases but conflicts
      with observed per-minute production; the repaired result is insufficient evidence.
- [x] Rates aggregate production/minutes, exclude DNPs, preserve nominal projections and expose
      incomplete evidence rather than manufacture zeros.
- [x] Saved records and reports include rates, samples and sensitivity cases under a new version.
- [x] Shrink observed rates toward the prior with the same k pseudo-games; retain raw rates
      descriptively. A modest one-game improvement allows a robust move, while extreme
      production still withholds a conflicting move.
- [x] Full suite passes (150 tests); a saved real capture produces insufficient evidence.
- [ ] Tony reviews and accepts a real example; rehearsal alone does not start the pilot.
