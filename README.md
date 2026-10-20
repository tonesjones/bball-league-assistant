# bball-league-assistant

An in-season assistant for one Yahoo H2H 9-category fantasy basketball league. It suggests add/drop moves for the current week, with the numbers behind each one. It never makes a move. You make every move by hand in Yahoo.

League data comes from Yahoo pages read in a browser you're already signed in to, not from the Yahoo API. An LLM agent fetches the pages, and plain Node code computes every number.

The first version has to beat a simple baseline: roster screenshots posted into a chatbot with a fixed prompt. Matchup odds, a web app and FAAB bids come only after that test passes.

## Status

Scaffold only. The plan, phases and how we'll know it works are in [`PLAN.md`](PLAN.md). Task specs
are in [`tasks/`](tasks/).

Rules for coding agents: [`AGENTS.md`](AGENTS.md).

## Setup

Requires Node 20 or later.

```
cp .env.example .env        # add your league and team IDs
npm test
```

## Priors from Draft Lab

Last season's per-game lines, positions, teams, minutes and playoff-week game counts come from the [Draft Lab](https://github.com/tonesjones/fantasy-basketball-mock-draft) repo, imported once into `data/priors/` with the source commit recorded in `PROVENANCE.json`. To refresh, with Draft Lab checked out next to this repo:

```
npm run import:draftlab
```
