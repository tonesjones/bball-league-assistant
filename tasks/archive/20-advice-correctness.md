# Advice correctness fixes (model 7)

Fix the three confirmed review findings together; docs wording, brief decision-ID routing and schedule indexing are separate work.

- Reject dropping an IL/IL+ player when no unreserved non-IL roster spot is open. Count the first matching block as `ilCapacity`.
- Once days are banked, exclude each counting category with a null Yahoo total on either side from baseline and all candidate/scenario scores. Before the matchup starts, null means zero banked production. Explicit zero remains known.
- Reject dropping a player with any lineup lock on or after the pickup effective date, including stream players. Count the first matching block as `lineupLock`. Expired locks do not block.
- Bump `MODEL_VERSION` from 6 to 7 because recommendations and scores change.

## Done when

- [x] Synthetic regression tests fail before the fix and pass after it.
- [x] IL and IL+ capacity, pending claim reservations, and an available spot are covered.
- [x] Future/same-day and expired lineup locks are covered.
- [x] Null counting totals on either team, known zeros and pre-matchup behavior are covered.
- [x] `npm test` passes.

Verification: all three new tests failed on the original model-6 code for the reported behavior; all 227 tests pass after the fixes.
