# Chatbot comparison protocol (versioned)

Prompt version: 1

The pilot is continuous and has no freeze (PLAN step 5d, Task 11). Every refresh after PR #32
merges gets a decision record and three entries: tool, chatbot and do-nothing. Results are
grouped by the tool's `MODEL_VERSION` and this prompt's version. Changing the prompt text, the
chatbot model or its effort bumps the prompt version above. Decisions recorded before Task 11a
have no model version and count only as rehearsals. No retrospective start dates.

## Shared evidence

Run `npm run pilot:prepare -- <decisionId>` for a new saved decision. It creates a unique private
packet under `local/pilot-packets/`, with input hashes and the exact prompt. Complete game logs, saved banked production and effective options are included. Both arms use the
same snapshot, schedule, player IDs, protected roles, saved projection inputs and ESPN evidence.
The packet verifies the saved snapshot, schedule, ID map and game-log hashes before writing.
If they changed, prepare a new decision; do not silently substitute later inputs.

The packet includes ESPN current-season minutes, starts, production, shooting and estimated
usage, not just Yahoo screenshots. Usage is descriptive; the tool does not add a usage bonus.
Projections include the prior lines and current-season sample. Do not give the chatbot the
recommendation, rankings, sensitivity scores or other chats' conclusions.

Run a fresh isolated ChatGPT/Codex session outside this repository using `gpt-6.1-sol`, no memory,
custom instructions, browsing or other input files. Copy only the packet to that directory.
Record the prompt version and the observed model/effort from the session receipt with each
chatbot entry. A different model or effort is a new prompt version. The preparation command
does not launch a model.

## Fixed prompt candidate

<!-- PROMPT START -->
You are advising on ONE add/drop decision in a head-to-head nine-category fantasy basketball league. Categories are PTS, REB, AST, STL, BLK, 3PM, FG%, FT% and TO (fewer turnovers wins).

Use only the supplied files: snapshot.json contains Yahoo league settings, rosters, availability, banked totals, weekly adds used and capture time; schedule.json contains NBA game dates; ids.json maps player identities; roles.json lists core players who cannot be dropped and stream players; projections.json contains prior production, current-season minutes and the projection inputs; evidence.json contains ESPN current-season production, shooting, starts and estimated usage with sample sizes; gamelogs.json provides the underlying box scores; banked.json retains the checked banked production; options.json sets the effective dates and comparison settings. Missing evidence is unknown, never zero. Estimated usage is descriptive, not official NBA on-court usage. Do not browse or introduce player statistics or availability from memory.

Recommend ONE best legal add/drop for the rest of this Yahoo week, or HOLD if the evidence does not support one. Respect core protection, available adds, eligible roster slots, injury/status restrictions and waiver processing dates. Adds start no earlier than the next Los Angeles calendar day after the snapshot or their waiver clear date, whichever is later; also respect the later effective dates in options.json. Account for bench congestion and displaced starters. Explain expected categories helped and hurt; treat opening samples cautiously.

Reply in exactly one format:
ADD: <player> | DROP: <player> | START: <YYYY-MM-DD> | HELPS: <cats> | HURTS: <cats> | WHY: <one sentence>
HOLD | WHY: <one sentence>
<!-- PROMPT END -->

## Record before results

For each decision record one entry each for `tool`, `chatbot`, and `none` (no move). All three
must name the SAME `decisionId`, `week` and `asOf` from the saved decision. Set `date` to the
comparison date. A move includes `start`, and `add`/`drop` objects with `name` and `espnId`.
A hold has `decision: "hold"`, `add: null`, `drop: null`. An insufficient-evidence tool outcome
is logged as hold; its original `toolAction` is retained automatically. Set `chatbot` to the
observed model for the chatbot source and null for the other sources. Set Tony's `rating`
(1–5), or null when not yet reviewed. Record a rejection reason (`wrong-role`, `core-player`,
`bad-data`, `injury`, `timing`, `other`) and explanation before the outcome is known.

Keep the raw chatbot reply in `note`. An unavailable/illegal/malformed chatbot answer is an
invalid hold: include `invalidReason` and the raw reply. Do not drop invalid decisions from the
comparison. Record known action disposition in `taken`; it does not change replay scoring.
Later action notes belong in a separate private log; never rewrite the original prediction
or retrospectively change a rating. Pending ratings remain pending, not a pilot pass.

Save the three entries as a JSON array and run `npm run bakeoff -- record <entries.json>`.
This appends source-specific saved legal lineups, rather than applying the tool's proposal to
the chatbot's move. Do not record the same arm twice for one decision.

## Score

After the full Yahoo week ends, refresh complete ESPN logs, then run
`npm run bakeoff -- score --week N --from YYYY-MM-DD --to YYYY-MM-DD` (week bounds).
Scoring replays each arm's saved baseline/proposed starts plus the saved opponent starts and
banked makes/attempts. Benched games add nothing; displaced starters are subtracted; production
before the effective date cancels. Missing rows or shooting volume mean unscored, never zero.
Only explicit DNP rows count as known zero. Missing historical lineups cannot be reconstructed
into scored entries. Actual later Yahoo totals cannot establish the hypothetical no-move
baseline, so category changes use the saved-lineup counterfactual instead.

Report each decision separately. Source summaries count invalid and unscored decisions and
average each category only over scored entries. Helped/hurt totals across overlapping hypothetical
moves are decision-level evidence, not a feasible weekly plan. Fewer than 10 scored decisions
for a version is "too few"; inconclusive is a valid result.

## Versions

Each decision record stores the tool's `MODEL_VERSION` beside its commit. A pull request that
changes recommendations or scores (projections, advice rules, lineups, replay scoring) bumps
`MODEL_VERSION`. A parser repair that only lets a refresh succeed doesn't. Nothing restarts:
the scorecard keeps each version's decisions apart, so an older version's results never mix
with a newer one's. No watch or scheduled automation is added.
