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
   Done (#7, #8, #9). Tony rejected every suggestion from the first runs, so step 4 makes the
   advice trustworthy before the bakeoff starts.
4. "Best next move, or hold." Each item is one PR:
   - **4a. Live matchup and shooting volume** (PR #10). The live matchup page has no makes or
     attempts. Estimate this week's banked FGM/A and FTM/A from NBA game logs for each roster,
     checked against Yahoo's counting totals. If the estimate can't be checked, FG% and FT% are
     marked unknown and left out of the score, and the report says so at the top.
     *Done when:* a synthetic test shows the estimate on a checked roster, and a mismatch or
     missing logs marks FG%/FT% unknown; the real week-1 pages produce a report.
   - **4b. Legal lineups, one move or hold, fresh data.** Each day's starters fill the league's
     position slots (PG, SG, G, SF, PF, F, C, Util) from each player's eligible positions, and a
     games cap counts games already used when the league has one. The report gives one best move,
     or "hold" when no move gains at least a set number of expected categories, then says to
     refresh and rerun after the move. Players with no prior still take lineup slots and are
     counted as unknown games. A snapshot older than a set age is refused unless overridden.
     *Done when:* tests cover a player who can't fill a slot, hold below the threshold, unknown
     games, and a stale snapshot.
   - **4c. Roster roles.** Tony marks players in git-ignored `local/roles.json` as core (never
     dropped) or stream (droppable for a weekly gain, with no season-value test). Everyone else
     keeps the season guardrail.
     *Done when:* tests show a stream player dropped for a weekly gain, a core player never
     dropped, and `local/protected.json` still read as core.
   - **4d. Bakeoff scoring.** Score every decision, including "hold", against making no move,
     from the move's own effective date. Report categories helped and hurt separately, and each
     category's gain on its own scale, never averaged across categories. Log why Tony rejected a
     suggestion.
     *Done when:* tests show a harmful flip counted as hurt, a hold scored as zero change, and a
     move dated mid-week scored only from that date.
   - **4e. Docs.** README status, and the phase of each requirement in `AGENTS.md`
     (Δ P(win this week) arrives with Task 03, Δ P(title) later).

   Done (#10 to #14). One gap from 4b: when the league has a games cap, games already used this
   week are still unknown, and the report says so. This league has no cap.
5. Honest advice, then the pilot. Last season's priors set every projection and the season-value
   guardrail, a start with no projection counts as zero, and the bakeoff counts every game a
   player played, started or not. These items fix that before the scored pilot, in this order.
   Each is one PR:
   - **5a. Missing production.** Advice gets a third outcome, "insufficient evidence", beside move
     and hold. A start with no projection, in either of Tony's lineups or in the opponent's, is
     never counted as zero. When it could change the comparison or the category outlook, the
     report withholds the move and names the players and what's missing. "Hold" stays for when
     the known numbers support no move.
     *Done when:* tests show that dropping an unprojected stream player can't look like a gain
     because their production is missing, that unknown opponent production can't give a
     complete category outlook, and that fully projected comparisons, core protection and
     deliberate pickup starts work as before. Tony reviews a real example of each of the three
     outcomes before 5b starts.
   - **5b. Decision records.** Each advice run gets an ID and saves, under `local/`, its options,
     the baseline and proposed daily lineups, the commit SHA, the snapshot path and the
     projection version. Reruns add a record; none is overwritten. Tool, chatbot and "do nothing"
     bakeoff entries point to the same decision. Schedule and priors are in git, so the SHA
     covers them.
     *Done when:* two runs on the same snapshot with different options are both kept, and every
     bakeoff entry names its decision record.
   - **5c. Minutes blend.** [Task 01](tasks/01-nba-data-and-projections.md) step 5, minutes only,
     pulled forward. Projected minutes blend the prior MPG with this season's games from the
     first game on, as pseudo-games: `(k × prior_mpg + sum of season minutes) / (k + games)`,
     with `k = 2` as a parameter and equal weight per game. `k = 2` is a starting value, not a
     calibrated one; recency decay waits for the Task 01 backtest. Per-minute rates stay at the
     prior, so counting stats scale with projected minutes. That's an interim assumption: a
     change in usage or shots per minute waits for the rate model after the pilot. The same
     projection feeds weekly scoring, lineup order and the season-value guardrail.
     The ESPN box score parser keeps DNP rows and the `starter` flag (both seen in real box
     scores; older logs discarded DNP rows). A DNP with reason `COACH'S DECISION` counts as zero
     minutes. Any other reason (an injury such as "RIGHT CALF", or rest) is left out of the
     blend, and so is a game where the player isn't in the box score. Starter status is stored
     and shown, not modeled. A player with no usable prior stays unknown, because minutes alone
     can't give category rates.
     A one-game role change shouldn't flip a decision on its own. Each pickup and drop gets two
     minutes scenarios, the prior MPG and this season's MPG so far, and a move is recommended
     only if it clears the hold threshold in all four combinations, the same rule 5a uses for
     missing production. If some cases clear the threshold and others do not, the outcome is
     "insufficient evidence"; if none support a move, it is "hold". These endpoints stay fixed:
     more games update the blend, but do not retire the prior-MPG case. This conservative choice
     can keep a move blocked even after a consistent season history. Advice requires a game-log
     refresh checked at or after the snapshot, covering the season through its Eastern date
     (including checked off-days). The report shows games observed, starts, prior MPG, season MPG, projected
     MPG and the as-of time of the logs.
     *Done when:* tests cover a player with 1 or 2 games, a player whose minutes rose (projection
     and guardrail rank both up), an injury DNP left out, a coach's-decision DNP counted, a
     player absent from the box score left out, a player with no prior still unknown, one game
     that reverses a drop's ranking giving "insufficient evidence", a consistent 5-game history
     moving the blended projection toward the observed role while retaining the fixed scenario
     gate, and stale game logs refused. A synthetic fixture covers the 10-21 regression (a
     low-prior big who starts and plays 30 minutes, against a high-prior wing who plays 18 off
     the bench) without real names.
   - **5d. Continuous pilot ([Task 11](tasks/11-continuous-pilot-and-scorecard.md)).** Not a
     freeze. Starts with the first refresh after PR #32 merges and runs every refresh from then
     on, even while Tony rates most advice as bad. Every refresh gets a decision record. Log the
     tool, chatbot and "do nothing" entries, Tony's rating and any rejection reason before the
     outcome is known. Also track invalid and unscorable decisions, refresh time and recurring
     data problems. A fix doesn't restart anything: a change to recommendations or scores bumps
     `MODEL_VERSION`, a change to the chatbot prompt bumps its prompt version, and the scorecard
     groups results by version. Decisions recorded before Task 11a have no version and count
     only as rehearsals.
   - **5e. Lineup-aware scoring.** Built while the pilot runs, from the saved lineups. Replay the
     baseline and proposed daily starts against real game logs: a pickup's benched game counts
     for nothing, a displaced starter's production is subtracted, games before the effective
     date are left out, and FG% and FT% come from makes and attempts. Missing results or
     shooting volume make a decision unscorable, never zero. Each decision is reported on its
     own, and totals are labeled so overlapping hypothetical moves don't read as a weekly plan.
     *Done when:* tests show a benched pickup game adds nothing, a displaced starter subtracted,
     a mid-week move scored from its date, a complete hold scored as zero, and missing evidence
     shown as unscored.
   - **5f. After the pilot.** Per-minute rate shrinkage and the rest of Task 01 (Phase 1). With
     about 15 games of prior minutes, one 30-minute game moves a rate only about 7%, so rates
     wait; the error in the first live runs came from minutes. Players with no prior get an
     evidence threshold here (for example 5 games or 100 minutes) before their season rates are
     used. Hand-entered role assumptions stay deferred unless the pilot shows decisions going
     wrong in the first games after a role change.

6. Stream-chain planner ([Task 10](tasks/10-stream-chain-planner.md)). A separate command that
   chains pickups across teams' back-to-backs to get the most started games from one stream
   slot, for 2, 3 and 4 adds. A long-term pickup always comes first and gets its own add. It
   doesn't change `advise` output or the bakeoff, so it can be built before or during the pilot.

7. Empty-slot pickups ([Task 12](tasks/12-empty-slot-pickups.md)). When an IL move opens a
   non-IL roster spot, `advise` also scores an add with no drop. Each reported pickup shows its
   next-week games and legal starts as context; they don't change the score. `MODEL_VERSION` 2.

8. Pending claims ([Task 13](tasks/13-pending-claims.md)). The team page's pending waiver
   claims reserve adds and open spots, claimed players and pending drops aren't offered, and the
   report warns when claims need more adds or spots than Tony has. Proposed trades are reported,
   not modeled. `MODEL_VERSION` 3.

9. Unblock the scored pilot ([Task 14](tasks/14-pilot-unblock.md)), from the 2026-10-24 scope
   audit. Four PRs, in order: banked makes and attempts from Yahoo's `week=N` matchup page
   (14a), a chatbot model that runs (14b), a ratings join and the gate tie (14c), and a move
   rule that withholds only moves that could lose, with a lower bar for add-only moves (14d,
   `MODEL_VERSION` 4). Then `MODEL_VERSION` 4 is frozen until the gate is read.

**Gate.** A rolling comparison per model version. Go to Phase 1 when one version, over at least
10 scored decisions, does at least as well as both the chatbot and doing nothing on categories
helped minus hurt, and Tony's mean rating for the tool is strictly higher than for both. A tie on
net counts when the ratings break it (Tony, 2026-10-24): a tool that rightly holds scores 0, the
same as doing nothing. Fewer than 10 scored decisions is "too
few, keep testing". If no version clears the gate by 2026-11-23, rethink or stop. Record the
result here and as a decision note in the vault.

**Improvement loop (Task 11b, later).** After about 2 weeks of logged decisions, a weekly report
computed in code counts rejection reasons and unscored causes per version and replays saved
decisions with one tunable value changed. It suggests changes and never makes them: Tony picks a
change, it lands as a PR that bumps `MODEL_VERSION`, and the scorecard shows whether the new
version does better.

### Phase 1: better numbers

- Projections from this season's game logs, with the 2025-26 backtest
  ([Task 01](tasks/01-nba-data-and-projections.md), remaining steps). Minutes arrive in Phase 0
  (step 5c); this adds per-minute rates, spread and the backtest.
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

A `npm run check:raw <dir>` script that runs each page parser on a saved refresh on its own and
prints ok or the error, without page text. It would replace the scratch script used on
2026-10-21 to check parser changes against a real capture before opening a PR.

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

**2026-10-24, scope audit.** No paired, scored decision exists yet. Four causes: the 21:13
decision saved banked shooting as null, so every arm is unscorable; the chatbot model is
rejected on Tony's account; ratings in `local/pilot-reviews.jsonl` never reach the scorecard;
and a holding tool ties doing nothing on net, which the gate counted as a loss. Since the rate
gate landed, real runs were withheld by the 0.15 threshold rather than by risk. On 10-23 the best
pair was positive in all 24 cases (+0.080 to +0.382). Tony approved Task 14 with a net tie broken
by ratings and a lower add-only bar. Frozen, not extended, until the gate: the stream planner,
the transaction history archive, the draft pages and the ad hoc research scripts.

**2026-10-24, Task 14a merged (#42).** A refresh also saves the `week=N` matchup page as
`matchup-totals.txt`, and the snapshot takes banked makes and attempts from it. On the 10-24
capture, both teams get all four values. 188 tests pass. A live refresh that fetches the new page
hasn't run yet. Next: 14b, after Tony picks the chatbot model.

**2026-10-24, Task 14b merged (#43).** The chatbot arm runs on `gpt-6-sol` at medium effort as
prompt version 2; `gpt-6.1-sol` is still rejected on Tony's account. A real run on the 10-24
packet returned a valid HOLD once `-c windows.sandbox="elevated"` restored file reads. That entry
was validated but not recorded. Next: 14c.

**2026-10-25, Task 14c merged (#44).** Ratings in `local/pilot-reviews.jsonl` now reach the
scorecard, and a net tie with doing nothing counts as a tie broken by ratings, not a loss.

**2026-10-25, Task 14d merged (#45).** `advise` moves when a pair has no missing rates, every case
is above 0 and the nominal score reaches the bar: 0.15 with a drop, 0.05 add-only. Among qualifying
pairs it picks the highest nominal score. `MODEL_VERSION` 4. On the 10-23 snapshot (decision
`1d9f5a61`) it now moves: 27 pairs qualify, and the pick gains +0.287 nominally (+0.108 to
+0.325). Tony settled the two open questions and kept the code as merged:

- A pair with missing per-minute rates stays `insufficient` even when every computed case is
  positive, because the rate case that could go negative was never run.
- The highest nominal score wins among qualifying pairs, not the best worst case. The
  all-cases-positive filter already covers the downside.

Next: `MODEL_VERSION` 4 stays fixed from its first refresh (target 2026-10-27), and every refresh
after that runs the daily pilot routine.

**2026-10-25, first v4 refresh.** The 14:30 capture gave decision `01375bd1`: hold, no adds left
in week 1. No pilot entries were recorded for it. Two findings:

- Tony confirmed that a Sunday add takes effect Monday and counts against the next week's adds,
  which settles the Task 10 open question (`--adds-week effective`). `advise` scores only the
  current matchup week, so on the last day of a week it can't score a move effective the next
  day. A week rollover (next week's dates and opponent from the `week=N+1` matchup page, zero
  banked, a fresh add budget) would change recommendations, so it needs `MODEL_VERSION` 5. Tony
  deferred it.
- Today's `week=1` matchup page has no FGM/A or FTM/A columns, though the 10-24 capture had them,
  so FG% and FT% were unknown. Check the week 2 page on the next refresh.

**2026-10-24, empty-slot pickups.** PRs #32, #37 and #38 are merged. The 2026-10-24 21:13
refresh held with "No eligible add/drop pairs": an IL move opened a spot, but `advise` only
scored drops, and the guardrail blocked every one. Task 12 adds add-only moves and next-week
context (`MODEL_VERSION` 2). On that snapshot it now holds for the right reason: the best add-only
move gains 0.017 expected categories. The pickup Tony wanted gains 0.002 this week from one
Sunday start and shows 3 games and 3 legal starts the next week. Task 12 is merged (#39). Next: the
daily pilot routine.

**2026-10-24, pending claims.** Task 13 reads pending waiver claims from the team page. On the
21:13 capture, two add-only claims need 2 adds and 2 open spots but Tony has 1 of each, so the
report now warns that the second claim may fail and holds with no adds left after the claims.
Task 13 is merged (#40). Next: the daily pilot routine.

**2026-10-24, continuous pilot.** Tony dropped the frozen 2-week pilot: it waited on a real move
he accepts, and every real run so far has been hold or insufficient evidence (latest: decision
`1d9f5a61` on the 2026-10-23 22:19 refresh). Step 5d is now a continuous pilot scored per model
version, with a rolling gate (above) and a 2026-11-23 rethink date. Tasks 08 and 09 are merged
(#30, #31). PR #32 (ESPN DNP flags) passes 154 tests and waits for Tony. Task 11a (versioned
scorecard, PR #37) and Task 10 (stream-chain planner, PR #38) are open for review. The first
real planner run (week of Oct 26) reserves an add because 21 free agents rank inside
`protectRank` under some minutes or rate case. It finds 5 starts from 3 adds (6 from 4 with
`--adds-week transaction`), not the hand plan's 7, because Monday has only SF and F open and
Wednesday has none. Next: Tony reviews #32, #37 and #38. After #32 merges, every refresh runs
the daily pilot routine (refresh, `refresh:analyze`, `pilot:prepare`, chatbot arm, three logged
entries, Tony's ratings). Open: whether the any-case `protectRank` hold rule is too loose this
early in the season.

**2026-10-23, stream-chain spec.** Wrote [Task 10](tasks/10-stream-chain-planner.md) from a manual
plan for the week of Oct 26 (back-to-backs: BOS Mon–Tue, ATL/CLE Wed–Thu, CHA/HOU/MIN/PHI Fri–Sat;
7 games from 4 adds). Tony's rule: schedule efficiency never pushes a long-term pickup down the
list. Hold candidates (an `advise` move or insufficient-evidence pickup, or inside `protectRank`
under any minutes or rate case) are listed first and reserve an add. Not built. Open question:
which week Yahoo counts a Sunday add for a Monday game against.

**2026-10-23, rate shrinkage.** The observed per-minute endpoint is now shrunk toward the
prior with the minutes blend's k pseudo-games: `(k * prior per-game + observed totals) /
(k * prior MPG + played minutes)`. The raw rate stays descriptive as `observedPerMinute`.
A new test shows one modestly strong drop game no longer withholds a move; the extreme-game
test still withholds. On the saved October 22 capture the result stays insufficient: every
top pair drops the center Tony agreed to withhold, while most pickup-only rate cases now clear.
150 tests pass. k remains uncalibrated (Task 01 backtest).

**2026-10-23, combined verification and outcome review.** Tasks 08/09 pass 153 tests together, including rate shrinkage.
Tony accepted withholding the historical drop as insufficient evidence. Acceptable real move
and hold examples, fresh Yahoo data and the pilot freeze remain pending. The shared ESPN/Yahoo
rehearsal packet was generated and its input hashes checked. No pilot or background watch was
started. Task 09 depends on Task 08; both were merged in #30 and #31.

**2026-10-23, rate disagreement check.** Task 08 adds observed per-minute production as an
additional sensitivity endpoint for both pickup and drop, crossed with minutes and missing
production. Nominal rates remain prior-season rates; estimated usage stays descriptive. This
chooses the conservative withholding option from the rejected 5a review. The saved October 22
capture now yields insufficient evidence, not the rejected move (stale-data rehearsal only).
149 tests pass, including the failing-before regression. The rate endpoints stay fixed and
uncalibrated; a complete rate model remains later work. Real outcome review and pilot freeze
are still pending. The pilot prompt also needs the ESPN evidence available to the tool.

**2026-10-23, lineup replay and pilot preparation.** Task 09 implements source-specific saved
legal starts, banked production and lineup-aware replay for the tool, chatbot and no-move
baseline. Missing evidence is unscored. Category changes use the saved no-move/opponent
counterfactual, not later actual totals that may include unrelated changes. Rehearsal packet
preparation supplies the same Yahoo/ESPN inputs to both arms and verifies hashes; it does not
freeze or start the pilot. Real outcome reviews remain pending. A fresh Yahoo read was stopped
on a Sign in link, per the read-only workflow; no login was attempted.

**2026-10-23, refresh workflow and limitations.** Added `docs/limitations.md` as the ongoing
register of observed evidence, projection and workflow limits. `refresh:analyze` processes an
explicit saved capture through snapshot, logs, transaction/evidence reporting and advice,
with compact output and private step logs. Newly archived transactions appear first in the
evidence report. Claude collection is configured for Haiku; all arithmetic runs in Node.
Codex model routing remains host-specific; token savings have not been measured. This does
not change projections or resolve the pre-pilot rate-model decision.

Tony chose on-demand refreshes after completed game slates, not a daily scheduled watch.
Review watched players during that refresh, using current-season sample sizes and the prior
capture. If present, read `local/trade-watch-status.json` for user-reported trade/watch state
and `local/recovery/` for preserved interrupted assessments. These are private local inputs,
not files available merely by pulling the public repository. A new checkout must capture
its own data or receive those inputs privately; do not reconstruct them from public docs.

**2026-10-23, merge checkpoint.** Decision records (#24), current-season minutes (#25) and
descriptive player evidence with observed transaction history (#27) are merged. PR #28 adds
read-only draft and draft-results pages for trade research Tony requests, alongside the already
allowed team rosters. Routine refreshes still use the same pages. The full suite passes 145 tests.
The earlier draft evidence implementation (#26) is superseded by #27, which also handles box-score
groups without athletes.

The scored pilot has not started. Next: resolve the per-minute-rate decision from the rejected
5a move below, then review real hold and insufficient-evidence outcomes before freezing the
pilot settings and chatbot prompt. Merged implementations do not satisfy that review gate.

**2026-10-22, 5a review: the "move" example is bad.** On the 22:28 snapshot (decision
`4a5175ae`), advice said to drop a starting center who played 30 minutes with a strong line in
his only game (14 REB, 5 AST, 3 BLK), for a bench forward on waivers. The move cleared the
hold threshold in all four minutes cases, so the minutes check worked. The cause is the
per-minute rates: they're still last season's, so the drop's strong game counts only as more
minutes. Tony's ruling: hold. One strong game at 30 minutes should not be overruled by last
season's per-minute rates. Open decision before the pilot: bring per-minute rate updates
forward from 5f, or withhold a drop when the player's season per-minute production beats the
prior and few games are observed. Hold and insufficient-evidence examples still need review.

**2026-10-22, player evidence and transaction history.** `npm run evidence` reports season and
last-seven-day production from ESPN box scores for my roster, the opponent and the first 100
available players: minutes, starts, shot volume, true shooting and an estimated USG%, with
games observed. It also appends each transaction group seen in a saved snapshot to a private
history, once. Yahoo stays the source for rosters, availability and transactions. The report is
descriptive: usage doesn't change recommendation scores.

**2026-10-22, steps 5b/5c implemented for review.** Decision records are in draft PR #24.
The dependent minutes implementation uses two prior pseudo-games, retains DNP reasons and
starter flags, and feeds the blended lines to scoring, lineup order and season protection.
Tony chose fixed prior/season minutes endpoints; the earlier convergence and guaranteed
five-game-move claims are removed. Source-check coverage supplies log freshness, including
off-days. Per-minute rates and calibrated weights remain deferred. The scored pilot has not
started, and review of the real 5a outcomes is still pending.

**2026-10-22, step 5c revised.** Reviewed Codex's projection plan after the 10-21 run kept
valuing a player by last season's 19.7 MPG after a 30-minute start. Kept per-minute rates in 5f
and made 5c concrete: pseudo-game minutes blend with `k = 2`, DNP rule from real ESPN reasons,
and a four-way minutes check that returns "insufficient evidence" when one game could reverse a
move. Order unchanged: Tony reviews the 5a outcomes, then 5b, then 5c.

**2026-10-22, step 5a built.** Advice no longer counts a start with no projection as zero
(#23). It scores those starts at zero and at a strong rotation line (90th percentile of the top
150 priors, 10th percentile TO) for both teams. It recommends a move only if the move clears the
hold threshold in all four scenarios. When only the best case clears it, the new "insufficient
evidence" outcome names the players with missing starts. On the 2026-10-21 snapshot, 4 unknown
starts on my side still left a move (score 0.543 to 0.587). The matchup parser now reads pages
captured before that day's games tip off (#22). Next: Tony reviews a real example of each outcome
(move, hold, insufficient evidence); the 10-21 run supplies the move. Then 5b.

**2026-10-22, plan for step 5.** Reviewed an outside plan (Astra) against the code. Two real gaps:
a start with no projection counts as zero, so dropping an unprojected stream player looks like a
gain, and the bakeoff counts every game the pickup and drop played instead of the games they
started. Step 5 is now six items: missing production, decision records, a minutes blend that also
feeds the guardrail, the frozen 2-week pilot, lineup-aware scoring built during the pilot, and
per-minute rates after it.

**Checkpoint (2026-10-20, step 4 done).** Phase 0, step 5 of 5. Step 4 merged (#10 to #14):
the report now gives one best move or "hold", fills legal daily lineups, rebuilds banked FG%/FT%
volume from game logs (or marks them unknown), refuses a stale snapshot, reads core and stream
roles from `local/roles.json`, and the bakeoff scores helped and hurt against "no move". The
first live run matched the opponent's volume. Mine came back unknown because the snapshot was
taken mid-game; a refresh after the night's games should match. Still needed before the pilot:
write `docs/bakeoff-prompt.md`, pick the chatbot, mark roles in `local/roles.json`, get Tony's OK
on the advice output, and build the transactions parser once the league has a real move. Gate
not yet run.

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

**2026-10-19, schedule and IDs.** Task 01 steps 2 and 3 and Task 02 step 6 done, written by Codex
(Luna) and reviewed here: `data/schedule-2026-27.json` (ESPN, 80 of 82 games per team until the NBA
Cup is set) and `data/ids.json`. The playoff-week check passes, and 123 of 126 players in the Yahoo
snapshot map. Game logs and the bakeoff scripts are in a separate PR. Next: Task 05 v0 advice, from
the needs design in that task file.

**2026-10-20, v0 advice and guardrail.** Merged: NBA game logs and the bakeoff scoring script
(#5), Yahoo status `P` with a hard failure on unknown status codes (#6), v0 add/drop advice that
reads week dates from the matchup page (#7), and a season-value guardrail (#8). The first v0 run
suggested 4 drops, and Tony judged all 4 bad: each swapped a core player for a streamer. The
guardrail now protects the top 120 by season value and every roster player with no prior, and
requires the pickup's season value to be at least the drop's plus `--margin`. On the same snapshot
only one suggestion is left (a bench big ranked #161 for a pickup ranked #104), which Tony also
called bad. PR #8 was written by Codex (Sol), reviewed by Claude and by Codex's reviewer, and
passes 67 tests. The transactions page still had no moves, so its parser waits on branch
`fix-transactions-parser`. Next: Tony reruns `npm run advise` and decides on `--margin` or
protecting that player; move the protected list to a git-ignored `local/protected.json`; write
`docs/bakeoff-prompt.md` and pick the chatbot; then start the 2-week bakeoff. Build the
transactions parser when "retry transactions fetch" finds a real move.

## Open decisions

- Whether next-week value should ever change a recommendation (2026-10-24). Today it is context
  only. The case for it: an add left at week's end expires, and an open spot costs nothing. It
  depends on which week Yahoo charges a Sunday add to (`--adds-week`), on a bar the pickup must
  clear against next week's options, and on scoring next-week value apart from this week's
  categories. Decide after the pilot has a few cases like this one.

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
- The chatbot used for the bakeoff baseline, and its fixed prompt. The pinned `gpt-6.1-sol` is
  rejected on Tony's ChatGPT account (2026-10-24); Tony picks a replacement in Task 14b.
