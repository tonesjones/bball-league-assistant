# PLAN

This repo holds a tool that proposes one fantasy basketball move at a time. The active design is
[`docs/designs/league-move-checker.md`](docs/designs/league-move-checker.md). It holds the
reasoning, the planner spec and each PR's file list. This file holds the goals, the decisions, the
build checklist and what is next. The plan before 2026-10-31 is in
[`tasks/archive/PLAN-2026-10-30.md`](tasks/archive/PLAN-2026-10-30.md).

## What the tool is, and the problem

Tony manages one team in a 12-team Yahoo head-to-head league scored on 9 categories, with daily
lineups and 4 adds a week. Most of the in-season edge comes from a few repeated decisions: whom to
add and drop, where to spend the 4 adds so more started games land on open lineup days, and whether
a move helps the categories still in play this week. Tony makes these decisions by hand, with
ChatGPT for news, injuries and roles. ChatGPT is weak at counting games on open days, at combining
FG% and FT% from makes and attempts, and at giving the same answer twice. When a decision is
pending, the tool searches the available players and proposes one action (add today, wait for a
named later day, or hold) with the counts behind it. It never makes a move. Tony compares each
proposal with what he would do himself, to decide whether the engine is worth keeping.

By 2026-10-30, after 13 days and 7 model versions, no decision had been scored, and Tony rated
"do nothing" above the tool. The bet behind the project is untested.

## Goals and stop rule

| ID | Goal | Measure |
|---|---|---|
| G1 | One proposed action with correct counts. | The planner tests pass. Tony checks three real proposals by hand and finds no error. |
| G2 | No guardrail is broken. | The guardrail tests in `tests/advice-correctness.test.mjs`, ported to the planner, pass. |
| G3 | At most 5 minutes of Tony's attention per decision. | Tony records minutes with `npm run did -- ... --minutes N`. |
| G4 | Useful often enough to keep. | Each `did` entry has one tag (`changed-decision`, `caught-mistake`, `no-effect`, `wasted-time`). The weekly replay shows which choice gained more categories when Tony and the engine differed. The threshold is open question Q3. |
| G5 | Low upkeep. | At most one 30-minute maintenance session and one rescued league check per week. Rescues come from `did --rescue`, sessions from the git log. |
| G6 | Same inputs, same answer. | A test runs the planner twice on one fixture and compares the output byte for byte. |

**Stop rule.** If G4 or G5 fails at the end of the trial window, Tony stops asking for league
checks. The code stays in the repo for occasional use. Any further work starts with a new design
review.

**Trial window.** 2026-10-31 to 2026-11-14. It started when PR 4 (the shadow log, #77) merged.
Apply the stop rule on 2026-11-14. The 2026-10-30 usability trial ended on 2026-10-31 with no entries (decision Q4).

## Decisions

All made by Tony on 2026-10-31. The design has the rejected options and known weaknesses.

| ID | Decision |
|---|---|
| Q1 | The tool searches and proposes. It does not check Tony's own moves. |
| Q2 | Engine against Tony through a two-way shadow log. No three-way bakeoff, no chatbot arm. |
| D1 | The planner searches week plans with a beam search and acts on step one. |
| D2 | Codex runs the Yahoo capture, and Claude stays a maintained backup host (revised 2026-10-31). |
| I1 | Always propose, and show what the proposal depends on. |
| I2 | Keep the engine. The brief becomes a context-check prompt that hides the chosen action. |
| A4 | The 2026-10-22 requirement (never propose a drop on one strong game) is relaxed by I1. |
| Q7 | A player with no prior season gets a season-only projection after 5 games or 100 minutes. |
| Q4 | End the 2026-10-30 trial now. A new two-week window starts when PR 4 merges. |

## Open questions

- **Q3. G4 threshold.** How many `changed-decision` or `caught-mistake` tags out of how many
  decisions mean "keep"?
- **Q6. The I2 fallback trigger.** For example: after 5 decisions, Tony overrode the engine on
  context grounds in at least 3. If I2 fails, the fallback is "code computes, ChatGPT decides". It
  changes Q1, D1, the planner and `AGENTS.md` hard rule 2, so it needs a new design.

## The build

Five PRs, in order. Each leaves `npm test` passing and deletes a module only together with every
file that imports it. The "Done when" lines are the acceptance criteria. The design lists the files
for each PR.

- [x] **PR 1: shared helpers and multi-swap scoring (#74, merged).** No behavior change.
  *Done when:* `npm test` passes, and `npm run advise` on one snapshot before and after the PR gives
  the same `local/advice/<snapshot>.json`, with `decisionId` and `freshness` removed.
- [x] **PR 2: week planner engine (#75, merged).** `src/engine/week-plan.mjs` and its tests. No script
  uses it yet.
  *Done when:* the planner tests pass, and the PR description gives the measured runtime on the
  runtime fixture.
- [x] **PR 3: switch to the planner; cut the chatbot arm (#76, merged).** Rewrites `advise`,
  `refresh:analyze` and the brief. Adds season-only projections (Q7). Sets `MODEL_VERSION` to 8.
  *Done when:* `npm test` passes, `npm run refresh:analyze` on the latest saved capture prints the
  report sections in the design's order, and no doc line names a removed command.
- [x] **PR 4: shadow log; cut the review UI (#77, merged).** Adds the `tony` source,
  `npm run did` and the two-way replay.
  *Done when:* the shadow-log tests pass, and a replay of one real decision prints a result, or
  "unscored" with the reason.
- [x] **PR 5: docs (#78).** Rewrites this file, archives `tasks/03` to `tasks/22`, updates
  `README.md` and `AGENTS.md`.
  *Done when:* every relative link in `PLAN.md`, `README.md`, `AGENTS.md`, `docs/` and
  `tasks/archive/` resolves.

Merging PR 4 started the trial window on 2026-10-31.

## Next tasks

- [ ] **`tasks/23-codex-capture.md` (D2), not written yet.** Check the allowed URLs on saved
  captures, so a Codex capture meets the same read-only rule as the Claude one. The Claude capture
  path (`yahoo-reader`, `.claude/settings.json` and the URL hook) stays as a maintained backup. It
  weakens no enforcement without Tony's OK in its PR.

## Parked

None of these is needed for the trial.

- Rule check over real decisions: a script that reads every record in `local/decisions/` and its
  snapshot, and fails if a saved recommendation breaks a guardrail. Prints decision IDs and rule
  names only. The design defers it (G2).
- `npm run check:raw <dir>`: run each page parser on a saved refresh and print ok or the error,
  without page text.
- Untracked refresh skills in `.agents/skills/league-refresh/`: Tony decides whether to keep them.
- A paid projection source (design Alternative C), if the replay shows poor proposals come from
  projections.

Out of scope by the design's non-goals: win probabilities, title odds, trade scoring, FAAB bid
amounts, a web app, scheduled runs, and chained plans past this week.

## Ground rules

`AGENTS.md` has the hard rules. These add the reasons behind two of them.

- **Read only, no Yahoo API.** Access needs an application, an email exchange and an NDA, and Tony
  decided not to pursue it. League data comes from Yahoo pages in Tony's signed-in browser, saved
  unchanged to `local/raw/`. Node parsers build the snapshot, and code computes every number.
- **Codex is optional for building.** Codex (`/codex-delegate`) can write parsers and engine code.
  If it is unavailable, Sonnet and Haiku do the same work. Under D2, Codex is the primary capture
  host and Claude's `yahoo-reader` agent is the maintained backup.
