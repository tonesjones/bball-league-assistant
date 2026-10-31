# Task 13: pending claims

Needs Task 12. Changes recommendations, so it bumps `MODEL_VERSION` to 3.

## Problem

The team page lists Tony's pending waiver claims and proposed trades under "Pending
Transactions", but the parser skipped the section. Advice could suggest a player Tony had already
claimed, and it counted adds and open spots that pending claims will use.

## Behavior

- `parseTeam` returns `pending: { count, waivers, proposedTrades, unlisted }`. It reads only
  shapes seen in real captures: `Waiver N (Mon D): Add X`, `... Add X, Drop Y` and
  `... Bid $B for X, Drop Y`, plus `You have proposed a trade to <team>`. An unrecognized
  `Waiver N` line fails the parse. Items in the count that the page doesn't list are `unlisted`.
- `advise` assumes pending claims go through. Claims dated on or before the matchup end use adds
  this week; add-only claims use open spots; claimed players aren't offered as pickups; pending
  drops aren't offered as drops. Claim production isn't added to the baseline.
- When the claims need more adds or open spots than Tony has, the report warns that Yahoo
  processes claims in waiver order and a later claim may fail.
- Proposed trades and unlisted items are reported, not modeled.

## Done when

- [x] The parser reads every pending shape in `local/raw` captures and refuses an unknown claim line.
- [x] Snapshots with `team.pending` validate; a bad shape fails.
- [x] Claims reserve adds and open spots; claimed players and pending drops aren't offered.
- [x] Over-claiming produces the warning; later-week claims don't use this week's adds.
- [x] `MODEL_VERSION` is 3 and `npm test` passes.
