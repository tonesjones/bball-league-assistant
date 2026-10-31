# Task 15: current-season production drives projections

Requested by Tony on 2026-10-25: give last season less weight and focus on this season's performance.
This supersedes Task 14's model-4 freeze for this change; retain historical decisions under their
original versions. No new freeze or pilot run is implied.

Use the existing per-minute blend as the nominal projection: each category's season total plus
`k * prior per-game production`, divided by season minutes plus `k * prior MPG`, then multiplied
by projected MPG. Default `k=2` remains an uncalibrated starting value. Makes and attempts blend
separately. The same projection feeds advice, legal lineup production and season value.

Preserve DNP handling, missing-prior protections, prior fallback when current production is
incomplete, and the existing conservative prior/blended sensitivity checks. Those checks may
still withhold a move favored by the nominal projection. Injury-created future roles remain
outside this model. Bump MODEL_VERSION to 6 (Task 17b took 5) and label the report accurately.

Done when:

- [x] A regression fails with prior-only nominal production and passes with the blend.
- [x] More observed minutes move projections toward current production, including shooting volume.
- [x] Current production changes season ranking and retains stream-planner hold reservations.
- [x] npm test passes (195 tests).
- [x] A private comparison shows the effective weights and projections for the current candidates.
