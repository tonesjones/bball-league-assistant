# Limitations register

Record a limitation when it affects a real decision or workflow. Keep resolved entries and
link the fix. Public entries use synthetic descriptions; names, league details, captures,
decision IDs and rejection notes belong in ignored `local/` records.

## Open limitations (2026-10-23)

| ID | Limitation and observed consequence | Current handling / next decision |
|---|---|---|
| L01 | Opening-week samples are too small to establish a stable role or rate. One strong game can be a breakout or noise; a low-minute game can reflect injury, foul trouble or ejection. | Show games, starts and minutes. Inspect context before interpreting a change; no universal sample threshold is calibrated. |
| L02 | Last season's per-minute averages can misrepresent current production, usage, development and team context. A reviewed recommendation discarded a strong current-season center because only his minutes updated. | Task 08 adds rate sensitivity cases that withhold conflicting moves. The observed-rate endpoint is shrunk toward the prior with the minutes blend's same uncalibrated k pseudo-games and remains in the check as games arrive. Nominal projections still use prior rates. Tony accepted withholding the historical move on October 23. Real move/hold reviews and a full rate model remain pending. |
| L03 | Minutes use two uncalibrated prior pseudo-games. Fixed prior/season minutes scenarios can withhold a move even after a consistent new role. | Show the blend and scenarios; calibrate later. More games do not retire the prior scenario. |
| L04 | Missing priors, player-ID matches or game logs leave production unknown. | Withhold advice when missing-production scenarios can change the result. Fresh coverage is required; missing is never assumed zero. |
| L05 | Banked FG%/FT% volume cannot always be reconciled during live games or with incomplete logs. | Mark affected categories unknown and omit them from the score. |
| L06 | Routine capture includes your team, the current opponent and only the first 100 available players. Draft ownership can be stale. | Verify current rosters and Yahoo eligibility for requested trade research. Routine refresh does not scan every opponent's roster. |
| L07 | Transaction history includes only events seen in saved captures. Rolled-off unseen events cannot be recovered; displayed-time deduplication is not a Yahoo transaction ID. | Preserve observed groups privately. Label first observation separately from transaction time; do not claim complete league history. |
| L08 | Expected-category scores are approximate, not matchup or championship win probabilities. The engine has no trade evaluator or explicit season-long punt strategy model. | Keep these limits visible when comparing chatbot strategy with weekly add/drop scores. Matchup odds and season modeling remain later work. |
| L09 | The old bakeoff counted played games rather than saved starts; actual later Yahoo totals can also include unrelated moves/lineup choices. The scored pilot has not begun. | Task 09 replays source-specific saved starts and captured banked production. Missing evidence stays unscored; old rehearsals cannot be retrospectively scored. Fixed-lineup category changes are independent counterfactuals, not an adaptive weekly plan or proof of chatbot superiority. |
| L10 | Browser capture depends on a signed-in session and raw page text. Claude's tool restrictions do not automatically apply to other hosts. | Stop on sign-in or blocked access. Follow the same read-only rules in every host; preserve text unchanged and let parsers fail on unsupported pages. |
| L11 | A games cap, if present, lacks games already used this week. | Report the unknown; the current league has no cap. |
| L12 | Historical scratch research can read all cached log dates and overwrite its output, without recording exact input hashes. Rerunning it later can change a supposedly historical result. | Preserve original reports before rerunning. Treat missing provenance as unknown; require an as-of cutoff and input hashes before using scratch research for scored comparisons. |
| L13 | The full team-page parser expects your weekly-adds metadata, which opponent pages omit. | Shared player-row parsing can check saved research rosters; a routine snapshot parser is not yet a general all-team importer. |

## Add an entry when something new appears

Use the next ID and record: date, evidence, affected decision, consequence, present handling,
and the next verification or resolution. Keep private evidence in the decision/rehearsal record
and link the public issue or fix here when available. A limitation is not resolved merely
because tests pass; check the behavior that exposed it.

Chatbot comparison notes must distinguish verified inputs from narrative assumptions, current
ownership from draft ownership, and subjective confidence from calibrated probabilities.
