# Task 11: continuous pilot and versioned scorecard

Implements Phase 0 step 5d as a continuous pilot. Needs Tasks 05 and 09. Task 11a is built now;
Task 11b waits for about 2 weeks of logged decisions.

The pilot doesn't freeze. Every refresh gets a decision record, and the tool, chatbot and
do-nothing entries are logged against it with Tony's rating, even while he rates most advice as
bad. A fix doesn't restart anything. It bumps a version, and the scorecard keeps each version's
results apart, so improvement over time shows up as one version scoring better than the last.

## 11a: model version and per-version scorecard

### Model version

- Add `export const MODEL_VERSION = 1` to `src/engine/v0-advice.mjs`. It is an integer, bumped by
  1 in any PR that changes recommendations or scores (the rule is in `AGENTS.md`).
- `scripts/advise.mjs` writes `modelVersion: MODEL_VERSION` into each decision record's
  `provenance`, beside `commit`. `refresh:analyze` gets it through `advise`, with no change of
  its own.
- A decision record with no `modelVersion` (recorded before this task) is "unversioned". It is
  shown in the scorecard as rehearsal data and never counts toward the gate.

### Prompt version

- A chatbot entry may carry `promptVersion`, a positive integer that matches the "Prompt
  version" line in `docs/bakeoff-prompt.md`. `validateEntry` (`src/engine/bakeoff.mjs`)
  rejects a chatbot entry without one, and rejects it on a tool or `none` entry. Entries
  already in `local/bakeoff.jsonl` without it still load: they are read with
  `promptVersion: null`, and only `record` enforces the new rule.

### Scorecard

- `src/engine/bakeoff.mjs` gets a pure `scorecard(results, { lastN = 10, minScored = 10 })`.
  Each result is what `score` builds today (`entry`, `status`, `gain`, `flips`), plus the
  decision's `modelVersion` and `createdAt`.
- Group by version: the tool's `modelVersion` and the chatbot entry's `promptVersion`. Each
  group runs the existing `summarize` on its rows, so the summary fields stay the same: moves,
  holds, scored, unscored, invalid, helped, hurt, net, mean gain, mean rating and the
  `REJECT_REASONS` counts.
- Paired decisions: the gate compares only decisions where the tool, chatbot and `none` entries
  are all scored, so every arm faces the same refreshes. A decision with any arm unscored
  counts toward that version's unscored total and is left out of the comparison.
- Rolling view: for each version, the last `lastN` paired decisions by `createdAt`, with the
  same helped, hurt, net and mean rating for each source.
- Gate status for each version:
  - `too few`: fewer than `minScored` paired decisions.
  - `met`: over all of the version's paired decisions, the tool's net (helped minus hurt) is
    higher than both the chatbot's and `none`'s, and the tool's mean rating is higher than both.
    A source with no ratings fails the rating test.
  - `not met`: otherwise.
- Unversioned decisions form their own group, labeled rehearsal, with gate status `rehearsal`.
- Deterministic: groups sorted by model version, then prompt version, and rows by `createdAt`
  then `decisionId`.

### Command

- `npm run bakeoff -- scorecard --to YYYY-MM-DD [--last N]` scores every recorded entry
  through `--to`, each with game logs for its own Yahoo week (reuse `realizedGain`, `flips`
  and `loadGameLogs` as `score` does), and prints:
  1. one row per version and source with the summary fields;
  2. the rolling last-N table;
  3. one gate line per version: version, paired decisions, gate status and the three nets and
     mean ratings behind it.
- The existing `score --week` output is unchanged.
- The command prints no page text and no player names beyond what `score` already prints.

### Done when

All tests use synthetic fixtures in `tests/fixtures/bakeoff/`, with no real names.

- [x] A decision record saved by `advise` carries `provenance.modelVersion` equal to
      `MODEL_VERSION`.
- [x] `validateEntry` requires `promptVersion` on a chatbot entry and rejects it on tool and
      `none` entries. Old entries without it still load for scoring.
- [x] Two model versions with entries for the same weeks are scored in separate groups, and an
      older version's decisions never change the newer version's numbers.
- [x] Two prompt versions under one model version form separate groups.
- [x] A version with 9 paired scored decisions reports `too few`.
- [x] A constructed version with 10 paired decisions where the tool beats both arms on net and
      rating reports `met`. The same data with the chatbot's net raised to the tool's reports
      `not met`.
- [x] A decision with one arm unscored is left out of the pairing and counted as unscored.
- [x] Unversioned decisions appear only in a rehearsal group with status `rehearsal`.
- [x] The rolling view holds the last N paired decisions by `createdAt`.
- [x] The same inputs give the same output order.
- [x] `npm test` passes.

## 11b: improvement loop (later)

Starts after about 2 weeks of logged decisions. Judgment-heavy, so it runs on Opus or Codex Sol.
Written in full when it starts; the outline here sets its limits.

- `npm run review`, a weekly report computed entirely in code (`AGENTS.md` rule 2):
  - rejection reasons and unscored causes counted per version, plus the categories hurt most;
  - a parameter replay: rerun `advise()` on the saved snapshots and options from earlier decision
    records with one tunable value changed (hold threshold, minutes `k`, `protectRank`,
    `--margin`), score each variant by lineup replay against the same game logs, and show which
    value would have scored better.
- The report suggests changes and never makes them. Tony picks one; it lands as a PR that bumps
  `MODEL_VERSION`, and the scorecard shows whether the new version does better.
- No automatic tuning until there are about 30 or more scored decisions, to avoid fitting noise.

### Done when (outline, refined when 11b starts)

- [ ] The report counts rejection reasons and unscored causes per version on synthetic records.
- [ ] A replay with one changed value reproduces the saved decision when the value is unchanged.
- [ ] The report never writes to `src/`, decision records or `local/bakeoff.jsonl`.
- [ ] `npm test` passes.

## Limits

- Ten paired decisions is a small sample. `too few` and `not met` are both normal early results.
- Per-version grouping can't separate a better model from an easier week. The paired comparison
  only makes sure every arm faced the same refreshes.
- If no version clears the gate by 2026-11-23, rethink or stop (PLAN step 5d).
