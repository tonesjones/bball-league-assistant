# PLAN

This repo holds a nightly check for one Yahoo head-to-head, 9-category fantasy basketball league.
Code computes the numbers, Claude decides by following [`docs/league-playbook.md`](docs/league-playbook.md),
and Tony makes every move. The trial of the earlier recommendation engine, and the plan that ran it,
are in [`tasks/archive/PLAN-2026-11-14.md`](tasks/archive/PLAN-2026-11-14.md).

## Status (2026-11-15)

The engine is retired and deleted. Tony says "update league". Claude captures the Yahoo pages in
Chrome, `npm run sheet` builds a facts sheet of numbers, Claude follows the playbook, and Tony gets
a three-line headline plus the full advice file. The one-week check runs until 2026-11-21.

## Decisions

| ID | Decision | Who and when |
|---|---|---|
| S1 | The trial failed the stop rule. The engine is retired from league checks. | Tony, 2026-11-14 |
| P1 | Code computes, Claude decides. The playbook tells Claude how to advise, code supplies counts, and Tony makes every move. | Tony, 2026-11-14 |
| D2 | Capture runs through the `yahoo-reader` agent in Claude in Chrome. | Tony, 2026-11-15 (revised) |
| N1 | Build the facts sheet now. The first test left per-player lines unchecked before counting errors showed. | Tony, 2026-11-15 |
| N2 | Claude in Chrome is the one browser path. The built-in pane was signed out on 2026-10-25, 2026-10-26, 2026-11-14 and 2026-11-15, and there is no fallback to it. | Tony, 2026-11-15 |
| N3 | The retired engine is deleted. Its history is in git and `tasks/archive/`. | Tony, 2026-11-15 |
| N4 | The journal's `did` field comes from the transactions page, so Tony fills in only `why`. | Tony, 2026-11-15 |

## Work

- [x] **Facts sheet (`npm run sheet`), this pull request.** *Done when:* it writes
  `local/sheets/<stamp>.md` from a capture folder, its tests pass, and the playbook cites each
  section.
- [x] **Playbook version 3, this pull request.** *Done when:* the playbook starts from the sheet,
  keeps the without-sheet path, opens its output with three headline lines and fills the journal's
  `did` from the transactions page.
- [x] **Retired engine removed, this pull request.** *Done when:* `npm test` passes and no doc
  outside `tasks/archive/` and decision history names a removed command.
- [ ] **The sheet reads `team-values.txt` (FAAB, adds used, pending claims).** *Done when:* the
  Budget section prints FAAB from a Chrome capture.
- [ ] **One-week check.** Tony uses the playbook for each decision until 2026-11-21 and saves one
  journal line per decision, noting anything it got wrong. *Done when:* on 2026-11-21 Tony decides
  to keep, change or drop it, and each recorded error is either fixed in the playbook or listed
  here as a calculator to build.
- [ ] **One-phrase nightly check.** *Done when:* Tony says "update league" once and gets the advice
  file and a journal line without a rescue.
- [ ] **Regression set.** *Done when:* three cases are saved and one full rerun is recorded. See
  [`docs/playbook-regression.md`](docs/playbook-regression.md).
- [ ] **Nightly update.** See [`docs/designs/nightly-update.md`](docs/designs/nightly-update.md).
  *Done when:* Tony receives an update three nights in a row without a rescue.

## Open decisions

- Whether MetaMuse relays the nightly update, and how it can receive one.
- Whether Yahoo's Fantasy API allows a personal read-only token. It is the only clean way for a
  cloud run to read the league. See "Ground rules" for why it was ruled out.
- The season pacing cap and the minimum bid.
- How a browser-only session gets the protected list, which lives in `local/protected.json`.

## Parked

- Opponent category profile from past weeks. Tony judges adds by what the opponent is strong at.
  It needs a new read-only page in `src/sources/yahoo-urls.mjs`.
- Team injury context. ESPN's injury feed lists who is out at a candidate's position, to judge
  whether a minutes jump will last.
- `npm run check:raw <dir>`: run each page parser on a saved capture and print ok or the error,
  without page text.

## Ground rules

`AGENTS.md` has the hard rules. These add the reasons behind two of them.

- **Read only, no Yahoo API.** Access needs an application, an email exchange and an NDA, and Tony
  decided not to pursue it. League data comes from Yahoo pages in Tony's signed-in Chrome, saved
  unchanged to `local/raw/`. Code computes every number on the facts sheet.
- **Claude builds and captures.** Claude is the only build, capture and analysis host (D2).

## Findings

