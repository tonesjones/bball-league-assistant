# Task 22: Refresh verification skill

Requested 2026-10-29 after a stale-capture rehearsal stopped before brief and review verification.

## Scope
Add a project-local Codex verification skill, a dependency-free helper and four feature guides.
Do not change recommendation behavior, freshness guards, the normal refresh command or Yahoo access.
Keep tests of real user data separate from synthetic review HTTP proof.

## Done when
- [x] Doctor reports missing inputs and stale captures before processing, without revealing secret values.
- [x] Smoke launches the production review server with isolated synthetic files, checks health/version,
  exact brief/decision state, incomplete ratings refusal, copy-event persistence and reload.
- [x] Smoke stops only its server, removes scratch files and retains HTTP/action/file proof.
- [x] Feature map covers capture, analysis, brief and review, including browser and clipboard proof gaps.
- [x] Generated instructions executed once successfully; evidence retained in ignored local/verification/.
- [x] npm test passes (235/235).
- [x] Change prepared for review; code-bearing skill requires Tony's approval to merge.

## Verification notes
The helper smoke is a production HTTP integration check, not full browser or capture proof.
The latest main-checkout capture was stale and Doctor reported that correctly.
No live Yahoo reads, ESPN requests, actual clipboard changes, real ratings or vault writes occur in smoke.
No MODEL_VERSION bump: scores and recommendation rules are unchanged.
