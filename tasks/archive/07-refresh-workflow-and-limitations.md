# Refresh workflow and limitations

Requested 2026-10-23: retain encountered limitations, simplify refresh processing and clarify
model ownership/token use. This maintenance task leaves the Phase 0 pilot gate unchanged.

## Done when

- [x] A public register records known limitations and explains how to add future evidence safely.
- [x] One command processes an explicit saved capture through the existing analysis steps.
- [x] Newly archived transaction details are visible before player tables, with backfill caveats.
- [x] Documentation distinguishes Haiku collection configuration, code computation and Codex review.
- [x] Regression tests and the full suite pass (147 tests).

Browser collection still requires the signed-in read-only workflow. No background refresh,
automatic model switching, projection change or measured token-saving claim is introduced.
