# Limitations register

Record a limitation when it affects a real decision or workflow. Keep resolved entries and
link the fix. Public entries use synthetic descriptions; names, league details, captures,
decision IDs and rejection notes belong in ignored `local/` records.

## Open limitations (2026-10-23)

| ID | Limitation and observed consequence | Current handling / next decision |
|---|---|---|
| L01 | Opening-week samples are too small to establish a stable role or rate. One strong game can be a breakout or noise; a low-minute game can reflect injury, foul trouble or ejection. | Show games, starts and minutes. Inspect context before interpreting a change; no universal sample threshold is calibrated. |
| L02 | Last season's per-minute averages can misrepresent current production, usage, development and team context. A reviewed recommendation discarded a strong current-season center because only his minutes updated. | Model 6 uses blended current production in nominal projections. Conservative prior/blended sensitivity cases remain and can withhold moves. See Task 15 and the calibration report; future injury-created roles remain outside the model. |
| L03 | Minutes and rates use two prior pseudo-games. Fixed prior/season scenarios can withhold a move even after a consistent new role. | Task 16 retained k=2 because the tuning winner did not beat it on held-out historical weeks. This is not proof of opening-week optimality. More games do not retire the prior scenario. |
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
| L14 | Historical athlete game logs provide appearances without reliable absent-game/DNP classifications. Conditional production validation can look better than a full next-week forecast that must predict availability, new roles and actual starts. | The 2026-10-25 calibration excludes absent games and unavailable histories, reports counts and uses earlier-season priors. It does not calibrate injuries, opening-week weights, win probabilities or pickup outcomes; see docs/backtest-01.md. |

## ESPN empty-response failure (2026-10-28)

ESPN can return HTTP 200 with an empty body for a historical scoreboard date while another
date returns valid JSON. This fails JSON decoding before snapshot analysis can finish; a
successful HTTP status is not proof of usable game-log evidence. The empty body persisted for
the bare `?dates=20261026` URL while `?dates=20261026&limit=100` returned all 9 finals, so the
game-log fetch now adds `&limit=100` to every scoreboard request. The source reader also retries
invalid/empty JSON with the existing exponential backoff, up to four total requests, and reports
the URL and HTTP status on exhaustion. Only successfully parsed JSON is cached. Persistent
source failure still stops the refresh; previous cached logs are not relabeled fresh. No
recommendation or brief is available until the required evidence refresh succeeds.

## Add an entry when something new appears

Resolved during the October 23 refresh: ESPN can report a reserve with `didNotPlay: false`,
`MIN: --`, a DNP reason and zero statistics. This previously stopped game-log refreshes.
The box-score parser now recognizes that combination as a DNP, excludes it from team minutes,
and retains the reason. Coach's-decision minutes are zero; injury/rest minutes remain unknown.
Missing minutes without that evidence still fail. A synthetic regression test and a completed
real refresh verified the fix.

Resolved on 2026-10-31: the 2026-10-30 box score for ESPN event 401909285 stopped the game-log
refresh with "invalid minutes". Two reserves had `MIN: -`, `didNotPlay: false`, `active: true`
and a coach's-decision reason, but a nonzero `+/-`, and one had an assist. They played under a
minute, so the zero-stat DNP rule did not match them. The parser now reads that combination as
a played row with 0 minutes, keeps its stats and counts it in team minutes. Placeholder minutes
with an injury or rest reason, with no reason, or without `active: true` still fail. A synthetic
regression test and `npm run fetch:gamelogs -- --season 2026-27 --from 2026-10-30 --to
2026-10-30` against the cached box scores (10 finals) verified the fix.

Use the next ID and record: date, evidence, affected decision, consequence, present handling,
and the next verification or resolution. Keep private evidence in the decision/rehearsal record
and link the public issue or fix here when available. A limitation is not resolved merely
because tests pass; check the behavior that exposed it.

Chatbot comparison notes must distinguish verified inputs from narrative assumptions, current
ownership from draft ownership, and subjective confidence from calibrated probabilities.
