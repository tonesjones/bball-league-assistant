# Task 02: Yahoo league state

## Goal

A single, validated snapshot of league state that the engine reads, no matter how it was collected: Yahoo API, a pasted page, or (later) a bookmarklet.

## Background

Draft Lab's Yahoo app got intermittent HTTP 403 "This application is not authorized to perform this action" on 18 October 2026, with the same token and endpoints sometimes succeeding. Draft Lab requested `openid fspt-r`; this repo requests `fspt-r` only. Settle whether the API is usable before building on it.

## Steps

1. **Auth.** `scripts/yahoo-auth.mjs` runs the OAuth 2.0 authorization-code flow once with the existing Yahoo app's client ID and secret from `.env` (`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`), requesting scope `fspt-r` only. It stores the refresh token in `local/yahoo-token.json`. Document in the task notes which redirect URI worked.
2. **Probe.** `scripts/yahoo-probe.mjs` refreshes the token once, then calls each endpoint below 10 times, spaced at least 1 second apart, and writes status codes and error bodies to `local/probe-<timestamp>.json`. It prints a one-line pass/fail.
    - league settings (categories, roster positions, max adds, max games, playoff weeks, scoring type)
    - league standings and teams (including each team's FAAB balance)
    - each team's roster for today
    - this week's scoreboard (matchups and live category totals)
    - league transactions (adds, drops, trades, winning FAAB bids)
    - available players with status FA and with status W
3. **Diagnose if the probe fails.** Run the same calls through an independent client (for example the `yfpy` Python package) with the same app credentials. Record which one fails. If both fail, the problem is the Yahoo app's permissions, not this code.
4. **Schema.** `src/sources/league-state.mjs` defines the snapshot: settings, teams (id, name, FAAB balance, adds used this week), rosters (player key, name, positions, status, slot), this week's matchup and banked category totals, transactions, free agents and waiver players with their clear dates. Include a `validate(snapshot)` function and an `asOf` timestamp on every snapshot.
5. **Loaders.** All return the same schema:
    - `fromYahooApi()` for the API.
    - `fromPastedTransactions(text, previousSnapshot)` parses text copied from the Yahoo league transactions page and applies the adds and drops to the last snapshot. This is the fallback if the API stays blocked.
6. **Fixtures.** Save one full real snapshot to `local/fixtures/` (git-ignored). Build a small synthetic snapshot with made-up names in `tests/fixtures/league-state.json` for tests.
7. **ID map.** Add Yahoo player keys to `data/ids.json` by matching names and teams. List unmatched rostered or available players.

## Done when

- [ ] The probe passes: every call returns 200 across one full run. Or, if it does not, the diagnosis in step 3 is recorded at the end of this file and the paste loader is done instead.
- [ ] `validate()` passes on the real snapshot and on the synthetic one, and rejects a snapshot with a missing roster or settings.
- [ ] A replay test rebuilds this week's category totals from box scores (Task 01) for each team's started players and matches the Yahoo scoreboard within rounding.
- [ ] The paste loader passes a test on a synthetic transactions page with an add, a drop, a FAAB claim and a trade.
- [ ] Every rostered player in the league maps to a player in `data/ids.json`.
- [ ] Nothing league-identifying is committed (`git grep` for the league ID and team names comes back empty).
