# yahoo-pages

## Overview

Parsers that turn the saved text of Yahoo Fantasy Basketball pages into plain data. `buildSnapshot` in `index.mjs` runs each parser and combines the results into one league snapshot. Every parser rejects a signed-out page and throws on a layout it has not seen, rather than guessing.

## Interface

- `index.mjs:buildSnapshot(pages, asOf)`: takes page text keyed `settings`, `team`, `matchup`, `transactions`, `fa-N`, and optionally `matchup-totals` and `teams/N`. Returns `{asOf, settings, team, matchup, freeAgents, transactions, league?}`, where:
  - `matchup` is rebuilt as `{week, start, end, opponentName, totals, volume, score, opponentRoster}`, with ISO `start` and `end` dates. It drops the parser's `days`, `teamName` and `roster`.
  - each free agent gets a 1-based `rank` across the `fa-N` pages in page order.
  - `league` is `{teams: [{teamNumber, roster}]}`, sorted by team number.
- `settings.mjs:parseSettings(text, page?)`: returns `{scoringType, categories, rosterPositions, maxAddsPerWeek, maxGamesPerWeek, waiverType, playoffs, raw}`.
- `team.mjs:parseTeam(text, page?)`: returns `{name, rank, record, faabBalance, addsUsedThisWeek, pending, roster}`.
- `team.mjs:parseOtherTeam(text, page)`: returns `{name, roster}` for another team in the league.
- `matchup.mjs:parseMatchup(text, page?)`: reads both the live layout and the totals layout. Returns `{week, days, teamName, opponentName, totals, volume, score, roster, opponentRoster}`.
- `free-agents.mjs:parseFreeAgents(text, page?)`: returns an array of `{name, nbaTeam, positions, status, waiverClears}`.
- `transactions.mjs:parseTransactions(text, page?)`: returns an array of `{team, time, moves: [{player, nbaTeam, type, faab}]}`.
- `common.mjs`: shared helpers and constants used by the parsers: `load`, `rejectSignedOut`, `end`, `fail`, `indexOf`, `stopIndex`, `player`, `num`, `SLOT_RE`, `NAME_RE`, `TEAMPOS_RE` and `CATEGORIES`.

## Invariants

- `buildSnapshot` throws if the `settings`, `team`, `matchup` or `transactions` text is missing, or if no `fa-N` page is supplied.
- `buildSnapshot` throws if the matchup page's team name differs from the team page's name, or if the `matchup-totals` page's week, team or opponent differ from the matchup page.
- `buildSnapshot` drops any `teams/N` page whose team name matches your own team.
- `buildSnapshot` returns only a snapshot that passes `validate` from `../league-state.mjs` (see [the sources README](../README.md)).
- The live matchup layout reports `null` for every shooting `volume` field. Without a `matchup-totals` page the snapshot has no shooting volume. With one, its volume replaces the live one.
- The private `isoDay` in `index.mjs` takes the year from `asOf` and moves it one year forward or back when the month is more than six months away.
- `common.mjs:rejectSignedOut` throws "signed out of Yahoo" when the page shows a "Sign in" line.
- `common.mjs:player` throws when a name ends in a capital letter other than II, III, IV or V, which it reads as an unknown status code. `common.mjs:num` accepts only a number or `-`, which it reads as `null`.
- `settings.mjs:parseSettings` throws on an unknown scoring type or stat category, on empty categories or roster positions, on a bad limit, and on a playoffs format it does not recognize.
- `matchup.mjs:parseMatchup` requires player rows to come in pairs (yours, then the opponent's) with exactly 9 stat cells. Only your row carries a slot label, and the opponent's row takes the same slot. In the totals layout, a slot label on the opponent's row throws, rows in the `--` slot are left out of both rosters, and empty-slot rows skip the 9-cell check.
- `team.mjs:parseTeam` throws if the W-L-T record, the weekly adds line or the waiver budget is missing or malformed. `parsePending` throws when the listed pending items exceed the stated count.
- `free-agents.mjs:parseFreeAgents` throws when it finds no player rows.
- `transactions.mjs:parseTransactions` throws "... not found" when the "Recent Transactions" heading or "FAB Offers" tab is missing, and "transactions layout not seen yet" on any other shape it does not recognize.

## Side Effects

- None. The parsers do no file, network or global I/O, and `buildSnapshot` returns a new object.

## Verification

- Run: `npm test` (see `tests/yahoo-pages.test.mjs` and `tests/build-snapshot.test.mjs`).
