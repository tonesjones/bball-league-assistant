# League Move Checker: a clean-sheet design

*   **Author:** tonesjones
*   **Status:** Proposed (revised after EGM review, 2026-10-31)
*   **Date:** 2026-10-31

--------------------------------------------------------------------------------

## Overview

This document designs a tool that helps Tony win one Yahoo head-to-head
9-category fantasy basketball league. It then compares that design with the
tool already built in this repo between 2026-10-18 and 2026-10-30, and sorts
each existing part into keep, cut or rewrite.

Method: the problem, goals and requirements were written first, from the
league rules and Tony's ratings of real decisions. The architecture and the
file plan were then checked against the existing code.

The document has two jobs:

1.  State what the tool must do, so the review judges the idea and not only
    the build.
2.  Answer "stay or restart". See "Detailed Implementation Plan → Mapping to
    the current build".

The current build is listed under Alternatives Considered as one way to meet
these goals. It gets no special standing.

Terms used throughout:

*   **League check**: one run of capture, snapshot, projections and the
    planner, started by Tony when a decision is pending.
*   **Core player**: a player listed under `core` in `local/roles.json`, or
    in `local/protected.json` (which counts as core). Never dropped.
*   **Stream player**: a player listed under `stream` in `local/roles.json`.
    Droppable for a weekly gain without the season-value test.
*   **Season value**: the score `seasonValues()` in
    `src/engine/season-value.mjs` gives each player: the sum of per-game
    category z-scores (FG% and FT% weighted by attempts) against the top
    150 players, scaled by games played. It is computed from the blended
    projections, not from last season alone.

## The Problem

Tony manages one team in a 12-team Yahoo Public Prize league: head-to-head
weekly matchups over 9 categories (PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, TO,
where fewer turnovers wins). Each team has 16 roster spots including IL, sets
lineups daily, and gets 4 adds per week. Waivers use a $100 season FAAB
budget.

Most of the in-season edge comes from a few repeated decisions:

*   **Which available player to add, and whom to drop,** when a roster spot
    opens, a player gets hurt, or a better player appears.
*   **Where to spend the 4 weekly adds** to get more started games on days
    when Tony's lineup has an open slot.
*   **Whether a move helps the categories still in play this week,** given
    what both teams have already banked and the games each player has left.

Tony already makes these decisions by hand, with ChatGPT for news,
injuries and role changes. The chatbot is weak at three things that decide
close weeks:

1.  **Counting.** Games left per player this week, on days with an open legal
    lineup slot, times per-game production, against the opponent's totals.
2.  **Shooting percentages.** FG% and FT% must be combined using makes and
    attempts. Averaging percentages gives the wrong answer.
3.  **Consistency.** The same question gives different answers, and the
    chatbot guesses at schedules and at who is still available.

The problem this design solves: **when a decision is pending, search the
available players and propose the one action (add today, wait for a named
later day, or hold) that most helps this week's categories without hurting
the season, with the counts behind it, without making any move.** Tony
compares that proposal with the move he would make on his own, to decide
whether the engine is worth keeping. The tool does not check moves Tony has
already chosen. News, injuries, role changes and long-term judgment stay with
Tony and ChatGPT.

### What the first build taught (hard requirements)

The first build hit these failures on real league data. Each row says how
this design handles it.

| Date | What went wrong | Requirement |
|---|---|---|
| 2026-10-19 | Scoring only this week's categories suggested dropping four of Tony's best players for waiver-level ones. | A drop is blocked unless every existing guardrail passes: core, IL capacity, lineup lock, no-prior protection, the top-120 season-value rank, and pickup season value at least the drop's. Only stream players skip the season-value and rank tests. |
| 2026-10-21 | A player with no projection counted as zero production, so dropping him looked free. | Missing production is never counted as zero alone. Starts by players with no projection are scored twice, at zero and at a strong rotation line, and a plan is ranked by the lower result. |
| 2026-10-22 | A starting center who played 30 minutes with 14 REB, 5 AST and 3 BLK was proposed as a drop, because last season's per-minute rates outweighed his one strong game. | **Relaxed by decision I1 (Tony, 2026-10-31).** The design no longer prevents this proposal. It must show, beside the proposal, what it depends on and what the action becomes if that production doesn't hold. Tony decides. |
| 2026-10-25 | A Sunday add takes effect Monday and is charged to next week's 4 adds. | The add budget and the scoring week follow the add's effective date. |
| 2026-10-25 | The live matchup page sometimes lacks makes and attempts, so FG% and FT% could not be computed. | Missing banked makes or attempts are rebuilt from game logs when the logs match Yahoo's totals. Otherwise FG% and FT% are "unknown" for every plan alike and left out of the score. |
| 2026-10-25 to 2026-10-29 | Refreshes failed because the browser was signed out, a capture agent retyped pages and added headers, and ESPN returned an empty body with HTTP 200. | League data is copied unchanged from a signed-in page. A source failure stops the league check, names the failed step and the reason in one line, and produces no advice. |
| 2026-10-26 | A pickup's "3 games" included days when Tony's lineup was already full. Tony declined it. | Only games on days with an open legal lineup slot count. |

### What the first build did not settle

On 2026-10-30, after 13 days, 97 commits and 7 model versions, the scorecard
showed **no scored decision** for any model version. On Tony's 1-to-5 scale,
his mean rating for "do nothing" was above the tool's: 5 vs 3 under model 7
with prompt version 3, and 3 vs 2 under model 7 with prompt version 2. The
usability trial log, `local/trial-log.md`, was never created. Most of that
time went to keeping the refresh working and to scoring machinery. The bet
behind the project is still untested. It may be wrong.

## Goals

Each goal has a measure. The stop rule says what happens if G4 or G5 fails.

*   **G1. One proposed action, with correct counts.** For a pending
    decision, the tool searches available players and proposes one action:
    an add today (with a drop, or into an open spot), "wait" for a named
    player on a named later day, or "hold". It reports, for this scoring
    week: the pickup's and the drop's games on days with an open legal
    slot, each category's change with FG% and FT% from makes and attempts,
    adds left, every unknown input, and the top 3 runners-up with why they
    lost.
    *Measure:* the planner tests below pass. On three real proposals, Tony
    checks the counts by hand and finds no error.
*   **G2. No guardrail is broken.** No drop that fails a rule in the
    2026-10-19 row. No pickup with a blocked status (O, D, INJ, SUSP, NA).
    No more adds than remain. One proposed action per league check.
    *Measure:* the guardrail tests in `tests/advice-correctness.test.mjs`,
    ported to the planner, pass. A checker over real saved decisions is
    deferred (`PLAN.md`, "Parked: evals", gap 1).
*   **G3. At most 5 minutes of Tony's attention per decision.** From
    "decision pending" to having the tool's answer, including asking for
    the league check.
    *Measure:* Tony records minutes with `npm run did -- ... --minutes N`.
*   **G4. Useful often enough to keep.** The tool changes a decision or
    catches a mistake often enough that Tony would keep using it.
    *Measure:* each decision's `did` entry has one tag:
    `changed-decision`, `caught-mistake`, `no-effect` or `wasted-time`.
    The weekly replay adds, for each decision where Tony and the engine
    differed, which choice gained more categories (helped minus hurt). The
    threshold is open question Q3.
*   **G5. Low upkeep.** At most one maintenance session per week, of at
    most 30 minutes, and at most one rescued league check per week.
    *Measure:* rescues are recorded with `did --rescue`. Maintenance
    sessions are counted from the git log. The 30-minute figure is a
    default Tony can change.
*   **G6. Same inputs, same answer.** Every number comes from code. The same
    saved inputs give byte-identical planner output.
    *Measure:* a test runs the planner twice on one fixture and compares
    the output.

