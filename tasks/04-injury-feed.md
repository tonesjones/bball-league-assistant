# Task 04: Official injury report feed

**Later, nice-to-have.** The Yahoo app already shows which of Tony's players are injured, so this
waits until Phases 0 to 2 in [`PLAN.md`](../PLAN.md) are done. Independent of Yahoo.

## Goal

Within 15 minutes of an NBA injury status change, a phone alert for any player who matters to Tony: his roster, this week's opponent's roster, and his waiver targets. Each alert names the player, the old and new status, the reason and the game.

## Source

The NBA's official injury report ([official.nba.com/nba-injury-report-2025-26](https://official.nba.com/nba-injury-report-2025-26/)). Teams must file statuses by 5 p.m. local the day before a game and again on game day; the league publishes a new PDF about every 15 minutes at:

```
https://ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MMAM.pdf
https://ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MMPM.pdf
```

Times are US Eastern, 12-hour, in 15-minute steps. Each row: game date, game time, matchup, team, player, current status (Out, Doubtful, Questionable, Probable, Available), reason. Add the source and its terms to `docs/sources.md`.

## Steps

1. **Fetch.** `src/sources/nba-injury-report.mjs` builds the URL for the latest 15-minute slot, walks back up to 8 slots until one exists (HEAD request, then GET), and caches each PDF in `local/injury-reports/`. One request per slot, never in a tight loop.
2. **Parse.** Extract rows into `{ gameDate, gameTime, matchup, team, player, status, reason, reportTime }`. The PDF wraps rows across lines and repeats the game and team only on the first row of each group, so carry them down. A PDF text library is allowed for this task (for example `pdfjs-dist`); record the choice in the PR.
3. **Normalize.** Names in the report are "Last, First". Convert to the same normalized form as Task 01's name normalizer and map to `data/ids.json`. Unmatched names go to a report, never dropped.
4. **Diff.** `src/engine/injury-diff.mjs`, pure: given the previous and current parsed reports, return changes: new player listed, status changed, removed from the report. Treat a player disappearing from the report before his game as "no longer listed", not "available".
5. **Filter.** Keep changes for players in `config/watch.json` (generated later from Yahoo state by Task 02: Tony's roster, his opponent's, his targets). Until Task 02 lands, `config/watch.json` is a hand-edited list of names.
6. **Alert.** `scripts/injury-watch.mjs` runs fetch, parse, diff, filter, and sends each kept change to an ntfy topic (`NTFY_TOPIC` in `.env`) with a one-line message, for example: `Jalen Duren (DET vs CHI, 7:00 PM ET): Questionable -> Out. Ankle sprain.` It stores the last parsed report in `local/` so a restart does not resend old changes.
7. **Schedule.** Document how to run it every 15 minutes: GitHub Actions cron, or Windows Task Scheduler on Tony's PC. Note that GitHub's scheduled runs can start several minutes late.

## Done when

- [ ] The parser passes on at least three real past PDFs saved to `tests/fixtures/injury-reports/` (these are public league documents, safe to commit), including one with a multi-line reason and one with several games: every row's team, player and status match the PDF.
- [ ] The diff tests cover: newly listed, upgraded, downgraded, removed, and an unchanged report giving no changes.
- [ ] Running the watcher twice on the same report sends nothing the second time.
- [ ] A missing slot (404) walks back to the previous one; five failed fetches in a row send one "injury feed down" alert, not one per run.
- [ ] Every player name in the three fixture PDFs maps to `data/ids.json` or is listed as unmatched.
- [ ] No request goes to the NBA site more often than once per 15-minute slot per run.
