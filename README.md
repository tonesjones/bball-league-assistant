# bball-league-assistant

An in-season assistant for one Yahoo H2H 9-category fantasy basketball league. It suggests add/drop moves for the current week, with the numbers behind each one. It never makes a move. You make every move by hand in Yahoo.

League data comes from Yahoo pages read in a browser you're already signed in to, not from the Yahoo API. An LLM agent fetches the pages, and plain Node code computes every number.

The first version has to beat a simple baseline: roster screenshots posted into a chatbot with a fixed prompt. Matchup odds, a web app and FAAB bids come only after that test passes.

## Status

Phase 0 of [`PLAN.md`](PLAN.md): v0 advice, not yet tested against the chatbot baseline. The
league read, the 2026-27 schedule, the player ID map and v0 add/drop advice work. The advice
numbers are approximate category estimates from last season's per-game lines, not win
probabilities. The work in progress makes the advice a single "best next move, or hold" report
built on legal daily lineups (step 4 in `PLAN.md`). Task specs are in [`tasks/`](tasks/).

Rules for coding agents: [`AGENTS.md`](AGENTS.md).

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

3. Get the advice for the newest snapshot in `local/snapshots/`:

   ```
   npm run advise
   ```

The advice is also saved as JSON in `local/advice/`.

## Priors from Draft Lab

Last season's per-game lines, positions, teams, minutes and playoff-week game counts come from the [Draft Lab](https://github.com/tonesjones/fantasy-basketball-mock-draft) repo, imported once into `data/priors/` with the source commit recorded in `PROVENANCE.json`. To refresh, with Draft Lab checked out next to this repo:

```
npm run import:draftlab
```