**Stop rule.** If G4 or G5 fails at the end of the trial window, Tony stops
asking for league checks. The code stays in the repo for occasional use,
and any further work starts with a new design review.

## Non-Goals

*   **Making moves.** The tool never adds, drops, sets lineups, claims or
    trades. Tony makes every move in Yahoo.
*   **The Yahoo API.** League data comes from pages read in Tony's signed-in
    browser (see Alternative D).
*   **News, injuries and roles.** Tony and ChatGPT judge these. The tool
    reads injury status from Yahoo and does not interpret news.
*   **Other users or leagues.** One league, one user.
*   **A web app or hosting.**
*   **Win probabilities, title odds, trade scoring and FAAB bid amounts.**
    The tool never names a FAAB bid, so the `AGENTS.md` FAAB guardrails
    can't be violated. Pending waiver claims are assumed to go through, as
    `advise` does today, and the report warns when they need more adds or
    spots than Tony has.
*   **Checking moves Tony has already chosen** (decision Q1).
*   **Running on a schedule.** A league check runs when a decision is
    pending: an open roster spot, an injury, a waiver claim or a streaming
    deadline.
*   **A three-way bakeoff with a blind chatbot arm** (decision Q2).
*   **Chained stream plans beyond this week's last day.** Next week's days
    are deferred (decision D1).

## Decisions

All decisions were made by Tony on 2026-10-31.

| ID | Decision |
|---|---|
| Q1 | The tool searches and proposes. It does not check Tony's moves. |
| Q2 | Engine vs Tony through a two-way shadow log, not a three-way bakeoff. |
| D1 | The planner searches week plans and acts on step one (beam search). |
| D2 | Codex runs the Yahoo capture. Claude stays a maintained backup host (revised 2026-10-31). The allowed-URL check is a separate task. |
| I1 | Always propose, and show what the proposal depends on. |
| I2 | Keep the engine. The brief becomes a context-check prompt. |
| A4 | The 2026-10-22 requirement is relaxed by I1. |
| Q7 | Players with no prior season get a season-only projection. |
| Q4 | End the 2026-10-30 trial now; a new trial window starts when PR 4 merges. |

*   **Q1. Search, don't check.** Tony knows his own reasons for his own
    moves. He wants to compare the engine's picks with his.
*   **Q2. Two-way shadow log.** Each league check saves the engine's
    proposal. Tony records what he did with `npm run did`. After the week
    ends, code replays the engine's first step and Tony's action against
    real box scores. Tony's own decision already includes ChatGPT, so there
    is no separate chatbot run. This retires the three-way pilot and its
    gate (`PLAN.md`, the 2026-11-23 rethink date).
    *   Known weaknesses: it fails if Tony doesn't record what he did. It
        shows little if the two rarely differ. A decision with incomplete
        game logs stays unscored.
    *   Rejected: a trial log with no scored comparison, because it can't
        show the engine was right when Tony declined it. Also rejected: a
        simplified three-way bakeoff, because it keeps the extra chatbot
        run that Tony found tedious.
*   **D1. Week plan, act on step one.** The planner searches plans of up to
    the adds left across the remaining days of this scoring week, and
    proposes the first step. The next league check plans again.
    *   Known weaknesses: the search grows with candidates and days, and a
        plan built on weak projections looks precise but isn't.
    *   Rejected: one move for this week only, because it can't compare
        days. Deferred: next week's first days, until this works.
    *   Confirmed after review: the beam planner over a one-step day sweep.
