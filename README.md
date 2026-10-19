# bball-league-assistant

An in-season assistant for one Yahoo H2H 9-category fantasy basketball league. It scores every move by how much it raises the chance of winning this week and the title, plans the week within the 4-add limit, prices FAAB bids against rivals, and sends one clear recommendation when news breaks. It only recommends: every move is made by hand in Yahoo.

Plain Node scripts on a schedule do all the work. Nothing calls an LLM at runtime.

## Status

Scaffold only. Build order is in [`tasks/`](tasks/):

1. [NBA data and projections](tasks/01-nba-data-and-projections.md), no Yahoo needed
2. [Yahoo league state](tasks/02-yahoo-league-state.md), with a paste fallback if the API stays blocked
3. [Matchup odds](tasks/03-matchup-odds.md)

Later: week planner and FAAB bids, opponent and trade models, phone alerts.

Rules for coding agents: [`AGENTS.md`](AGENTS.md).

## Setup

Requires Node 20 or later.

```
cp .env.example .env        # add the Yahoo app's client ID and secret
npm test
```

## Priors from Draft Lab

Last season's per-game lines, positions, teams, minutes and playoff-week game counts come from the [Draft Lab](https://github.com/tonesjones/fantasy-basketball-mock-draft) repo, imported once into `data/priors/` with the source commit recorded in `PROVENANCE.json`. To refresh, with Draft Lab checked out next to this repo:

```
npm run import:draftlab
```
