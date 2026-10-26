# Task 16: calibrate the prior weight

Tony requested calibration on 2026-10-25 after Task 15 made current production drive nominal
projections. This work landed with Task 15 in one pull request (MODEL_VERSION 6).

Use 2024-25 ESPN totals as priors and 2025-26 regular-season game logs as outcomes. Never use
2025-26 final averages to predict 2025-26 games. Select the player cohort using prior-season
information alone: at least 10 games and 10 MPG. Collect all qualifying players, retaining a
failure ledger and explicit unavailable-history exclusions. Cache and rate-limit ESPN requests.

Before scoring, save the candidate weights, temporal splits, objective and adoption rule to
`local/calibration/protocol.json`. Tune `k` on Monday windows from 2025-10-27 through 2025-12-22,
freeze the winner, then validate on non-overlapping windows 2026-01-05 through 2026-04-06.
Only rows strictly before the prediction date may enter a projection. Score the next seven
days conditional on observed appearances. Missing appearances are excluded, never zeros.

Report MAE separately for all nine categories; FG%/FT% come from aggregated makes/attempts.
Choose weights by equal-category error relative to the season-average baseline, using tuning
scales fixed before validation. Compare against season-average, prior-only and current k=2.
Adopt only if the tuning winner beats current k=2 on validation and beats season-average in
at least seven categories. Report weekly paired variation and low-prior-MPG sensitivity.
This is production-weight validation, not win-probability or injury/lineup calibration.

Done when:

- [x] No unhandled collection/parser failures remain; missing-history exclusions are reported.
- [x] Synthetic checks demonstrate the time cutoff, shooting-volume aggregation and missing-game behavior.
- [x] A repeat produces identical evaluation results from the cached dataset (SHA-256 checked).
- [x] A report records counts, category errors, selection, adoption decision and limitations.
- [x] No new default was adopted: tuning selected k=8 but held-out validation did not beat k=2.
      Existing model-5 k=2 defaults remain shared by the projection and advice paths.
- [x] npm test passes (198 tests).
