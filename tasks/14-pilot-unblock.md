# Task 14: unblock the scored pilot

From the 2026-10-24 scope audit, approved by Tony the same day. The continuous pilot (Task 11)
had no paired, scored decision: every entry was unscorable, the chatbot arm couldn't run, ratings
never reached the scorecard, and a tool that only holds can't pass the gate. Four PRs, in this
order. 14a to 14c don't change recommendations; 14d bumps `MODEL_VERSION` to 4. The freeze
starts with the first refresh after all four merge.

## 14a: banked makes and attempts from Yahoo

The default matchup page has no makes or attempts, and rebuilding them from game logs failed
for both teams on the 2026-10-24 21:13 refresh ("no combination matches"). The decision record
then saved FGM/FGA/FTM/FTA as null, and `replayLineups` marked every arm unscored.

The same matchup page with an explicit `week=N` shows them. `parseMatchup` already reads them
from a real capture (`local/raw/2026-10-24-2129/matchup-week1-totals.txt`: all four values
present for both teams, plus both rosters and totals). The URL guard already allows `week` on
the matchup page.

- `docs/update-league.md`: after `matchup.txt`, read the week number from it and open
  `/{L}/matchup?mid1={T}&week={W}`. Save it as `matchup-totals.txt`.
- `scripts/build-snapshot.mjs`: when `matchup-totals.txt` is present, parse it and take
  `volume` from it, only if its week and both team names match `matchup.txt`. Otherwise throw.
  When it's missing, behave as today.
- `advise` treats Yahoo's makes and attempts as `reported`. The game-log rebuild stays as the
  fallback when the page is missing.
- Parse only the shapes in the real capture. Anything else throws.

Done when:

- [ ] A synthetic fixture pair builds a snapshot with non-null `matchup.volume` for both sides.
- [ ] A week or team mismatch between the two pages throws.
- [ ] The real 2026-10-24-2129 capture builds a snapshot with all four values for both sides.
      Check it locally and print no page text.
- [ ] `npm test` passes.

## 14b: a chatbot arm that runs

The protocol pins `gpt-6.1-sol`, which the Codex CLI rejects on Tony's ChatGPT account
(`model_not_found`).

- Tony picks a model the account accepts. Record it in `docs/bakeoff-prompt.md` and bump the
  prompt version to 2.
- `scripts/prepare-pilot.mjs`: drop `status: 'rehearsal-not-frozen'`, the hard-coded
  `baselineModel` and the frozen-pilot `pending` list. The manifest names the prompt version and
  model read from `docs/bakeoff-prompt.md`. The console line says the packet is for the
  continuous pilot.

Done when:

- [ ] One real packet produces a chatbot answer that `bakeoff record` accepts with
      `promptVersion: 2`.
- [ ] A test shows the manifest carries the prompt version and has no rehearsal wording.

## 14c: ratings join and the gate tie

Tony rates after reading the advice, in `local/pilot-reviews.jsonl`. The scorecard reads only
the rating on each bakeoff entry, and `record` refuses a second entry for the same decision and
source, so a later rating can't count.

- Add `npm run bakeoff -- rate <decisionId> <tool|chatbot|none> <1-5> [--reason R] [--note N]`.
  It appends `{ recordedAt, decisionId, source, rating, rejectReason?, note? }` to
  `local/pilot-reviews.jsonl` after checking that the decision exists and that the reason is one
  of `REJECT_REASONS`.
- `scorecard` reads `local/pilot-reviews.jsonl`. For each decision and source, the last review
  with a `source` and a `rating` overrides the entry's rating. A review recorded after the
  decision's window ends is ignored and counted as late. Rows without a `source` (for example
  `strategy-review`) are skipped.
- Gate tie (Tony, 2026-10-24): the tool passes against another arm when its net is at least that
  arm's net and its mean rating is strictly higher. Today the net has to be strictly higher
  (`src/engine/bakeoff.mjs:113`), so a tool that holds (net 0) can never beat "none" (net 0).
- Tony rates "none" on every decision too.

Done when:

- [ ] A test: equal nets and a higher tool rating gives `met`; equal nets and equal ratings gives
      `not met`.
- [ ] A test: a review overrides a null entry rating, a late review is ignored, and a
      `strategy-review` row is skipped.
- [ ] `rate` rejects an unknown decision, source or reason.
- [x] `PLAN.md`'s gate paragraph states the tie rule (done with this spec).

## 14d: move rule and the add-only bar (`MODEL_VERSION` 4)

Since Task 08, the best pair has had to clear `holdBelow` (0.15) in every minutes, rate and
missing-production case. On 2026-10-23 (decision `1d9f5a61`), the best pair gained between
+0.080 and +0.382 expected categories in all 24 case values (nominal +0.267). It was withheld
only because its worst case was below 0.15. A move that can't lose in any case shouldn't be
withheld for gaining less than 0.15 in one of them.

New rule, in `advise`:

- **Move** when the pair has no missing rates, every case value is above 0, and the nominal score
  (`pair.score`) is at least the bar. Among such pairs, pick the highest nominal score.
- **Insufficient evidence** when no pair qualifies but the best pair's best case reaches the bar
  and some case is 0 or below.
- **Hold** otherwise, including when every case is positive but the nominal score is below the
  bar.
- The bar is `holdBelow` (0.15, `--hold-below`) for a move with a drop, and `addOnlyBelow`
  (0.05, `--add-only-below`) for an add-only move into an open roster spot. An unused add expires
  at the end of the week. The only advice Tony has approved was an add-only pick worth about
  +0.08 in the research model.
- The report states both bars and which one applied.

Done when:

- [ ] A test: all cases positive, worst case below 0.15 and nominal above 0.15 gives `move`.
- [ ] A test: any case at 0 or below with the best case above the bar gives `insufficient`.
- [ ] A test: an add-only pair with nominal 0.08 and all cases positive gives `move`; the same
      pair with a drop gives `hold`.
- [ ] The existing extreme-game test still withholds, as does the 10-22 rejected move, which
      reached −0.25 in a rate case.
- [ ] `MODEL_VERSION` is 4, and `npm test` passes.

## The freeze

After 14d merges, `MODEL_VERSION` 4 stays fixed from its first refresh (target 2026-10-27, the
start of week 2) until the gate is read on 2026-11-23. Only parser fixes that let a refresh
succeed may land. Anything that changes recommendations or scores waits.
