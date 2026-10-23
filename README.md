# bball-league-assistant

An in-season assistant for one Yahoo H2H 9-category fantasy basketball league. It suggests add/drop moves for the current week, with the numbers behind each one. It never makes a move. You make every move by hand in Yahoo.

League data comes from Yahoo pages read in a browser you're already signed in to, not from the Yahoo API. An LLM agent fetches the pages, and plain Node code computes every number.

The first version has to beat a simple baseline: roster screenshots posted into a chatbot with a fixed prompt. Matchup odds, a web app and FAAB bids come only after that test passes.

## Status

Phase 0 of [`PLAN.md`](PLAN.md): v0 advice, not yet tested against the chatbot baseline. The
league read, schedule, player ID map and legal daily lineups work. Advice gives one move,
hold or insufficient evidence, and saves an immutable decision record. Current-season minutes
update projections, while rates per minute still come from last season. Scores are approximate
category estimates, not win probabilities. Descriptive player evidence and observed transaction
history are also available. Steps 5a–5c are implemented; the scored pilot has not started.

Tony rejected the first reviewed move because prior-season rates overruled strong current-season
production. Before the pilot, resolve that rate-model decision and review real hold and
insufficient-evidence examples. Task specs are in [`tasks/`](tasks/).

Rules for coding agents: [`AGENTS.md`](AGENTS.md).

Trade research requested by Tony may also read other teams' rosters and the draft and draft-results
pages. See [`docs/update-league.md`](docs/update-league.md#trade-research-pages-only-when-tony-asks)
for the capture workflow. These pages are separate from a routine refresh; all Yahoo access stays
read only.

## Setup

Requires Node 20 or later.

```
cp .env.example .env        # add your league and team IDs
npm test
```

## Get advice

1. In Claude Code, say "update league". The `yahoo-reader` agent saves the Yahoo pages to
   `local/raw/`, as described in [`docs/update-league.md`](docs/update-league.md).
2. Build the snapshot from the newest folder in `local/raw/`:

   ```
   node scripts/build-snapshot.mjs
   ```

3. Refresh current-season game logs for that exact snapshot (replace the example path):

   ```
   npm run fetch:gamelogs -- --season 2026-27 --snapshot local/snapshots/YYYY-MM-DD-HHmm.json
   ```

   This checks scoreboards, reuses cached final box scores and rebuilds daily files with DNP
   reasons and starter flags. Advice requires checked coverage through the snapshot date,
   including off-days. An older file or missing day is never accepted as zero production.

4. Get the advice for that snapshot:

   ```
   npm run advise -- local/snapshots/YYYY-MM-DD-HHmm.json
   ```

The advice is also saved as JSON in `local/advice/`. Every successful run also writes a new,
immutable `local/decisions/<decisionId>.json` and prints its ID. The record keeps effective
options, baseline and proposed daily starts, the snapshot path and hash, projection version,
input hashes and code commit. A dirty checkout is explicitly marked; its commit alone does
not reproduce uncommitted code. Repeated runs never overwrite a decision record.

Every tool, chatbot and do-nothing bakeoff entry must include the same `decisionId` for the
comparison, with `week` and `asOf` matching that record. `npm run bakeoff -- record <entries.json>`
checks that each referenced record exists before appending the batch. Old rehearsal entries
without an ID cannot be scored as recorded decisions; do not invent a link retrospectively.

Minutes blend this season's eligible games with two prior pseudo-games. `--minutes-k` changes
that starting weight; it is not calibrated. Rates per minute remain from the prior season.
Reports show observed games/starts, prior/season/projected MPG and four fixed pickup/drop
minutes cases. A move must clear the threshold in every case, including missing-production
cases. Fixed prior-MPG scenarios do not converge as more games arrive, so uncertainty may
continue to withhold a move. This is a minutes update, not a current-season rate model.

## Current-season player evidence

After the browser refresh, snapshot build and ESPN game-log refresh, run:

```
npm run evidence -- local/snapshots/YYYY-MM-DD-HHmm.json
```

This saves readable Markdown and JSON in ignored `local/evidence/`: your roster, opponent
data in JSON, and the first 100 available players captured from Yahoo. Yahoo supplies league
membership, status, waiver dates and transactions. ESPN supplies actual production, minutes,
starts, shot attempts, shooting efficiency and estimated usage, for the season and last seven
days. Last-game lines and per-36 rates are also retained in JSON. Unmatched players and missing
inputs remain unknown. List order follows Yahoo and is not a new recommendation ranking.

Estimated USG% uses the documented box-score formula with recorded team/player minutes and
possession-exposure weighting across games. It is not official NBA on-court USG%, and it does
not change the recommendation score. The source and method are included in each report.

The command backfills saved snapshots and appends unseen transaction groups to ignored
`local/transactions/history.jsonl`, deduplicating by season, team, displayed time and moves.
Repeated observations do not create duplicates, and events remain after they disappear from
Yahoo's recent list. This tracks only observed events; it cannot recover earlier unseen moves.
Tracking runs when the evidence command runs; no background schedule is installed.

## Priors from Draft Lab

Last season's per-game lines, positions, teams, minutes and playoff-week game counts come from the [Draft Lab](https://github.com/tonesjones/fantasy-basketball-mock-draft) repo, imported once into `data/priors/` with the source commit recorded in `PROVENANCE.json`. To refresh, with Draft Lab checked out next to this repo:

```
npm run import:draftlab
```
