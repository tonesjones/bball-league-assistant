# Task 19: trade evaluator

Requested by Tony on 2026-10-25. Needs Task 18. Adds a new command and doesn't change `advise`,
so `MODEL_VERSION` stays the same. Two PRs: capture (19a), then scoring (19b).

Tony settled the open questions on 2026-10-25; see "Decisions" at the end.

## Problem

Nothing scores a trade. ChatGPT can suggest names, but its arithmetic can't be trusted or scored
(AGENTS.md rule 2). The snapshot only holds Tony's team, this week's opponent and free agents.

## 19a: other teams' rosters

- On request only (`--trades`), the refresh also saves each other team's page `/{L}/{N}` as
  `teams/<N>.txt`. Team pages are already on the read-only list in `src/sources/yahoo-urls.mjs`,
  so the URL hook needs no change. A routine refresh doesn't fetch them.
- The snapshot gains `league.teams: [{ teamNumber, roster }]`, parsed with the existing team
  parser. Team and manager names stay in `local/`.
- `docs/update-league.md` lists the extra pages and when to fetch them.

## 19b: scoring

- `npm run trades [-- --with N] [--give <name>] [--get <name>]` scores 1-for-1 and 2-for-1 trades
  in both directions. A trade that leaves Tony short of roster spots also names his best drop.
- Pure logic in `src/engine/trades.mjs`. For each trade it reports:
  - Tony's change in rest-of-season category value, and in expected categories won this week
    against the current opponent, from the same projections and legal lineups as `advise`,
    including the Task 18 crunch;
  - the partner's change in rest-of-season category value, weighted by their team's category
    needs, as a sign of whether they might accept;
  - each category's change, and the as-of time.
- Ranks by Tony's gain among trades where the partner's change is not negative. Shows at most
  10 trades.
- Guardrails: never offer a protected or core player; never target a player who is out with no
  return timeline; mark a category unknown when a line is missing and leave it out of the score.
- The Task 17 brief adds the top trades, and its prompt asks ChatGPT for news on those players
  instead of inventing trades.

## Done when

- [ ] 19a: a synthetic team page parses into `league.teams`; a routine refresh fetches no team
  pages.
- [ ] 19b: a synthetic trade that helps Tony and hurts the partner is excluded; one that helps
  both is ranked.
- [ ] Protected, core and out-with-no-timeline players never appear.
- [ ] A 2-for-1 that overfills Tony's roster names a drop; with no legal drop it is excluded.
- [ ] `npm test` passes.

## Decisions (Tony, 2026-10-25)

- Horizon: rest of the regular season, weighted toward the playoff weeks.
- Partner acceptance: the trade must favor Tony, and the partner must get a meaningful
  incentive by their own needs, such as filling a position where their roster is short.
  "Partner doesn't lose value" alone isn't enough.
- Scope: 1-for-1 and 2-for-1 first. 2-for-2 is out of scope for now.
