# Task 17: ChatGPT brief

Requested by Tony on 2026-10-25. Codex runs the refresh and `advise`. Tony then pastes the result
into a ChatGPT chat window for context that code can't know: news, role and rotation changes,
and trade ideas. Doesn't change recommendations or scores, so `MODEL_VERSION` stays the same.

## Problem

The `advise` text is written for checking the engine, not for handing to a chatbot. Tony would
have to copy several files and explain the league each time. The pilot packet (Task 11) doesn't
fit either: it withholds the tool's recommendation so the scored chatbot arm stays blind.

## Behavior

- `npm run brief [-- <decisionId>]` reads a saved decision (default: the newest by `createdAt`
  in `local/decisions/`). It loads the snapshot, schedule and IDs through `decisionInputs`, so a
  changed input fails instead of being silently replaced. It makes no network calls.
- It writes one Markdown file, `local/briefs/<decisionId>.md`, and prints only its path. It
  refuses to overwrite an existing brief.
- Pure formatting lives in `src/engine/brief.mjs` (`buildBrief`), with no I/O. The script lives in
  `scripts/brief.mjs`.
- The prompt lives in `docs/chatgpt-brief.md` between `<!-- PROMPT START -->` and
  `<!-- PROMPT END -->` markers, with a `Brief prompt version: N` line. Changing the prompt text
  bumps that version. It is separate from `docs/bakeoff-prompt.md` and never used for the pilot.
- The prompt asks ChatGPT to:
  - treat every number in the brief as computed by the tool and not recompute or replace it;
  - for the tool's move and each alternative, look up news, injuries, minutes and role changes
    since the as-of time, and say whether any of them undercuts the move;
  - name drop candidates and pickups the tool may have missed, with the reason, flagged as ideas
    for the tool to score;
  - suggest trade ideas (who to offer, who to target, which categories they fix), flagged as
    unscored until Task 19 lands;
  - comment on the packed days in the daily games table;
  - state the date of every news item it uses, and say so when it can't verify something.
- The brief contains, in order:
  1. The prompt.
  2. Data as of: snapshot `asOf`, decision `createdAt`, brief time and the snapshot's age at that
     time, `MODEL_VERSION`, week and window, first date counted, adds left.
  3. Matchup: each category's mine, opponent, P(win) and need, as in `advise`. An incomplete
     category shows its range and "incomplete".
  4. The tool's call: move, hold or insufficient evidence, the reason, and for a move the
     pickup, drop, start date, score and each category's change.
  5. Alternatives: each top pair on one line with pickup, drop, games, score and category changes.
  6. My roster: name, NBA team, positions, slot, status, role (core, stream or neither) and
     games left from the first counted date to the week's end.
  7. Opponent roster: name, NBA team, slot, status and games left.
  8. Daily games: for each remaining date, the number of my players with a game who are outside
     IL slots and not blocked by status, against the league's active slot count, with "over by N"
     when the count exceeds the slots. A note says positional fit comes with Task 18.
  9. Free agents: the snapshot's list in page order, capped at 40 (`--fa N` changes the cap),
     with NBA team, status, waiver clear date and games left.
  10. Pending claims and proposed trades, and unscored players with their reasons.
- A missing value prints as "unknown", never 0. The brief holds no league ID or Yahoo URL.

## Done when

- [ ] `buildBrief` tests with synthetic fixtures cover: the prompt and its version, the as-of
  block, a move and a hold, games left per player, an over-slot day, and "unknown" for a
  missing value.
- [ ] The script refuses a changed snapshot hash and an existing brief file.
- [ ] Running it on the newest real decision writes a brief. The check prints the path and line
  count only, never the brief text.
- [ ] `docs/update-league.md` and `README.md` add the step after `advise`: run `npm run brief`
  and paste the file into ChatGPT.
- [ ] `npm test` passes.
