# PLAN

The north star for this repo, and where the build stands. Task specs in [`tasks/`](tasks/) hold the
detail; this file says why each one exists and in what order.

## What we're building

Advice on add/drop and streaming moves for one Yahoo head-to-head 9-category fantasy basketball
league, with the numbers behind every suggestion. Tony makes every move by hand in Yahoo. The tool
never acts.

## Why

To win Tony's league. That is the only goal. Making this usable by other people is parked: one
league, one user, and nothing in the build should be shaped by sharing it later.

## Why not just ask a chatbot

Posting roster screenshots into Claude, ChatGPT or Grok and asking for advice is free and takes a
minute. This project only makes sense if it beats that. The bet is that weekly edges in H2H 9-cat
come from arithmetic that chatbots do badly:

- games left this week for each player, times per-game category rates, against the opponent's
  projected totals;
- FG% and FT% weighted by attempts, not averaged;
- spending 4 adds a week where they swing the most categories.

Chatbots also guess at schedules and who is available, give different answers to the same
question, forget league context between chats, and can't be scored afterwards. This tool reads the
real league state, does the arithmetic in code, and logs every suggestion so it can be scored.

If it doesn't beat the chatbot in practice (Phase 0 below), stop or rethink before building more.

## How

### Ground rules

- **No Yahoo API.** Access now needs an application, an email exchange and an NDA. Not pursuing it.
- **No pasting.** League data is read on demand: Tony says "update league", and an agent (Haiku or
  Sonnet) opens his Yahoo league pages in a browser he is already signed in to and saves the raw
  page text to `local/raw/`. Node parsers turn that text into the league snapshot. An LLM collects
  the pages; code computes every number. Claude never signs in to Yahoo for Tony.
- **Codex is optional.** Codex (`/codex-delegate`) writes parsers and engine code when it's
  available. If the subscription goes, Sonnet (`worker`) and Haiku (`scout`, `grunt`) do the same
  work. Nothing that runs during the season calls Codex.
- **Public repo.** No league ID, team names, manager names or Yahoo pages in git. They live in
  `local/` and `.env`, both git-ignored.

### Phase 0: v0 advice and the chatbot bakeoff (now)

No UI. Run from Claude Code.

1. League read ([Task 02](tasks/02-yahoo-league-state.md)): browser fetch and parsers for
   rosters, free agents, this week's matchup and transactions.
2. Schedule and ID map: steps 2 and 3 of [Task 01](tasks/01-nba-data-and-projections.md),
   pulled forward.
3. v0 advice and bakeoff ([Task 05](tasks/05-v0-advice-and-bakeoff.md)): rank free agents against
   Tony's roster by games left times last season's per-game category value, weighted by this
   week's category needs, within the 4-add limit and the guardrails in [`AGENTS.md`](AGENTS.md).
4. Run the bakeoff for 2 full weeks: at each decision, log the tool's suggestion and a chatbot's
   suggestion from the same screenshots and a fixed prompt. Score both from real box scores.

**Gate.** Go to Phase 1 only if the tool's moves beat the chatbot's on realized category gain in
most decisions and Tony rates them as more useful. Otherwise rethink or stop. Record the result
here and as a decision note in the vault.

### Phase 1: better numbers

- Projections from this season's game logs, with the 2025-26 backtest
  ([Task 01](tasks/01-nba-data-and-projections.md), remaining steps). v0 switches from priors to
  these projections.
- Matchup odds ([Task 03](tasks/03-matchup-odds.md)). Advice is ranked by Δ P(win this week).

### Phase 2: the app

[Task 06](tasks/06-app.md). Not a CLI.

- **Local web app:** used to test a branch before its PR is approved, and in daily use it has the
  Refresh button that runs the league read and pushes the new snapshot to Cloudflare.
- **Cloudflare Pages:** production. Deploys `main` on merge, gives each PR branch a preview URL,
  and is locked to Tony's email with Cloudflare Access. Tony sets up the Cloudflare account and
  Access himself.
