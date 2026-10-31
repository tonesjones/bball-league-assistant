# bball-league-assistant

An in-season assistant for one Yahoo H2H 9-category fantasy basketball league. It suggests add/drop moves for the current week, with the numbers behind each one. It never makes a move. You make every move by hand in Yahoo.

League data comes from Yahoo pages read in a browser you're already signed in to, not from the Yahoo API. An LLM agent fetches the pages, and plain Node code computes every number.

The first version has to beat a simple baseline: roster screenshots posted into a chatbot with a fixed prompt. Matchup odds, a web app and FAAB bids come only after that test passes.

## Status

Phase 0 of [`PLAN.md`](PLAN.md): v0 advice, not yet tested against the chatbot baseline. The
league read, schedule, player ID map and legal daily lineups work. Advice gives one move,
hold or insufficient evidence, and saves an immutable decision record. Current-season minutes
and production update projections, with last season contributing two prior games of minutes. Scores are approximate
category estimates, not win probabilities. Descriptive player evidence and observed transaction
history are also available. Steps 5a–5c are implemented; the scored pilot has not started.

Tony rejected the first reviewed move because prior-season rates overruled strong current-season
production. The conservative rate disagreement check below addresses that failure; Tony
accepted the historical insufficient-evidence result. The pilot runs continuously and is
scored per model version, with no freeze. Task specs are in [`tasks/`](tasks/).

The pre-pilot rate disagreement check now tests observed season per-minute production shrunk
toward the prior with the minutes blend's same k pseudo-games, alongside prior rates for
pickup/drop at the fixed minutes endpoints. The prior contributes `k * prior.mpg` pseudo-minutes;
raw observed rates remain descriptive. A conflicting case withholds the move, and the endpoints
remain in the check as more games update the blend. Model version 6 uses the blended rates for
nominal projections, lineup production and season value; current-season weight grows with minutes.
k=2 was retained after a historical tuning/validation check found no superior replacement;
see [the calibration report](docs/backtest-01.md) for its limited scope. No games uses prior rates; incomplete observed production prevents an
otherwise supported move. Real examples still need Tony's review before the pilot starts.

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

After a browser capture, run `npm run refresh:analyze -- local/raw/YYYY-MM-DD-HHmm` to build
the snapshot, refresh logs, archive transactions, produce evidence and run advice together.
It prints a compact summary with newly observed transaction details and saves full output
privately. Browser collection is still a separate read-only step. Known evidence and model
limits are tracked in [the limitations register](docs/limitations.md).

Then run `npm run brief -- <decisionId>` using the ID from that analysis to write `local/briefs/<decisionId>.md` from the newest decision, and
paste that file into a ChatGPT chat. It holds the tool's numbers and a fixed prompt that asks for
news, role changes, trade ideas and packed days. ChatGPT's answer is context for you; nothing feeds
it back into the engine. Don't use a brief for the pilot: it shows the tool's recommendation. See
[the brief prompt](docs/chatgpt-brief.md).

Add `--state <path>` to copy your standing preferences, decisions and open questions from the
vault state note into the brief. ChatGPT ends with a carry-forward section; paste it back into
that note, where it stays unreviewed until checked. Preferences that should change advice (IL
candidates and lineup locks) go in `local/preferences.json`, which `advise` enforces:

```json
{ "ilCandidates": ["Name"], "notIlCandidates": ["Name"],
  "lineupLocks": [{ "date": "2026-10-26", "slot": "Util", "player": "Name" }] }
```

Every name must be on your roster. Only listed IL candidates with an IL-eligible status (O, INJ
or NA) and a free IL slot are assumed to move to IL.

Refresh on demand after completed game slates, when Tony requests it. No daily watch or
background monitor is needed. At each refresh, compare watched players' minutes, starts and
production with the prior capture, keeping the sample size visible. User-reported pending
trade status and the current watch are in ignored `local/trade-watch-status.json` when present.
These private files stay on this computer; another checkout needs its own local inputs.

Individual steps for debugging:

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

New bakeoff entries retain source-specific baseline/proposed/opponent starts and banked
production. Outcome scoring replays those lineups, counts benched games as nothing, subtracts
displaced starters and marks missing evidence unscored. Category changes describe independent
fixed-lineup counterfactuals; overlapping suggestions are not a weekly plan. Old rehearsals
without replay evidence cannot be made scored decisions after the fact.

Minutes blend this season's eligible games with two prior pseudo-games. `--minutes-k` changes
that starting weight; it is not calibrated. Rates per minute remain from the prior season.
Reports show observed games/starts, prior/season/projected MPG and four fixed pickup/drop
minutes cases. A move must gain in every case, including missing-production cases, and its
nominal score must reach the bar: 0.15 expected categories with a drop (`--hold-below`), 0.05
for an add-only move into an open spot (`--add-only-below`). Fixed prior-MPG scenarios do not
converge as more games arrive, so uncertainty may continue to withhold a move. This is a minutes update, not a current-season rate model.


## Priors from Draft Lab

Last season's per-game lines, positions, teams, minutes and playoff-week game counts come from the [Draft Lab](https://github.com/tonesjones/fantasy-basketball-mock-draft) repo, imported once into `data/priors/` with the source commit recorded in `PROVENANCE.json`. To refresh, with Draft Lab checked out next to this repo:

```
npm run import:draftlab
```

## Local league review screen

After `$league-refresh` creates the brief and attempts the pilot, it opens a private local
review screen. Copy the brief into your regular ChatGPT chat, read the engine and isolated
chatbot answers alongside making no move, choose 1-5 ratings, and click **Save all three ratings**.
The isolated chatbot is the pilot comparison, separate from the ChatGPT chat where you paste
the brief. The existing command-line ratings remain available as a fallback.

Reopen a saved check with `npm run review -- <decisionId>`, or use `npm run review` to open the
newest saved decision and select another. The command starts or reuses a server on 127.0.0.1,
with a private access link. No hosting, Yahoo writes, or new runtime dependencies are involved.
The screen reads this checkout's `local/` data; normally launch it from the main project.
If the server's code has changed since it started, the command replaces it. Stop it with
`npm run review -- --stop`.

Ratings are appended to `local/pilot-reviews.jsonl`, the same log the scorecard reads. Repeated
unchanged saves do not duplicate reviews; changed ratings add a new review before the matchup
ends. After that, ratings close. Incomplete pilot arms cannot be rated. Brief copies are logged
under `local/review-ui/`, without claiming a paste or a Yahoo action happened.

After the matchup ends, refresh game logs and reload the screen to replay the saved lineups
with the existing scorer. Results use cached data, never fetch in the background, and stay
unscored if evidence is missing. The screen reports helped/hurt categories per answer; the
versioned aggregate gate remains available through `npm run bakeoff -- scorecard`.
