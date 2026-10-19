# AGENTS.md

Rules for any coding agent (Codex, Claude) working in this repo. Read this before every task.

## What this is

An in-season assistant for one Yahoo Public Prize fantasy basketball league. It tells Tony which move wins the league and why. It never makes a move.

League facts:

- Yahoo Public Prize, head-to-head, 9 categories: PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, TO (fewer TO wins).
- 12 teams, 16-man roster including IL, daily lineups.
- 4 adds per week. FAAB waivers, $100 for the whole season.
- Read everything else (roster slots, IL count, games cap, playoff weeks, H2H each-category vs most-categories) from Yahoo's league settings. Never hard-code it.

## Hard rules

1. **Read only.** Request Yahoo scope `fspt-r` and nothing else (no `openid`, no `fspt-w`). No code path may submit a transaction, lineup change, claim or trade.
2. **No LLM calls at runtime.** Every number comes from code. An optional summary step may be added later; nothing may depend on it.
3. **This repo is public.** Commit no secrets, tokens, league IDs, team names, manager names or Yahoo responses. Secrets go in `.env`. Recorded Yahoo fixtures and run outputs go in `local/`. Both are git-ignored. Tests that need Yahoo data use small synthetic fixtures in `tests/fixtures/`.
4. **One Yahoo token refresh per run**, cached until expiry and shared by every call.
5. **Be polite to data sources.** Cache responses, poll on a schedule, back off on 429 and 5xx. No scraping of paywalled pages. Record each source's URL and terms in `docs/sources.md` when you add it.
6. **Don't hand-edit `data/priors/`.** Regenerate it with `npm run import:draftlab`.

## Recommender guardrails

Carried over from Draft Lab's season manager. Treat them as tests, not suggestions:

- Never suggest a drop without a named pickup who is better by the engine's own measure.
- Never suggest dropping a player Tony marks as protected (`config/protected.json`).
- Never suggest picking up a player who is out or has no return timeline.
- Every recommendation shows its numbers: Δ P(win this week), Δ P(title), and the as-of time of the data behind it.
- FAAB: never bid more than the player's dollar value or the season pacing cap; never bid on a player available as a free agent.

## How to work

- Node 20+, ES modules, no runtime dependencies unless a task says otherwise. Tests use `node:test`.
- One task from `tasks/` at a time, on its own branch off `main`, as one pull request.
- A task is done when its acceptance tests pass with `npm test` and the task file's "Done when" list is checked.
- Keep pure logic (projections, simulator, planner) in `src/engine/`, free of I/O. I/O lives in `src/sources/` and `scripts/`.
- Seed every random number generator; the same inputs must give the same output.
- If a task's spec is wrong or impossible, stop and write what you found at the end of the task file instead of guessing.

## Layout

```
data/priors/      last season's priors imported from Draft Lab (generated)
scripts/          command-line entry points
src/engine/       pure logic: projections, simulator, planner, FAAB
src/sources/      Yahoo, NBA data, news loaders
tasks/            one spec per milestone, in build order
tests/            node:test suites and synthetic fixtures
local/            git-ignored: Yahoo fixtures, run outputs, reports
```
