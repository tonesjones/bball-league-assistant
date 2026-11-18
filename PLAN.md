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
| C1 | Cloud sessions read the league's public pages signed out (`npm run capture:public`). Nobody signs in from the cloud and no password is stored; a sign-in test on 2026-11-17 found the account's sign-in offers only a password. FAAB is estimated from winning bids. Chrome stays the signed-in path (N2). | Tony, 2026-11-17 |

## Work

- [x] **Facts sheet (`npm run sheet`), this pull request.** *Done when:* it writes
  `local/sheets/<stamp>.md` from a capture folder, its tests pass, and the playbook cites each
  section.
- [x] **Playbook version 3, this pull request.** *Done when:* the playbook starts from the sheet,
  keeps the without-sheet path, opens its output with three headline lines and fills the journal's
  `did` from the transactions page.
- [x] **Retired engine removed, this pull request.** *Done when:* `npm test` passes and no doc
  outside `tasks/archive/` and decision history names a removed command.
- [x] **The sheet reads `team-values.txt` (FAAB only), this pull request.** *Done when:* the
  Budget section prints FAAB from a Chrome capture and names its source file.
- [x] **Watch list survives an unmatched rostered player, this pull request.** *Done when:* a
  rostered player with no ID match leaves the list in place, and the sheet prints one line naming
  the unmatched players.
- [x] **Injury report (sheet section 9), this pull request.** *Done when:* the sheet prints status,
  report date, return date and comment from ESPN's injuries feed for Tony's, the opponent's and
  the candidates' players, and prints UNAVAILABLE when the feed fails.
- [ ] **Cloud capture (decision C1), this pull request.** *Done when:* a new cloud session in
  Tony's Yahoo environment runs "update league" from `npm run capture:public` to the advice file
  without a rescue, and `npm test` passes.
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
- Whether Yahoo's Fantasy API allows a personal read-only token. The public capture (C1) now lets
  a cloud run read the league without it, except the exact FAAB balance and pending claims. See
  "Ground rules" for why it was ruled out.
- The season pacing cap and the minimum bid.
- How a browser-only session gets the protected list, which lives in `local/protected.json`.

## Parked

- Shorter Candidates section (Tony, 2026-11-17). The section is about half the facts sheet (26 KB of
  52 KB), all read by the main model each run. Filter it in code to rows with a usable start, a top
  25 rank in any window, a watch-list flag or a starter out on his team, plus a count of the rest.
  Revisit if the next few runs keep naming players Tony doesn't care about.
- Chrome capture of the signed-in team page only. Every page except Tony's team page reads the same
  signed out, so `yahoo-reader` could save just that page (FAAB, adds used, pending claims) and
  `npm run capture:public` the rest, about 28 pages fewer to copy by hand.
- Opponent category profile from past weeks. Tony judges adds by what the opponent is strong at.
  It needs a new read-only page in `src/sources/yahoo-urls.mjs`.
- `npm run check:raw <dir>`: run each page parser on a saved capture and print ok or the error,
  without page text.

## Ground rules

`AGENTS.md` has the hard rules. These add the reasons behind two of them.

- **Read only, no Yahoo API.** Access needs an application, an email exchange and an NDA, and Tony
  decided not to pursue it. League data comes from Yahoo pages in Tony's signed-in Chrome, saved
  unchanged to `local/raw/`. Code computes every number on the facts sheet.
- **Claude builds and captures.** Claude is the only build, capture and analysis host (D2).

## Findings

