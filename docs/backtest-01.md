# Projection-weight calibration

Prior season: 2024-25. Outcome season: 2025-26. Dataset SHA-256: `3eba9aa8d4b911acb1d724fb38a0884b7871e9a8a2db785e98572435bb9fb2b9`.

Collected 435 prior-qualified players; 52 have no usable regular-season history. Scored dataset contains 20518 appearances. Collection/parser failures: 0.

## Protocol

Cohort selected using prior information only: >=10 games and >=10 MPG. Grid: 0.25, 0.5, 1, 2, 4, 8, 15, 30 prior pseudo-games. One k controls minutes and rates together.

Tuning windows: 2025-10-27 through 2025-12-22; validation windows: 2026-01-05 through 2026-04-06. Each non-overlapping Monday window predicts the next seven calendar days using only earlier games. The tuning winner is saved before validation is evaluated. No tuning uses the validation results.

Objective: mean of nine category MAEs divided by their season-average tuning MAE. Scales are fixed on tuning data; raw units are never averaged across categories. Shooting errors use total makes divided by total attempts; zero-attempt comparisons are excluded on a common model set.

## Weight selection

| Prior pseudo-games | Tuning normalized MAE | Validation normalized MAE |
|---|---:|---:|
| season-average | 1.0000 | 0.9570 |
| prior-only | 1.0270 | 1.0780 |
| 0.25 | 0.9861 | 0.9562 |
| 0.5 | 0.9761 | 0.9555 |
| 1 | 0.9628 | 0.9547 |
| 2 | 0.9492 | 0.9536 |
| 4 | 0.9400 | 0.9529 |
| 8 | 0.9397 | 0.9538 |
| 15 | 0.9489 | 0.9585 |
| 30 | 0.9676 | 0.9714 |

Tuning winner: **k=8**. Adoption rule: Winner must beat current k=2 on validation macro relative MAE and beat season-average baseline in at least 7/9 categories. Otherwise preserve k=2.

Decision: **retain k=2; calibration did not establish a replacement**. Winner beats the season-average baseline in 7/9 validation categories.

## Held-out category errors

| Category | Unit | Observations | Season average MAE | Prior only MAE | k=2 MAE | Selected MAE |
|---|---|---:|---:|---:|---:|---:|
| PTS | per-player weekly total | 4071 | 9.4024 | 11.9661 | 9.3952 | 9.4698 |
| REB | per-player weekly total | 4071 | 3.6430 | 4.3706 | 3.6259 | 3.6436 |
| AST | per-player weekly total | 4071 | 2.6862 | 3.2499 | 2.6772 | 2.6859 |
| STL | per-player weekly total | 4071 | 1.3034 | 1.3775 | 1.2981 | 1.2924 |
| BLK | per-player weekly total | 4071 | 0.9192 | 0.9865 | 0.9188 | 0.9192 |
| 3PM | per-player weekly total | 4071 | 1.7207 | 1.9604 | 1.7154 | 1.7160 |
| TO | per-player weekly total | 4071 | 1.6619 | 1.9035 | 1.6574 | 1.6588 |
| FG% | percentage points | 4001 | 10.9104 | 10.9776 | 10.8068 | 10.7288 |
| FT% | percentage points | 3248 | 16.4869 | 16.6167 | 16.4274 | 16.3334 |

## Variation and sensitivity

Across 14 validation weeks, the selected weight beats k=2 in 5. Weekly paired normalized-error difference (selected minus k=2): median 0.0003, range -0.0048 to 0.0038. These are descriptive weekly differences, not independent-trial confidence intervals.

First four validation windows: selected 0.9504, k=2 0.9498. These are January windows, not opening-week validation.

Prior MPG below 25: selected 0.9133, k=2 0.9122.

## Limits

- Conditional on actual appearances; cannot validate injury availability, future role changes or full lineup advice.
- Game-log endpoint supplies played games, not reliable coach-DNP vs injury-DNP classification; no absent games treated as zero.
- Prior-season cohort: >=10 games and >=10 MPG; rookies and players without priors excluded. League-filter-only payloads have unavailable history and contribute no scored observations, never zeros.
- One historical season; tuning and validation share players but not prediction windows. No calibrated win probabilities.

- Later-season validation does not establish that the same weight is best for the first few games. All categories share one k; category-specific weights and recency decay were not searched.
- This calibration measures forecast error, not categories won, player pickup value or title odds. Fixed prior/blended safety gates are unchanged.

## Reproduce

`node scripts/calibrate-projections.mjs`

Historical inputs are cached under ignored local/calibration/. The protocol, selected weight, dataset and full results are saved there. No Yahoo input is part of this calibration.
