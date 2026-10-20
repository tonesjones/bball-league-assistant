# Task 02: Yahoo league state

Phase 0. See [`PLAN.md`](../PLAN.md).

## Goal

A single, validated snapshot of league state that the engine reads, built from Yahoo pages read on
demand in a browser Tony is already signed in to. No Yahoo API, no pasting.

## Background

Since 22 July 2026, Yahoo returns HTTP 403 on Fantasy API endpoints for any app not approved
through its access program, which needs an application, an email exchange and an NDA. Tony isn't
pursuing it. Pasting pages by hand every day was the fallback, and it's too much effort. So an agent
reads the pages instead, and code parses them.

## How a refresh works

1. Tony says "update league" in Claude Code.
2. An agent (Haiku or Sonnet if a subagent can drive the browser tools, otherwise the main session)
   opens each page below in the signed-in browser, reads its text with the browser's page-text
   tool, and saves it unchanged to `local/raw/<YYYY-MM-DD-HHmm>/<page>.txt`. It doesn't interpret,
   summarize or edit anything.
3. `scripts/build-snapshot.mjs` parses the newest raw folder and writes
   `local/snapshots/<timestamp>.json`.

If Yahoo shows a sign-in page, the agent stops and tells Tony. It never signs in or enters
credentials. One read per page per refresh: no loops, no retries faster than a minute apart.

## Pages

Record each page's URL pattern (with the league and team IDs as placeholders) in
`docs/sources.md`. The real IDs go in `.env` (`YAHOO_LEAGUE_ID`, `YAHOO_TEAM_ID`).

- **League settings**: categories, roster positions, max adds per week, games cap, playoff weeks,
  scoring type. Read at setup and when the parser finds the settings missing.
- **Tony's team**: roster with positions, status and slots.
- **This week's matchup**: the opponent, both rosters, banked category totals.
- **Free agents**: Yahoo's available-players list, as many pages as needed to cover the top 100
  or so, with each player's team and status.
- **Transactions**: adds, drops, trades, winning FAAB bids. Gives adds used this week and waiver
  clear times.

That's about 5 to 8 page reads per refresh.

## Steps

1. **Fetch instructions.** Write the agent's steps in `docs/update-league.md`: page list, save
   paths, the sign-in stop rule. Short enough for Haiku to follow without judgment calls.
2. **First real fetch.** Run it once by hand, save the raw text in `local/raw/`, and confirm each
   page's text contains what the parser needs. Note any page that loads data after the first render.
3. **Schema.** `src/sources/league-state.mjs` defines the snapshot: settings, Tony's team (adds
   used this week, FAAB balance), rosters (Tony's and the opponent's: name, team, positions,
   status, slot), this week's matchup and banked category totals, free agents and waiver players
   with clear times, transactions. Include `validate(snapshot)` and an `asOf` timestamp.
4. **Parsers.** One per page in `src/sources/yahoo-pages/`, pure (text in, data out). Together they
   build the snapshot. A page whose text doesn't match the expected layout throws with the page
   name and the line that broke. Never a partial snapshot.
5. **Fixtures.** Real raw text stays in `local/` (git-ignored). For tests, write synthetic page
   texts with made-up names in `tests/fixtures/yahoo-pages/`, matching the real layout.
6. **ID map.** Match every rostered and free-agent player to `data/ids.json` (Task 01) by
   normalized name and team. List unmatched players.

## Done when

- [x] `docs/update-league.md` exists, and a refresh following it produces raw text for every page.
- [ ] Parsers build a valid snapshot from a real refresh (kept in `local/`) and from the synthetic
      pages in `tests/fixtures/yahoo-pages/`.
- [ ] A changed or unknown page layout fails loudly with the page and line, never a partial snapshot.
- [ ] `validate()` passes on the real and synthetic snapshots, and rejects one with a missing
      roster or settings.
- [ ] Rosters and matchup totals in the snapshot match what the Yahoo app shows at the same time.
- [ ] Every rostered player maps to `data/ids.json`, or is listed as unmatched.
- [ ] Nothing league-identifying is committed (`git grep` for the league ID and team names comes
      back empty).

Later (Phase 1): a replay test that rebuilds this week's category totals from box scores (Task 01)
and matches the Yahoo matchup within rounding.
