# Task 02: Yahoo league state

## Goal

A single, validated snapshot of league state that the engine reads, no matter how it was collected: Yahoo API, a pasted page, or (later) a bookmarklet.

## Background

Since 22 July 2026, Yahoo returns HTTP 403 "This application is not authorized to perform this action" on Fantasy endpoints for any app not approved through its access program ([apply](https://sports.yahoo.com/developer/access/); reports in [yfpy #84](https://github.com/uberfastman/yfpy/issues/84)). Draft Lab's app hits this. Approval is reported to take 2 to 7 weeks and sometimes needs a new app whose Client ID is sent back to Yahoo. Until it is approved, the API cannot be relied on.

So the build order inside this task is: the paste loader first (step 5b), the API loader only once a probe passes (steps 1 to 3 and 5a).

## Steps

1. **Auth (after approval).** `scripts/yahoo-auth.mjs` runs the OAuth 2.0 authorization-code flow once with the existing Yahoo app's client ID and secret from `.env` (`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`), requesting scope `fspt-r` only. It stores the refresh token in `local/yahoo-token.json`. Document in the task notes which redirect URI worked.
2. **Probe.** `scripts/yahoo-probe.mjs` refreshes the token once, then calls each endpoint below 10 times, spaced at least 1 second apart, and writes status codes and error bodies to `local/probe-<timestamp>.json`. It prints a one-line pass/fail.
    - league settings (categories, roster positions, max adds, max games, playoff weeks, scoring type)
    - league standings and teams (including each team's FAAB balance)
    - each team's roster for today
    - this week's scoreboard (matchups and live category totals)
    - league transactions (adds, drops, trades, winning FAAB bids)
    - available players with status FA and with status W
3. **If the probe fails** with 403 "not authorized", the app is not approved yet: record the date at the end of this file and stop work on the API loader. Any other error is a bug here.
4. **Schema.** `src/sources/league-state.mjs` defines the snapshot: settings, teams (id, name, FAAB balance, adds used this week), rosters (player key, name, positions, status, slot), this week's matchup and banked category totals, transactions, free agents and waiver players with their clear dates. Include a `validate(snapshot)` function and an `asOf` timestamp on every snapshot.
5. **Loaders.** All return the same schema:
    - (a) `fromYahooApi()` for the API, once approved.
    - (b) Paste loaders, built first. Tony selects all on a Yahoo page in his browser, copies, and pastes into `local/paste/<page>.txt`; `scripts/load-paste.mjs` parses whatever files are there:
        - `rosters.txt`: each team's roster page, pasted one after another (once at setup, then only when a trade happens).
        - `transactions.txt`: the league transactions page, which carries adds, drops, trades and winning FAAB bids. `fromPastedTransactions(text, previousSnapshot)` applies them to the last snapshot. Daily.
        - `matchup.txt`: this week's matchup page, for the opponent and banked category totals. Daily during the week.
        - `standings.txt`: standings, including FAAB balances if Yahoo shows them there; otherwise balances are derived as $100 minus winning bids from transactions.
      Free agents are derived: every player in `data/ids.json` minus rostered players. Waiver status comes from drop times in transactions.
6. **Fixtures.** Save one full real snapshot to `local/fixtures/` (git-ignored). Build a small synthetic snapshot with made-up names in `tests/fixtures/league-state.json` for tests.
7. **ID map.** Add Yahoo player keys to `data/ids.json` by matching names and teams. List unmatched rostered or available players.

## Done when

- [ ] The paste loaders build a valid snapshot from real pasted pages (kept in `local/`), and from synthetic pastes with made-up names in `tests/fixtures/paste/` for tests.
- [ ] Unrecognized paste formats fail loudly with the line that broke, never a partial snapshot.
- [ ] After approval only: the probe passes, every call returning 200 across one full run, and `fromYahooApi()` and the paste loaders give the same snapshot for the same day.
- [ ] `validate()` passes on the real snapshot and on the synthetic one, and rejects a snapshot with a missing roster or settings.
- [ ] A replay test rebuilds this week's category totals from box scores (Task 01) for each team's started players and matches the Yahoo scoreboard within rounding.
- [ ] The paste loader passes a test on a synthetic transactions page with an add, a drop, a FAAB claim and a trade.
- [ ] Every rostered player in the league maps to a player in `data/ids.json`.
- [ ] Nothing league-identifying is committed (`git grep` for the league ID and team names comes back empty).
