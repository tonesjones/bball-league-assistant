# AGENTS.md

Rules for any coding agent working in this repo. Read this before every task.

## What this is

An in-season assistant for one Yahoo Public Prize fantasy basketball league. It tells Tony which move wins the league and why. It never makes a move. Read [`PLAN.md`](PLAN.md) for the current status and plan.

League facts:

- Yahoo Public Prize, head-to-head, 9 categories: PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, TO (fewer TO wins).
- 12 teams, 16-man roster including IL, daily lineups.
- 4 adds per week. FAAB waivers, $100 for the whole season.
- Every add is a waiver claim. There is no instant free-agent add. A claim placed before the deadline (typically before midnight Pacific) processes a little after 1 a.m. Pacific, so the player's first game is the next day's.
- An add counts against the week it processes in. A claim placed on Sunday night processes on Monday and is the first of next week's 4, even when this week's 4 are used.
- Read everything else (roster slots, IL count, games cap, playoff weeks, H2H each-category vs most-categories) from Yahoo's league settings. Never hard-code it.

## Hard rules

1. **Read only.** No Yahoo API. League data comes from Yahoo pages read in Tony's signed-in Chrome through Claude in Chrome (see `docs/update-league.md`). Open pages by URL and read them; nothing may submit or change anything in Yahoo: no transaction, lineup change, claim or trade. Never sign in to Yahoo or enter credentials; if a sign-in page appears, stop and tell Tony. `.claude/settings.json` enforces this: browser click, type, form and script tools are denied, and a hook blocks any Yahoo URL outside the read-only list in `src/sources/yahoo-urls.mjs`. Don't weaken either without Tony's OK in the PR. See `docs/update-league.md`, "What is enforced".
2. **Code computes, Claude decides.** An agent may open Yahoo pages and save their text unchanged; it never edits league data. Claude gives the advice by following [`docs/league-playbook.md`](docs/league-playbook.md). A count or total that a decision leans on (games on open days, category totals, FG% and FT% from makes and attempts) comes from code: the facts sheet from `npm run sheet`. When the sheet can't compute it, the advice shows the raw numbers it read. Tony makes every move (decision P1 in `PLAN.md`).
3. **This repo is public.** Commit no secrets, tokens, league IDs, team names, manager names or Yahoo responses. Secrets go in `.env`. Recorded Yahoo fixtures and run outputs go in `local/`. Both are git-ignored. Tests that need Yahoo data use small synthetic fixtures in `tests/fixtures/`.
4. **Be polite to data sources.** Cache responses, poll on a schedule, back off on 429 and 5xx. No scraping of paywalled pages. Record each source's URL and terms in `docs/sources.md` when you add it.
5. **Don't hand-edit `data/priors/`.** Regenerate it with `npm run import:draftlab`.

## Advice guardrails

The Guardrails section of [`docs/league-playbook.md`](docs/league-playbook.md) is the single source for what advice may and may not say. It binds any agent that gives advice, and a change to it follows the playbook version rule below.

## How to work

- Node 20+, ES modules, no runtime dependencies unless a task says otherwise. Tests use `node:test`.
- One pull request per change, on its own branch off `main`.
- One session per working directory. A session that writes code works in its own git worktree (`git worktree add ../bball-wt-<task> -b <branch> origin/main`) and leaves the main folder on `main`. Never switch branches in a folder another session may be using. A capture edits nothing outside `local/`.
- Write each task so Sonnet or Haiku can do it.
- A task is done when `npm test` passes and the item's "Done when" in `PLAN.md` is met.
- Keep pure logic in `src/engine/`, free of I/O. I/O lives in `src/sources/` and `scripts/`.
- Seed every random number generator; the same inputs must give the same output.
- A pull request that changes a number on the facts sheet bumps `SHEET_VERSION` in `src/engine/sheet.mjs` and says so in its description. One that changes the playbook's rules bumps the playbook version line in `docs/league-playbook.md`.
- If a task's spec is wrong or impossible, stop and write what you found under "Findings" at the end of `PLAN.md` instead of guessing.
- Docs-only pull requests (only `tasks/`, `docs/`, `PLAN.md`, `README.md` or `AGENTS.md`) don't wait for Tony. After opening one, check that the PR head equals the local branch tip, squash-merge it, delete the branch locally and on GitHub, and update local `main`, without asking. A pull request that touches anything else, including `.claude/` settings, still waits for Tony's OK to merge.
- After every confirmed PR merge, clean up its branch as part of finishing the task. GitHub's automatic deletion of merged PR branches should stay enabled. Fetch with `--prune`, verify the merge is on `origin/main`, and verify each branch tip matches the merged PR head before deleting it. Squash merges may require `git branch -D` after that verification; ancestry alone does not identify a squash-merged branch. Keep branches with new commits, open PRs, or uncertain merge status. Never switch or remove another chat's worktree to free a branch; report checked-out branches as deferred. In this chat's own clean worktree, detach at `origin/main` before deleting the completed branch. Fast-forward the main checkout without disturbing local edits; if blocked, report it rather than resetting or stashing. Prune stale remote references again and report anything retained.

## Layout

```
data/priors/      last season's priors imported from Draft Lab (generated)
docs/             playbook, capture reference, sources, designs
scripts/          command-line entry points
src/engine/       pure logic: the facts sheet
src/sources/      Yahoo, NBA data, news loaders
tasks/            early specs (01, 02); tasks/archive/ holds the retired ones
tests/            node:test suites and synthetic fixtures
local/            git-ignored: Yahoo fixtures, run outputs, reports
local/sheets/     git-ignored: facts sheets written by npm run sheet
```