- **Screens:** first-run setup, today's best move, free-agent board. The matchup screen comes with
  matchup odds.
- **UX bar:** someone opening it for the first time gets to a recommendation without reading docs.
  Phone first: readable at 375 px with no horizontal scrolling.

### Later

FAAB bid pricing, Δ P(title) from a season simulation, injury alerts
([Task 04](tasks/04-injury-feed.md)), opponent and trade models.

## How we prove it works

| What | Proof |
|---|---|
| The whole idea | Phase 0 bakeoff: the tool beats the chatbot baseline on realized category gain and on Tony's rating. |
| League read | The snapshot matches the Yahoo app for rosters and matchup totals. Parsers fail loudly on a page they don't recognize, never with a partial snapshot. |
| Advice | Every suggestion names the pickup, the drop, games left for each and the category gain, and passes the guardrail tests. |
| Projections | On the 2025-26 backtest, beat "season average so far" in at least 7 of 9 categories. |
| Odds | Task 03 sanity tests, then a weekly Brier score from the calibration log. |
| App | A first-time user reaches a recommendation unaided, on a phone. |
| The season | A weekly log: record, categories won, moves made, suggestions taken. |

## Status

Updated at the end of each session.

**2026-10-19.** North star agreed. Scaffold only: Draft Lab priors in `data/priors/`, task specs,
2 passing tests. Next: Phase 0, starting with the league read (Task 02) and the schedule.

**2026-10-19, later.** Task 02 steps 1 and 2 done: [`docs/update-league.md`](docs/update-league.md)
written, and the first real fetch saved all 9 pages to `local/raw/`. Page URLs and contents are in
[`docs/sources.md`](docs/sources.md), real IDs in `.env`. Schedule source picked (ESPN, see
`docs/sources.md`). Next: Task 02 steps 3 to 5 (schema, parsers, synthetic fixtures), then Task
01 steps 2 and 3 (schedule and ID map).

**2026-10-19, guardrails.** The league read is now read-only by enforcement, not only by
instruction: `.claude/settings.json` denies the browser's click, type, form and script tools and
runs a hook that blocks Yahoo URLs outside the read-only list. Fetches run through the
`yahoo-reader` agent. The opponent page was dropped (the matchup page has both rosters), so a
refresh is 8 pages. Checked live: a click and a blocked URL were refused, and the settings page
still opened.

**2026-10-19, parsers.** Task 02 steps 3 to 5 done: snapshot schema and `validate()`, one parser
per page in `src/sources/yahoo-pages/`, synthetic fixtures, and `scripts/build-snapshot.mjs`. The
real pre-season refresh builds a valid snapshot. Known gap: the transactions parser only handles
an empty page, so the first refresh after a league move will fail until a real example is added
(see the notes in Task 02). Next: Task 01 steps 2 and 3 (schedule and ID map), then Task 02 step 6.

## Open decisions

- ~~Which pages the league read needs, and their URLs.~~ Settled 2026-10-19: 8 pages, listed with
  the reason for each in `docs/update-league.md` (the first fetch also read the opponent page).
- ~~Whether a Haiku or Sonnet subagent can drive the browser tools.~~ Settled 2026-10-19: yes. A
  Haiku subagent (general-purpose agent, `model: haiku`) used the built-in browser pane's tools
  and fetched all 9 pages by following `docs/update-league.md` in about 2.5 minutes. It saves
  pages by retyping the tool output, so a check compared two saved pages with the live page:
  every player row and setting matched; only whitespace and button labels differed. Parsers must
  still fail loudly on a malformed row. Tony is signed in to Yahoo in the browser pane, not in
  Firefox, which the browser tools can't drive.
- ~~Schedule source for 2026-27.~~ Settled 2026-10-19: ESPN's public site API, per team. See
  `docs/sources.md`.
- The chatbot used for the bakeoff baseline, and its fixed prompt.
