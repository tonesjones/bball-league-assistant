# Task 09: saved-lineup scoring and fair pilot inputs

Implements Phase 0 step 5e and prepares step 5d. The pilot remains pending Tony's real outcome
reviews and an explicit freeze. Build this before recording any scored decisions.

## Done when

- [x] Each source's legal baseline/proposed/opponent starts are saved at recording time with IDs.
- [x] A chatbot move gets its own lineups, rather than the tool's chosen pair. Core protection,
      pickup status, availability, effective date and adds remaining are checked.
- [x] Replay excludes benched games, subtracts displaced starts, cancels pre-effective games,
      keeps FG/FT makes and attempts, and scores a complete hold as zero.
- [x] Missing rows, shooting volume, banked inputs or a complete scoring window mean unscored.
      Explicit DNP rows are known zero; missing historical lineups cannot be backfilled as pilot.
- [x] Category flips use saved-lineup counterfactual totals, not actual later Yahoo totals that
      may include unrelated moves or different starts. Overlapping decisions are labeled.
- [x] Summaries count invalid/unscored decisions and exclude unscored rows from category means.
- [x] Duplicate decision/source entries fail before append; records retain their recording time.
- [x] A private, uniquely named rehearsal packet shares Yahoo snapshot, ESPN evidence, saved
      projections, schedule, IDs and roles without exposing tool recommendations. Input hashes
      are verified; the candidate prompt and model identity are recorded.
- [x] Synthetic replay and record/packet integration tests pass with the full suite.
- [x] Tony accepts the historical insufficient-evidence outcome (October 23).
- [ ] Tony reviews acceptable real move and hold examples, confirms settings/prompt and starts
      the pilot. The insufficient-evidence review alone does not complete this gate.

## Limits

This evaluates fixed saved starts and a fixed captured roster over the remaining week. It is
not an adaptive weekly plan, a trade model, or proof that the tool beats a chatbot. A missing
row can be a player omitted from a real box score; it stays unscored rather than assumed DNP.
No daily watch or automatic Yahoo action is added. Fresh captures still require signed-in
read-only access. The preparation command never launches a chatbot or starts a pilot.