*   **D2. Codex runs the Yahoo capture with its in-app browser.** Claude
    is a maintained backup host.
    *   **Revised by Tony, 2026-10-31.** Tony may cancel Codex within about
        two weeks, so Claude's capture path stays and is kept working: the
        `yahoo-reader` agent, the `.claude/settings.json` tool denials and
        the Yahoo URL hook. Codex stays the primary host for now.
    *   This conflicts with `PLAN.md` ("nothing that runs during the
        season calls Codex") and with `AGENTS.md` hard rule 1 (don't weaken
        enforcement without Tony's OK in the PR).
    *   Its implementation is a separate task: the allowed-URL check on
        saved captures. It no longer removes the Claude capture agent.
        This design's PRs don't change capture.
    *   Known weakness: two hosts must be kept in step, and their
        instructions had already diverged by 2026-10-31. Claude's browser
        pane also lost its Yahoo sign-in on 2026-10-25 and 2026-10-26.
    *   The first version rejected keeping two hosts for those reasons.
        The revision accepts that cost so capture survives losing Codex.
*   **I1. Propose, and show what it depends on.** The engine can't tell a
    breakout from minutes caused by a teammate's injury. That needs news,
    which stays with Tony and ChatGPT. So the planner always proposes from
    the blended projection and adds a "depends on" line when a cautious
    case would change the action, or when a player has no prior season.
    *   Known weaknesses: it protects only if Tony reads the line. The
        shadow log scores the proposal, not Tony's adjusted version of it.
    *   Rejected: flags without the cautious result, a cautious-case gate
        that never proposes a player with no prior, and the four-case gate
        that made most real runs say "insufficient evidence".
*   **I2. A context-check brief.** The brief sends ChatGPT the "depends on"
    questions, the runners-up and Tony's roster facts. It leaves out the
    engine's chosen action.
    *   Known weakness: it names the players the engine is unsure about,
        which steers Tony toward the engine's shortlist.
    *   Rejected: cutting the brief, because the context check then rests
        on memory. Also rejected: the full brief, because Tony and ChatGPT
        would see the proposal first.
    *   **Fallback:** if this doesn't work (trigger: Q6), switch to "code
        computes, ChatGPT decides". That would change Q1, D1, the planner
        and `AGENTS.md` hard rule 2. It needs a new design.
*   **A4. The 2026-10-22 requirement is relaxed by I1.** The case is
    proposed with a "depends on → hold" line.
    *   Rejected: a drop-only block when the cautious case changes the
        action, because it would hold some good drops and leave the shadow
        log fewer disagreements to compare.

*   **Q7. Season-only projections for players with no prior season.**
    *   After at least 5 games or 100 minutes this season, a player with no
        usable prior gets a per-game line from this season only, keyed by
        his ESPN ID.
    *   His season value scales with games played out of 70, so a player
        with few games ranks low.
    *   He can be proposed as a pickup, always with a "depends on" line.
        As a drop he stays protected by the existing no-prior rule.
    *   Known weakness: a hot first week can rank him above steadier
        players for this week's gain, and the "depends on" line is the
        only check.
    *   Rejected: never proposing such players, because it leaves breakout
        rookies to Tony and ChatGPT.

*   **Q4. End the running trial.** The usability trial in `PLAN.md`
    (2026-10-30 to 2026-11-12, "no new features") ended on 2026-10-31,
    with no entries. Building starts now. A new trial window starts when
    PR 4 (the shadow log) merges and lasts two weeks. The stop rule is
    applied at its end.
    *   Rejected: waiting until 2026-11-12, which meant 12 more days of a
        tool Tony rated below doing nothing.

## Open Questions

*   **Q3. G4 threshold.** How many `changed-decision` or `caught-mistake`
    tags out of how many decisions mean "keep"?
*   **Q6. The I2 fallback trigger.** For example: after 5 decisions, if Tony
    overrode the engine on context grounds in at least 3. Without a set
    number, the trigger depends on judgment.

Q4 and Q7 were answered by the decisions of the same names. Q5 (who runs
the capture) was answered by D2.

## Critical User Journeys (CUJs)

### CUJ 1: A roster spot opens

*   **Given**: Tony moved a player to IL, so one non-IL roster spot is empty.
    He has adds left this week.
*   **When**: Tony asks for a league check.
*   **Then**: The tool reports one action: an add with no drop, a wait for a
    named player and day, or a hold. It shows the pickup's usable starts by
    day, each category's change, adds left after the move, and the as-of
    time of the data. No drop is proposed while a spot is empty.

### CUJ 2: Streaming around a full day

*   **Given**: Tony's lineup is full on Wednesday and has open slots on
    Thursday and Saturday. He has 2 adds left.
*   **When**: Tony asks for a league check on Tuesday night.
*   **Then**: The tool proposes the add that gets the most usable starts on
    the open days, or says to wait for a named player on a named later day.
    A pickup whose games fall on full days gains nothing from those games.

### CUJ 3: Logging and comparing a decision

*   **Given**: A league check saved a decision record.
*   **When**: Tony runs `npm run did` with what he did (an add, or hold),
    a tag, and optionally his minutes and a one-word reason.
*   **Then**: After the scoring week ends, `npm run bakeoff -- replay`
    reports, for that decision, the categories helped and hurt by the
    engine's first step and by Tony's action. A decision with missing
    inputs is reported as "unscored", with the missing input named.

### CUJ 4: A league check fails

*   **Given**: The browser is signed out of Yahoo, or a data source returns
    an empty response.
*   **When**: Tony asks for a league check.
*   **Then**: The tool stops before giving any advice. It names the failed
    step and the reason in one line, and saves no decision record.

## Technical Plan (Architecture)

### What Tony's ratings say the engine must get right

From 2026-10-25 to 2026-10-31, Tony left notes on 9 of 16 rated entries.
7 of the 9 are about when to spend an add, or whether a move is needed at
all. None says the category arithmetic was wrong.

*   "doesn't even play till Friday": the pickup's games came after the days
    Tony needed.
*   "I have an extra slot open, I don't need to drop anyone": drops were
    proposed while a roster spot was empty. ChatGPT did this twice, and the
    engine missed an add into an empty spot on 2026-10-25.
*   "need to use a slot today to get two games out of an add": an add's
    value depends on the day it's made.
*   "full slate on Wednesday, I'd only add a long-term hold now": on some
    days the right answer is "hold unless the player is a keeper".

So the engine's main job is a **week schedule problem**: given the open
lineup slots on each remaining day, the adds left, and the effective-date
rule, which add (if any) should Tony make today? Category arithmetic and
the season guardrails sit inside that question.

### Data flow

```text
  Tony: "league check"
          |
          v
  [1] Capture (read-only)          [2] Public NBA data
  Yahoo pages, copied unchanged    ESPN schedule and box scores
  from a signed-in browser         (cached, retried, fail on empty)
          |                                 |
          v                                 v
  [3] Snapshot builder: parsers -> one league snapshot (JSON)
      Fails on any page it doesn't recognize; never partial.
          |
          v
  [4] Projections: blended per-game lines for rostered and
      available players; season-only lines for players with no
      prior after 5 games or 100 minutes (Q7).
          |
          v
  [5] Week planner (pure code, no I/O)
      candidates -> beam search over the remaining days ->
      score plans vs no move -> action rule -> cautious case
      -> action: add / wait / hold, with dependsOn lines
          |
          v
  [6] Report + decision record (local/decisions/, write-once)
          |
          v
  [7] Shadow log: `npm run did` -> bakeoff.jsonl (source "tony")
      -> weekly replay: engine's step 1 vs Tony's action
```

### Components

1.  **Capture.** Unchanged in this design: the existing read-only Yahoo
    capture saves each page's text unchanged, and stops at a sign-in page.
    D2's changes are in a separate task.
2.  **Public NBA data.** Unchanged. The existing ESPN reader adds
    `&limit=100`, retries empty or invalid JSON, and stops when retries run
    out (PR #70).
3.  **Snapshot builder.** Unchanged.
4.  **Projections.** The existing blend (`projectPlayers`, k = 2 prior
    pseudo-games). A player with no usable prior gets a season-only line
    after 5 games or 100 minutes (decision Q7).
5.  **Week planner.** Searches week plans and returns one action (see the
    planner spec in the Detailed Implementation Plan).
6.  **Guardrails.** All existing drop guardrails from `advise`, listed in
    the 2026-10-19 row. Pickups made earlier in the same plan count as
    stream players for later steps of that plan.
7.  **Report and decision record.** A plain-text report, at most 72
    characters per line, so it can be read on a phone. The full planner
    output and inputs are saved under `local/decisions/`, write-once.
8.  **Shadow log and replay.** `npm run did` writes Tony's action as a
    `tony` entry in the existing `local/bakeoff.jsonl`. The replay scores
    the engine's first step and Tony's action against no move, using the
    existing lineup replay.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Weak projections make confident-looking plans (D1). | The cautious case and the "depends on" lines (I1). Replay results show whether projections are the problem. If so, Alternative C is next. |
| Tony takes a proposal without reading its "depends on" line, and the 2026-10-22 failure repeats (A4). | The line is printed directly under the action. Tony accepted this risk. |
| Tony doesn't record what he did, so the shadow log is empty (Q2). | `did` is one command, and Codex can run it from Tony's chat message. |
| A waited-for player is added by another manager. | "Wait" is recorded as a hold. The league check on the named day plans again from a fresh snapshot. |
| A capture-host change weakens read-only enforcement (D2). | Kept out of this design. Its task must get Tony's OK in the PR, per `AGENTS.md` rule 1. |
| The beam search misses the best plan. | Tests compare the beam result with exhaustive search on small fixtures. |
| The build breaks mid-rebuild, during the season. | Each PR deletes a module only together with all its callers, and `npm test` must pass on every PR. |

## Alternatives Considered

The options rejected inside each decision are recorded in "Decisions". This
section covers whole-approach alternatives.

### Alternative A: Keep the current build and keep tuning it

The tool as it stood on 2026-10-30: single-move `advise` with a season
guardrail and minutes and rate scenarios, a three-way pilot, a ChatGPT
brief, a stream planner, a review UI and 7 model versions.

*   **Pros**: It runs end to end on real league data, and 239 tests pass.
    The parsers handle real Yahoo and ESPN pages, including the failures
    fixed in PRs #22, #70 and #72. The guardrails are enforced and tested.
    Decision records and a lineup replay exist.
*   **Cons**: `advise` scores one move against this week, so it can't
    compare days, and 7 of Tony's 9 rating notes are about timing. The
    pilot needs a separate chatbot run per league check and has produced
    no scored decision. The refresh prompt, `docs/codex-briefing.md`, has
    grown to 6 numbered steps with many sub-steps about shells, sandboxes
    and folders.
*   **Reason for Rejection**: Tuning can't add the comparison between days,
    and the pilot's cost is the friction Tony reported. The build is
    rejected as a whole, but most parts are reused (see the mapping).

### Alternative B: Stop building, use the chatbot only

*   **Pros**: No upkeep. It handles news and roles.
*   **Cons**: The counting problems stay. All 5 of Tony's ratings of
    ChatGPT's proposals in the pilot were 1 or 2. Twice it proposed a drop
    while a roster spot was empty.
*   **Reason for Rejection**: It's the baseline this design must beat, and
    the stop rule's fallback.

### Alternative C: A paid fantasy tool for schedules and projections

*   **Pros**: Projections maintained by someone else.
*   **Cons**: It doesn't read Tony's open days, banked totals, opponent or
    adds left. Its projections can't feed this engine without scraping a
    paid site, which `AGENTS.md` forbids.
*   **Status: Deferred.** Not weighed by Tony. Revisit if the replay shows
    proposals are poor because of projections.

### Alternative D: The Yahoo Fantasy API

*   **Pros**: Structured data, with no page parsing and no browser sign-in.
*   **Cons**: Access needs an application, an email exchange and an NDA,
    with an approval delay.
*   **Reason for Rejection**: Tony decided not to pursue it, because of that
    process (`PLAN.md`, ground rules).

## Non-Functional Requirements

*   **Security and privacy**: The repo is public. League IDs, team and
    manager names, Yahoo page text, decision records and the shadow log
    stay in git-ignored `local/` and `.env`. No credentials are ever entered.
*   **Determinism**: The planner has no I/O and no randomness. Ties break
    by the rule in the planner spec, using ESPN player IDs.
*   **Runtime**: Target: the planner finishes in under 60 seconds on
    Tony's PC with 20 candidates, 7 days and 4 adds. PR 2 records the
    measured time in its description. The automated test fails only above
    120 seconds, so a slow machine doesn't make it flaky.
*   **Rollback**: Each PR can be reverted alone, because each one leaves
    `npm test` passing.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Mapping to the current build

Stay or restart: **stay in this repo and replace the decision core.** The
capture, parsers, data sources, projections, category scoring, lineup
filling, decision records and replay already meet this design or need small
changes. A fresh repo would copy most of `src/sources/` and the scoring
modules in `src/engine/` (`needs.mjs`, `projections.mjs`,
`season-value.mjs`, `shooting-volume.mjs`, `lineup-replay.mjs`), and it
would lose their tests and history.

| Current part | Files | Verdict | PR |
|---|---|---|---|
| Yahoo parsers, snapshot validation, allowed URLs, URL hook | `src/sources/yahoo-pages/*`, `league-state.mjs`, `yahoo-urls.mjs`, `scripts/build-snapshot.mjs`, `scripts/guard-yahoo-url.mjs` | Keep | — |
| ESPN data, game logs, ID map | `src/sources/espn.mjs`, `espn-boxscore.mjs`, `espn-parse.mjs`, `gamelogs.mjs`, `id-map.mjs`, `scripts/fetch-*.mjs`, `build-ids.mjs`, `match-ids.mjs` | Keep | — |
| Priors import | `scripts/import-draftlab.mjs`, `data/priors/` | Keep | — |
| Projections and season value | `src/engine/projections.mjs`, `src/engine/season-value.mjs` | Modify: season-only lines (Q7) and a prior-only reference pool | 3 |
| Season value, scoring, lineups, shooting volume | `season-value.mjs`, `needs.mjs`, `shooting-volume.mjs`, `games-left.mjs`, `weeks.mjs`, `names.mjs`, `schedule-check.mjs` | Keep. `needs.mjs` gains multi-swap support. | 1 |
| Preferences | `src/engine/preferences.mjs` | Keep | — |
| Single-move advice | `src/engine/v0-advice.mjs` | Move shared helpers out in PR 1. Delete in PR 3. | 1, 3 |
| Advice CLI and refresh | `scripts/advise.mjs`, `scripts/analyze-refresh.mjs` | Rewrite to use the planner | 3 |
| Stream-chain planner | `src/engine/stream-chain.mjs`, `scripts/stream-plan.mjs`, `tests/fixtures/stream/` | Cut (the planner covers it) | 3 |
| Roster crunch | `src/engine/crunch.mjs` | Cut (the report's day table covers it) | 3 |
| Player evidence, transaction history | `src/engine/player-evidence.mjs`, `scripts/player-evidence.mjs`, `src/sources/transaction-history.mjs`, `espn-history.mjs` | Cut (nothing in this design reads them) | 3 |
| Projection calibration | `src/engine/projection-calibration.mjs`, `scripts/calibrate-projections.mjs` | Cut (the result is in `docs/backtest-01.md`) | 3 |
| Chatbot pilot arm | `src/engine/pilot-entries.mjs`, `scripts/prepare-pilot.mjs`, `docs/bakeoff-prompt.md` | Cut (Q2). Moved to PR 3 because it imports modules PR 3 deletes. | 3 |
| ChatGPT brief | `src/engine/brief.mjs`, `scripts/brief.mjs`, `docs/chatgpt-brief.md` | Rewrite as a context-check prompt (I2) | 3 |
| Decision records | `src/sources/decisions.mjs` | Keep | — |
| Bakeoff records and replay | `src/sources/bakeoff-records.mjs`, `src/engine/bakeoff.mjs`, `scripts/bakeoff.mjs`, `src/engine/lineup-replay.mjs` | Modify: two-way, `tony` source | 4 |
| Review UI and its check skill | `src/sources/review-ui.mjs`, `scripts/review.mjs`, `src/ui/review.*`, `.agents/skills/verify-league-refresh/` | Cut | 4 |
| Untracked refresh skills | `.agents/skills/league-refresh/`, `league-refresh-compare/` | Left for Tony to keep or delete | — |
| Capture hosts | `.claude/agents/yahoo-reader.md` (backup host, kept), `docs/update-league.md`, `docs/codex-refresh.md` | Keep both; the allowed-URL check is a separate task (D2) | — |
| Plan | `PLAN.md` | Rewrite | 5 |
| Task specs | `tasks/03`–`tasks/22` | Archive | 5 |
| README | `README.md` | Update | 5 |
| Agent rules | `AGENTS.md` | Edit | 3, 5 |

### Work order

Five PRs, in order. Each PR follows two rules:

*   It deletes a module only together with every file that imports or runs
    it.
*   It fixes every doc line that names a command it removes, and leaves
    `npm test` passing.

Changes to recommendations land in PR 3, which sets `MODEL_VERSION` to 8.
This design is the task spec: each PR's "Done when" list is its acceptance
list, and no new `tasks/` file is written. If an implementer finds part of
this spec wrong or impossible, they stop and add a note under "Findings"
at the end of this document. D2's capture work goes in its own task,
`tasks/23-codex-capture.md`, written separately.

1.  **Shared helpers and multi-swap scoring (no behavior change).**
    *   Create `src/engine/advice-common.mjs` with `MODEL_VERSION`,
        `pickupStart`, `monthDay`, `normalizeRoles`, `matchPlayers` and
        `dropBlock` (signatures under Target Files).
    *   `v0-advice.mjs` imports them and re-exports `MODEL_VERSION`,
        `pickupStart` and `normalizeRoles`, so that every current import
        still works.
    *   Repoint `src/sources/bakeoff-records.mjs`, `src/engine/stream-chain.mjs`,
        `scripts/advise.mjs` and `.agents/skills/verify-league-refresh/check.mjs`
        to `advice-common.mjs`.
    *   Extend `projectTeam` to take a list of swaps.
    *   *Done when:* `npm test` passes, and the comparison below shows no
        difference.

        For the comparison, run `npm run advise -- <latest snapshot>
        --allow-stale` before and after the PR, on the same snapshot. Then
        compare the two `local/advice/<snapshot>.json` files with
        `decisionId` and `freshness` removed.
2.  **Week planner engine.**
    *   Add `src/engine/week-plan.mjs` and `tests/week-plan.test.mjs`. No
        script uses them yet.
    *   With `maxSteps: 1`, the planner runs as a one-step day sweep, which
        can be compared with the full beam search.
    *   *Done when:* the planner tests pass, and the PR description gives
        the measured runtime on the runtime fixture.
3.  **Switch to the planner; cut the chatbot arm.**
    *   Rewrite `scripts/advise.mjs` and `scripts/analyze-refresh.mjs`, and
        rewrite the brief (I2).
    *   Set `MODEL_VERSION` to 8 in `advice-common.mjs`.
    *   Make the deletions under "Deleted in PR 3", and the test and doc
        edits listed there.
    *   *Done when:* `npm test` passes, and `npm run refresh:analyze` on the
        latest saved capture prints the report sections in the order listed
        under "Report". The doc lines listed under "Deleted in PR 3" name no
        removed command.
4.  **Shadow log; cut the review UI.**
    *   Add the `tony` source, `npm run did` and the two-way replay.
    *   `scripts/advise.mjs` writes the `tool` and `none` entries when it
        saves a decision.
    *   Make the deletions and edits under "Deleted in PR 4".
    *   *Done when:* the shadow-log tests pass, and a replay of one real
        decision prints a result, or "unscored" with the reason.
5.  **Docs.**
    *   Rewrite `PLAN.md` from this design: goals, stop rule, decisions and
        open questions.
    *   Move `tasks/03`–`tasks/22` to `tasks/archive/` and fix their
        relative links.
    *   Update `README.md` to the remaining commands, using the
        `technical-writing` skill.
    *   Make the `AGENTS.md` edits listed under "Docs (PR 5)".
    *   *Done when:* every relative link in `PLAN.md`, `README.md`,
        `AGENTS.md`, `docs/` and `tasks/archive/` resolves.

### Week planner spec (`src/engine/week-plan.mjs`)

**Units.** A plan's gain and both bars are measured in expected
categories won: the `expectedCategories` value from `needs()`, summed over
the known categories. A plan **clears** its bar when its gain is at least
the bar.

**Inputs.**

```text
planWeek({ snapshot, schedule, projections, ids, roles, protectedNames,
           preferences, volumeStatus, options })
```

`planWeek` calls `applyPreferences(snapshot, preferences)` itself, as
`advise()` does today, and returns the notes in `preferenceNotes`.
`volumeStatus` comes from `estimateVolume`, which `scripts/advise.mjs`
already calls.

Options, with their defaults and CLI flags:

| Option | Default | CLI flag | Meaning |
|---|---|---|---|
| `fromDate` | the day after `snapshot.asOf` | `--from` | The first day an add made now can count. Also used as `addsFrom`. |
| `candidates` | 20 | `--candidates` | Shortlist size |
| `beam` | 50 | `--beam` | Plans kept after each day |
| `dropsPerPickup` | 6 | `--drops-per-pickup` | Drop options tried per pickup |
| `maxSteps` | adds left | `--max-steps` | The longest plan allowed |
| `dropBar` | 0.15 | `--drop-bar` | Bar for a plan that drops a player rostered in the snapshot (from model 4) |
| `addBar` | 0.05 | `--add-bar` | Bar for any other plan (from model 4) |
| `protectRank` | 120 | `--protect-rank` | Drops are blocked for players at or above this season-value rank |
| `seasonMargin` | 0 | `--margin` | The pickup's season value must be at least the drop's plus this |
| `poolSize` | 150 | `--pool-size` | Reference pool for season value and the strong line |

**Definitions.**

*   **Strong line**: `strongLine()` in `needs.mjs`. It takes the 90th
    percentile of each per-game stat among the top `poolSize` players by
    season value, and the 10th percentile for TO.
*   **Effective start for an add made now**: for candidate `p`, the date
    `pickupStart(p, fromDate, window, fromDate)`. It honors the
    `waiverClears` date.
*   **Player identity**: the ESPN ID. If a player has no ESPN ID, his
    normalized name is used.

**Steps.**

1.  **Players.** Match roster, opponent and available players to
    projections with `matchPlayers`. A player has a projection when the
    matcher gives him a prior with a per-game line, which is the same rule
    as today.
2.  **Days.** Every date from `fromDate` to `snapshot.matchup.end`
    (`window.end`).
3.  **Budget.** These are the same rules as `advise` today.
    *   Adds left = `maxAddsPerWeek` − `addsUsedThisWeek` − pending claims
        dated this week.
    *   Open spots = open non-IL spots − add-only pending claims.
    *   Every step's `start` falls inside this week's window, so every step
        uses one of this week's adds.
4.  **Opponent.** Run `projectTeam` on the opponent two ways, once per
    league check. In one, unknown starts are filled at zero. In the other,
    they're filled with the strong line.
5.  **Candidates.**
    *   A candidate is an available player who meets all of these:
        *   his status isn't in `BLOCKED`;
        *   he has a projection;
        *   he isn't named in Tony's pending claims;
        *   his effective start for an add made now is on or before
            `window.end`.
    *   Score each candidate's best one-step plan whose `start` is his
        effective start for an add made now, using steps 6 and 7.
    *   Keep the top `candidates` by that gain. Ties break by player
        identity.
    *   `guardrail.blockedByRule` counts each blocked (pickup, drop) pair
        once, in this step only.
6.  **Drop options for a pickup.**
    *   If the plan so far leaves an open roster spot, "no drop" is the
        only option.
    *   Otherwise the options come in this order:
        1.  pickups added earlier in the same plan, by their step order;
        2.  roster players marked `stream`;
        3.  other roster players for whom `dropBlock` returns `null`,
            lowest season value first.

        Ties within a group break by player identity. Keep the first
        `dropsPerPickup` options.
    *   A player with a pending drop is never an option.
7.  **Scoring a plan.**
    *   A plan is a list of steps `{ pickup, drop | null, start }`.
    *   Project Tony's team with `projectTeam(roster, ..., swaps)`. Swaps
        match players by identity, not by object reference.
    *   Run the projection twice: once with no preference, and once with
        every pickup preferred into the lineup from its `start`. Keep the
        version where the plan's pickups start more games in total. This
        extends today's choice between automatic and deliberate starts.
    *   Do this with unknown starts filled at zero and with the strong
        line. Each of the two versions of Tony's team is paired with each
        of the two opponent versions, giving four pairs `i`. Compute
        `needs()` for each pair, and do the same for the empty plan.
    *   `gain = min over i of (plan_i − noMove_i)`.
    *   `gainRange = [min, max] over i of (plan_i − noMove_i)`.
    *   Categories made unknown by missing banked totals or volume are
        unknown for every plan alike, so every plan is compared on the same
        categories.
8.  **Beam search.**
    *   Start with only the empty plan in the beam.
    *   For each day `d` in order, each plan in the beam may add one step
        with `start = d`. The step can use any shortlisted candidate who:
        *   is not already in the plan;
        *   has an effective start for an add made now on or before `d`;
        *   fits within the budget (adds left, and open spots after the
            plan's earlier steps).

        Plans that add no step on day `d` stay in the beam.
    *   Plans longer than `maxSteps` are discarded.
    *   Rank plans by gain and keep the best `beam`.
    *   Ties break by fewer steps, then by each step's `(start, pickup
        identity, drop identity or "")` compared in order.
    *   The top plan in the final beam is **best**.
9.  **Action.**
    *   A plan's bar is `dropBar` if any step drops a player who was on
        Tony's roster in the snapshot. Otherwise it is `addBar`.
    *   A step is **now** if its `start` equals its pickup's effective start
        for an add made now. Otherwise it is **later**.
    *   **todayBest** is the best plan in the final beam whose first step
        is now. If no such plan exists, it is the best one-step plan from
        step 5.
    *   Decide the action with the first rule that applies:
        1.  **hold**: best doesn't clear its bar.
        2.  **add**: best's first step is now. Propose best's first step.
        3.  **add**: todayBest clears its bar, and `best.gain −
            todayBest.gain` is below best's bar. Propose todayBest's first
            step.
        4.  **wait**: otherwise. Propose best's first pickup and that step's
            `start`.
10. **Cautious case (I1).** This applies to an add's proposed step only.
    *   Take the plan whose first step is the proposed step. Rescore it
        with two lines replaced, leaving other steps unchanged:
        *   the pickup's line by his lowest-value case;
        *   the drop's line by his highest-value case.
    *   The cases are `minutesCase(projection, m, r)` for `m, r ∈ { prior,
        season }`. They are ranked the way `stream-chain.mjs` ranks them
        today: run `seasonValues` over the priors with only that player's
        line replaced.
    *   If the rescored gain doesn't clear the plan's bar, the cautious
        action is hold.
    *   A `dependsOn` entry is added when the cautious action differs from
        the action.
    *   In each entry, `games` counts games played this season, and
        `seasonMpg` uses the existing DNP rules: a coach's-decision DNP
        counts as 0 minutes, and injury or rest DNPs are left out.
    *   A pickup whose line is season-only (Q7) always gets a `dependsOn`
        entry with `priorMpg: null`. His cautious line is all zeros, so his
        cautious action is usually hold. `minutesCase` returns a
        season-only line unchanged, so it can't serve as his cautious
        case.

**Output.** Player objects use the shape `describe()` produces in
`advise` today: `{ name, nbaTeam, status, espnId, games, minutes, rates,
seasonValue, seasonRank }`.

```text
{
  asOf, week, window, fromDate, addsFrom,      // addsFrom = fromDate
  action: 'add' | 'wait' | 'hold',
  step: { pickup, drop | null, start } | null,  // when action = 'add'
  waitFor: { pickup, start } | null,             // when action = 'wait'
  plan: [step, ...],                             // best, context only
  gain, gainRange, bar,
  baseline: { categories, expectedCategories },  // the no-move needs() result
  categories: { <category>: { before, after, change } },  // see below
  startsByDay: [{ date, openSlots, pickupStarts, displaced: [name] }],
  runnersUp: [{ step, gain, whyLost }],          // see below
  unknowns: [{ category?, player?, reason }],
  dependsOn: [{ player, games, seasonMpg, priorMpg | null, cautiousAction }],
  guardrail: { blockedByRule: { core, ilCapacity, lineupLock, noPrior,
                                rank, seasonValue }, protectedByRank,
               protectedNoPrior },
  preferenceNotes,
  baselineLineups, banked, addsLeft, openSpots,
  options: { roles, preferences, ...all options },
  decision: { action: 'move' | 'hold',
              pair: { pickup, drop, pickupStart } | null }
}
```

*   **`categories` and `startsByDay`** describe the one-step plan made of
    the proposed step: for an add, the step proposed now; for a wait, the
    waited step. For a hold, they describe no move.
*   **`runnersUp`** are the three best first steps other than the proposed
    one. `whyLost` is one of these values:
    *   `lower-gain`;
    *   `below-bar`;
    *   `later-start` (a later step that didn't beat now by the bar).
*   **`decision`** maps the action for the replay. An add is `move` with
    its step. A wait or a hold is `hold`.

**Report.** `formatPlan(report)` in `scripts/advise.mjs` prints these
sections in order. No line is longer than 72 characters.

1.  **Action line.** One of:
    *   `ADD <pickup> (<team>), DROP <drop>|into open spot, starts <date>`
    *   `WAIT: add <pickup> to start <date>`
    *   `HOLD`
2.  **`dependsOn` lines**, if any.
3.  **Category changes** for the proposed step.
4.  **Starts by day**: one line per date, giving the open slots, the
    pickup's start (yes or no) and anyone displaced.
5.  **Adds and spots left.**
6.  **Runners-up**, with `whyLost`.
7.  **Unknowns.**
8.  **As-of times** and `MODEL_VERSION`.

### Target Files to Create/Modify

#### 1. `src/engine/advice-common.mjs` (Create, PR 1)

*   `MODEL_VERSION`, `pickupStart`, `monthDay` and `normalizeRoles`,
    moved unchanged.
*   `matchPlayers({ ids, priors, poolSize })`. It returns
    `{ match(players, where), unscored }`. `match` is today's closure from
    `advise()`, moved unchanged, and it pushes to `unscored` in the same
    order.
*   `dropBlock(drop, pickup, start, { coreSet, streamSet, openSpots,
    protectRank, seasonMargin, planPickups })`. It returns the rule name or
    `null`.
    *   It applies the same rules in the same order as the `blocked`
        expression in today's `advise()`: core, IL capacity, lineup lock,
        stream exception, no prior, rank, season value.
    *   A player in `planPickups` counts as stream.

#### 2. `src/engine/needs.mjs` and `tests/lineup.test.mjs` (Modify, PR 1)

*   `projectTeam` accepts `swap` as one swap object, as today, or as an
    array of swaps.
*   Swaps apply in `start` order, and each one matches its `drop` by
    identity.
*   For an array, a `preferPickups` flag prefers every pickup from its own
    `start`.
*   One swap gives the same output as today.
*   Tests:
    *   two swaps where the second drops the first pickup;
    *   a single swap matches the existing output.

#### 3. `src/engine/week-plan.mjs` and `tests/week-plan.test.mjs` (Create, PR 2)

These files implement the planner spec above. The synthetic fixtures live
in `tests/fixtures/week-plan/`.

Tests:

*   **Guardrails:** each guardrail rule blocks its drop, and
    `blockedByRule` counts it once.
*   **Empty spot:** with an empty roster spot, no step has a drop.
*   **Full days:** a pickup whose games fall only on full days gains 0.
*   **Blocked status:** a pickup with a blocked status is never a
    candidate.
*   **Waiver timing:** a waiver player who clears Friday is never planned
    before Friday.
*   **Late clear:** a candidate whose earliest start is after the week
    ends is excluded.
*   **Missing volume:** missing banked makes or attempts leave FG% and FT%
    out of every plan.
*   **Unknown opponent player:** an opponent player with no projection
    doesn't change which categories are scored.
*   **Pending claims:** pending claims reduce adds left.
*   **Wait.** Fixture: Tony's lineup is full Tuesday and Wednesday.
    Candidate A plays Tuesday only. Candidate B plays Thursday and
    Saturday. B's plan beats A's by more than the bar, so the action is
    `wait` and names B and Thursday.
*   **Add now.** Fixture: candidate C plays on the first two days, both
    open. An add made later reaches only one game, so the action is `add`.
*   **Hold.** No plan clears its bar.
*   **Two steps.** Fixture: one stream slot, a Monday–Tuesday player and a
    Thursday–Friday player, and 2 adds left. The best plan has two steps,
    and the second drops the first pickup.
*   **Beam vs exhaustive:** on a fixture with 5 candidates and 3 days, the
    beam result equals an exhaustive search.
*   **The 2026-10-22 case** gives a proposal with a `dependsOn` entry whose
    cautious action is `hold`.
*   **Season-only pickup:** a pickup with a season-only line (6 games, no
    prior) can be proposed, and his `dependsOn` entry has `priorMpg: null`.
*   **Season-only drop:** a season-only player on Tony's roster is never a
    drop, because `noPrior` blocks him.
*   **Determinism:** running twice on one fixture gives byte-identical
    output.
*   **`maxSteps: 1`** returns the best one-step plan.
*   **Runtime fixture:** 13 roster players, 13 opponent players, 100
    available players with projections, a 7-day week with 5 to 10 games a
    day, and 4 adds left. The test fails only above 120 seconds.

#### 4. `scripts/advise.mjs` and `tests/advise-cli.test.mjs` (Rewrite and Create, PR 3)

*   **Kept, unchanged:**
    *   `readRoles`, `readPreferences` and `snapshotFreshness` (also used
        by `check.mjs` until PR 4);
    *   the volume estimate;
    *   decision saving;
    *   writing `local/advice/<snapshot>.json`.
*   **Replaced:** `formatAdvice` becomes `formatPlan`. The script calls
    `planWeek` instead of `advise`.
*   **Flags kept:** `--from`, `--adds-from` (sets `fromDate`),
    `--allow-stale`, `--max-age-hours`, `--minutes-k`, `--margin` and
    `--protect-rank`.
*   **Flags renamed:** `--hold-below` becomes `--drop-bar`, and
    `--add-only-below` becomes `--add-bar`.
*   **Flag removed:** `--top`.
*   **Flags added:** the new options in the planner table.
*   **Tests:** move the `readRoles`, `snapshotFreshness` and CLI tests from
    `tests/v0-advice.test.mjs` into `tests/advise-cli.test.mjs`. Add:
    *   every line of `formatPlan` output is at most 72 characters;
    *   each action prints its action line.

#### 5. `scripts/analyze-refresh.mjs` and `tests/analyze-refresh.test.mjs` (Modify, PR 3)

*   **Stages:** `snapshot`, `game-logs` and `advice`. The `evidence` key is
    removed from `status.json`.
*   **Summary:** it prints the decision ID, followed by sections 1, 2 and 8
    of the report.
*   **Test:** asserts the three stages.

#### 5a. `src/engine/projections.mjs`, `src/engine/season-value.mjs`, `src/engine/advice-common.mjs`, `tests/projections.test.mjs`, `tests/season-value.test.mjs` (Modify, PR 3)

Season-only projections (decision Q7).

*   **`projectPlayers(priors, ids, logs, { k, asOf, minGames = 5,
    minMinutes = 100 })`.** After building today's entries, it adds one
    entry for each player who meets all of these:
    *   he is in `ids.players` with an `espnId`;
    *   he has no usable prior: `priorName` is null, or the matched prior
        fails today's `usable` test;
    *   he has at least `minGames` games, or at least `minMinutes`
        minutes, in `logs` under the existing DNP rules.

    The entry's fields:

    | Field | Value |
    |---|---|
    | `name` | `espn:<espnId>` |
    | `espnId` | his ESPN ID |
    | `source` | `'season-only'` |
    | `perGame` | season averages of every stat in `STATS`, plus `g` = games played |
    | `mpg` | season MPG |
    | `minutes` | `{ games, starts, prior: null, season, projected: season MPG, asOf }` |
    | `original` | `null` |
    | `rates` | `null` |

    Today's entries get `source: 'prior'`.
*   **`seasonValues(players, { poolSize, fullSeasonGames = 70,
    poolFilter })`.** The new `poolFilter` restricts which players form the
    reference pool. Callers pass `p => p.source !== 'season-only'`, so the
    pool and `strongLine` stay prior-backed. Season-only players are
    scored against that pool. Their value scales by `g / 70`, as today's
    formula does.
*   **`matchPlayers`.** When `findPlayer` gives no `priorName`, or the
    prior has no per-game line, it looks up `espn:<espnId>`. A matched
    season-only player has a projection and a season value.
    *   For drops, `dropBlock`'s `noPrior` rule still applies to every
        player whose projection source isn't `'prior'`. Season-only players
        on Tony's roster stay protected from drops, as they are today.
*   **Tests:**
    *   4 games and 90 minutes gives no entry.
    *   5 games gives an entry keyed `espn:<id>`.
    *   100 minutes over 4 games gives an entry.
    *   An injury DNP doesn't count as a game.
    *   A season-only player's value is scaled by `g / 70`, and he isn't
        in the reference pool.
    *   `matchPlayers` finds him by ESPN ID.
    *   Prior-backed players' values are unchanged by adding season-only
        players.

#### 6. `src/engine/brief.mjs`, `scripts/brief.mjs`, `docs/chatgpt-brief.md`, `tests/brief.test.mjs` (Rewrite, PR 3)

`npm run brief -- <decisionId> [--state <path>] [--fa N]` keeps both
flags and writes `local/briefs/<decisionId>.md`. The brief has these
sections:

1.  **Fixed instructions.** For each player listed, check news, injuries
    and role changes. Say whether his recent minutes are likely to last
    this week, with a source and its date, or "don't know". Don't compute
    categories, schedules or adds: code computed them.
2.  **League rules.** The 9 categories, roster slots and adds left.
3.  **Context questions.** One per `dependsOn` entry, then one per
    runner-up's pickup.
    *   The facts line gives his name, team, games played, and season and
        prior minutes.
    *   The next line, with no name, asks: "Will this role last through
        <window.end>?"
4.  **Roster facts.** Tony's players with injury status, and the days that
    have open slots.

**Constraints:**

*   The brief never shows the action and never ranks players.
*   Its timestamp is the decision's `asOf`, not the current time.
*   The prompt version lives in `docs/chatgpt-brief.md`, and goes up
    whenever the fixed text changes.

**Tests:**

*   Every `dependsOn` player and runner-up appears.
*   No line contains both a player name and one of the whole words "add",
    "drop", "wait" or "hold".
*   The same decision gives a byte-identical brief.

#### 7. Deleted in PR 3

**Engine and source files:**

*   `src/engine/v0-advice.mjs`
*   `src/engine/stream-chain.mjs`
*   `src/engine/crunch.mjs`
*   `src/engine/player-evidence.mjs`
*   `src/engine/projection-calibration.mjs`
*   `src/engine/pilot-entries.mjs`
*   `src/sources/transaction-history.mjs`
*   `src/sources/espn-history.mjs`

**Scripts:**

*   `scripts/stream-plan.mjs`
*   `scripts/player-evidence.mjs`
*   `scripts/calibrate-projections.mjs`
*   `scripts/prepare-pilot.mjs`

**Docs and fixtures:** `docs/bakeoff-prompt.md` and `tests/fixtures/stream/`.

**Tests:**

*   `tests/v0-advice.test.mjs` (its CLI tests move first; see item 4)
*   `tests/stream-chain.test.mjs`
*   `tests/crunch.test.mjs`
*   `tests/player-evidence.test.mjs`
*   `tests/player-evidence-cli.test.mjs`
*   `tests/projection-calibration.test.mjs`
*   `tests/transaction-history.test.mjs`
*   `tests/pilot-entries.test.mjs`

**npm scripts:** `stream`, `evidence` and `pilot:prepare`.

**Edits in the same PR:**

*   **`tests/advice-correctness.test.mjs`:** call `planWeek`.
    *   `topPairs.length === 0` becomes `action === 'hold'` with empty
        `runnersUp`.
    *   `pair.score` becomes `gain`.
    *   `pair.changes` becomes `categories`.
    *   `baseline.categories` stays `baseline.categories`.
    *   The `blockedByRule` counts stay as they are.
*   **`tests/decisions.test.mjs`:**
    *   Call `planWeek` where it calls `advise`.
    *   `report.topPairs[*].lineup.started` becomes the proposed step's
        started games.
    *   Remove the tests that run `prepare-pilot.mjs` or read
        `docs/bakeoff-prompt.md`.
*   **`scripts/bakeoff.mjs`:** remove the `pilot` command and its
    `pilotEntries` import.
*   **`docs/codex-briefing.md`:**
    *   Remove step 3 (pilot).
    *   Remove the `bakeoff-prompt.md` link from the intro.
    *   Change step 5's result values to `add|wait|hold|failed: <step>`.
    *   Remove "Skip step 3" from "Dry run" and step 3 from "Catch up a
        decision".
*   **`docs/update-league.md`:** remove the `npm run evidence` line.
*   **`docs/backtest-01.md`:** replace the reproduce command with "removed
    in PR 3; run it from the commit before that PR".
*   **`AGENTS.md`:** the prompt-version rule names `docs/chatgpt-brief.md`
    instead of `docs/bakeoff-prompt.md`.

#### 8. `src/sources/bakeoff-log.mjs`, `src/engine/bakeoff.mjs`, `scripts/bakeoff.mjs`, `src/sources/bakeoff-records.mjs`, `scripts/advise.mjs` (Create/Modify, PR 4)

*   **`bakeoff-log.mjs` (new).** It exports `readEntries()` and
    `appendEntries(entries)`, moved from `scripts/bakeoff.mjs`.
    `appendEntries` refuses a second entry for the same decision and source
    unless the new entry has `replaces: true`. Nothing is rewritten, and
    the newest entry counts.
*   **Validators.** `validateEntry` and `validateReview` also accept
    `source: 'tony'`.
    *   A `tony` entry has `chatbot: null` and `rating: null`.
    *   Its required `tag` is one of the four G4 tags.
    *   Its optional fields are `minutes` (number), `rescue` (boolean),
        `replaces` (true) and `note` (string).
    *   Existing `chatbot` rows stay valid, so old data reads without
        migration. Nothing writes new ones.
*   **`attachLineups`.** For `tony` entries it skips the "must match saved
    recommendation" check. If the move falls outside the saved snapshot, it
    returns `lineups: null` with an `unscoredReason` instead of throwing.
    That happens when:
    *   the pickup isn't in the captured free agents;
    *   there's no add or spot left;
    *   the drop is a core player.
*   **Kept unchanged:** `realizedGain`, `flips`, `summarize` and
    `replayLineups`.
*   **`scripts/bakeoff.mjs` commands:**
    *   **Kept:** `record` and `score`.
    *   **Removed:** `rate`, with `applyReviews`.
    *   **Added:** `replay --to <date>`. It replaces `scorecard`. For each
        decision whose week ends on or before `--to` and that has a `tony`
        entry, it prints the categories helped and hurt by the `tool` entry
        and by the `tony` entry, each against the `none` entry, or
        "unscored" with the reason. The two **differ** when their
        decision, pickup, drop or `start` differ. The summary counts, among
        differing decisions, how many each side won by helped minus hurt.
    *   `local/pilot-reviews.jsonl` is left in place and no longer read.
*   **`scripts/advise.mjs`** writes `tool` and `none` entries with
    `appendEntries` when it saves a decision.

#### 9. `scripts/did.mjs`, `tests/did.test.mjs`, `tests/bakeoff.test.mjs`, `package.json` (Create/Modify, PR 4)

```text
npm run did -- <decisionId> hold --tag T [--minutes N] [--rescue] [--reason "..."] [--replace]
npm run did -- <decisionId> add "<player>" [--drop "<player>"] --on YYYY-MM-DD --tag T [same flags]
```

*   **`package.json`:** add `"did": "node scripts/did.mjs"`.
*   **Arguments:**
    *   `--tag` is required.
    *   `--reason` is stored as `note`.
    *   Quote names that contain spaces.
*   **Name resolution:** names resolve against the decision's saved
    snapshot. The add searches `freeAgents` first, then the opponent's
    roster. The drop searches Tony's roster. The match uses `findPlayer`
    with the snapshot player's `nbaTeam`, and the ESPN ID comes from
    `data/ids.json`. An unknown name fails.
*   **Entry fields:**
    *   `week` and `asOf` come from the decision record.
    *   `date` is the day `did` runs.
    *   `start` is `--on`.
*   **Tests in `tests/did.test.mjs`:**
    *   a valid add;
    *   a hold;
    *   a missing tag is refused;
    *   an unknown name is refused;
    *   a duplicate without `--replace` is refused;
    *   `--replace` appends a new entry;
    *   replay where Tony matched the engine;
    *   replay where Tony differed and the engine gained more;
    *   missing logs give "unscored";
    *   a pickup outside the capture gives "unscored";
    *   a hold scores as zero change.
*   **`tests/bakeoff.test.mjs`:** delete the `rate` CLI, `applyReviews`
    and scorecard-gate tests.
*   **`tests/decisions.test.mjs`:** delete the tests that write `chatbot`
    entries.

#### 10. Deleted in PR 4

**Files:**

*   `src/sources/review-ui.mjs`
*   `src/ui/review.css`
*   `src/ui/review.html`
*   `src/ui/review.js`
*   `scripts/review.mjs`
*   `.agents/skills/verify-league-refresh/`

**Tests:** `tests/review-ui.test.mjs`.

**npm scripts:** `review`.

**Edits in the same PR:**

*   **`docs/codex-briefing.md`:**
    *   Remove the `npm run review` part of step 4.
    *   Remove the review checks in step 6.
    *   Add one line: after Tony decides, run `npm run did` with his
        answer.
*   **`docs/update-league.md`:** remove the link to the
    `verify-league-refresh` skill.

#### 11. Docs (PR 5)

*   **`AGENTS.md`:**
    *   Replace the Δ P(win) sentence in the recommender guardrails with:
        "Every recommendation shows its numbers, the as-of time of its
        data, and what it depends on (the planner report)."
    *   Replace "One task from `tasks/` at a time" with "One PR from the
        active design's work order at a time".
    *   Change "the task file's 'Done when' list" to "the PR's 'Done when'
        list in the active design".
    *   Change "at the end of the task file" to "under 'Findings' at the
        end of the active design".
*   **`PLAN.md`, `tasks/archive/` and `README.md`:** as in work order
    item 5.

### Verification Plan

*   **Unit tests:** `npm test` passes after every PR.
*   **PR 1:** the comparison in its "Done when" shows no difference.
*   **Determinism (G6):** the planner test that runs twice and compares the
    output passes.
*   **Real data:** after PR 3, `npm run refresh:analyze` on the latest
    saved capture prints the report sections in order. Tony checks the
    counts by hand on three real proposals (G1).
*   **Guardrails (G2):** the ported guardrail tests pass.
*   **Trial (G3–G5):** after PR 4, `npm run bakeoff -- replay --to <date>`
    runs on the saved entries and prints a result or a reason for each
    decision.

## Findings

Implementers add notes here when part of this spec turns out to be wrong or
impossible. Leave the rest of the document unchanged.

*   **PR 2, Full days test (line 844).** A pickup whose games fall only on
    full days gains nothing from games that can't start. He doesn't always
    gain exactly 0: step 7 keeps the lineup where pickups start more games,
    so a forced start can displace a starter. The test gives every starter a
    stronger line and expects a gain of 0 or less and a hold.
*   **PR 2, Wait test (line 856).** Waiting only beats adding B now if the
    early add costs something. Otherwise "add B now" ties with "add B
    Thursday", and the earlier start wins the tie. The fixture has no open
    roster spot, and the only droppable player starts Tuesday and Wednesday
    and has no later games.
*   **PR 2, season-only players before PR 3.** The season-only tests (lines
    870 to 873) need two pieces that item 5a adds in PR 3. PR 2 adds the
    `noPrior` rule for a drop whose projection is season-only to `dropBlock`.
    Its tests reach a season-only player through an `ids` entry whose
    `priorName` is `espn:<id>`.
*   **PR 2, one step per day.** Step 8 adds at most one step per plan per
    day, so two adds in one plan can't share a start date. The first step
    and the action don't change. A second add that day appears in the plan
    a day later.
*   **PR 2, `fromDate` before the matchup.** The planner refuses a
    `fromDate` before `window.start`. Otherwise a step could start outside
    this week (step 3).
*   **PR 2, earlier pickups as drops.** Step 6 lists earlier pickups first,
    but they still go through `dropBlock` with `planPickups`. A pickup named
    as core stays protected.
*   **PR 3, season-only players and ranks (item 5a).** The spec promised
    that adding season-only players leaves prior-backed players' season
    values unchanged. It holds for values, not ranks. Season-only players
    are ranked with everyone else, so a prior-backed player can drop a rank,
    which can move him across the `protectRank` line. Tony confirmed on
    2026-10-31 that season-only players count in the ranking.
*   **PR 3, a negative `--margin`.** `seasonMargin` may be negative, as
    `advise` allowed before. The planner checks only that it is finite.
*   **PR 3, `refresh:analyze` check.** On the 2026-10-30-2200 capture, the
    game-logs stage failed on an ESPN box score ("invalid minutes"). That
    code is unchanged by PR 3. The report check ran `npm run advise` on the
    snapshot that run built.

--------------------------------------------------------------------------------

*Drafted with EGM*
