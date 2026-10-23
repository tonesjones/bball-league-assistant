# Data sources

Every outside source the tool reads, with its URL, terms and how we stay polite to it.

## Yahoo league pages

- **What:** Tony's league pages on Yahoo Fantasy Basketball, read in a browser he is signed in to.
  No Yahoo API (see [`PLAN.md`](../PLAN.md)).
- **Browser:** the built-in browser pane in the Claude desktop app. Tony signs in there himself;
  the sign-in persists between sessions. Firefox can't be driven by the agent's browser tools.
- **How:** [`update-league.md`](update-league.md). Read only, one read per page per refresh.
- **Terms:** Yahoo Terms of Service. Personal use of Tony's own league data, read at human pace
  from his own session. Nothing is submitted or changed.
- **IDs:** `{L}` is `YAHOO_LEAGUE_ID` and `{T}` is `YAHOO_TEAM_ID` from `.env`. `{OPP}` is the
  opponent's team number, read from the matchup page. Real IDs never go in git.

Base URL: `https://basketball.fantasysports.yahoo.com/nba`

| Page | URL pattern | What it has (checked on the first fetch, 2026-10-19) |
|---|---|---|
| Settings | `/{L}/settings` | Scoring type, roster positions, stat categories, max acquisitions per week, waiver type and time, playoff weeks, trade end date. A two-column `Setting<TAB>Value` table. |
| Tony's team | `/{L}/{T}` | Record, this week's opponent, waiver (FAAB) budget, roster with slots, positions, status and stats. |
| Matchup | `/{L}/matchup?mid1={T}` | Current week, category totals for both teams (live, and per day), both rosters' stats. |
| Opponent | `/{L}/{OPP}` | The opponent's roster, same layout as Tony's team. Not read by default: the matchup page lists both rosters with slots. |
| Free agents | `/{L}/players?status=A&pos=P&sort=AR&sdir=1&count={0,25,50,75}` | 25 available players per page, ranked, with team, positions, status and stats. Four pages cover the top 100. |
| Transactions | `/{L}/transactions` | Adds, drops, trades and winning FAAB bids. Empty before the first move ("No recent transactions"). |
| Other teams | `/{L}/{1..12}` | Each team's roster, same layout as Tony's team. Read only for trade research Tony asks for. |
| Draft | `/{L}/draft` | The league draft. Read only for trade research; no query parameters allowed. |
| Draft results | `/{L}/draftresults` | Each team's draft picks, for the draft cost of a player. Read only for trade research; no query parameters allowed. |

Notes from the first fetch:

- All pages had their data in the first render; no page needed an extra wait.
- The page-text tool omits button labels that the DOM's `innerText` shows, and turns non-breaking
  spaces into plain spaces. Parsers should normalize whitespace and not expect button text.
- Adds used this week isn't shown on the team page. Count it from the transactions page.

## NBA schedule, 2026-27

- **Pick:** ESPN's public site API, one request per team:
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{espnTeamId}/schedule?season=2027&seasontype=2`
- **Why:** free, no key, JSON with date, home and away team abbreviations. 30 requests fetch the
  whole regular season. Checked 2026-10-19: Golden State returned 80 games, Oct 22 to Apr 12. The
  2 missing games are probably NBA Cup games whose opponents aren't set yet; Task 01 step 2 should
  confirm and re-fetch after the Cup group stage.
- **Terms:** undocumented and unofficial. ESPN publishes no terms or rate limit for this API, and
  it can change without notice. Use it for personal, low-volume reads only: fetch the schedule
  once, cache it in `local/cache/`, and re-fetch at most weekly. Back off on 429 and 5xx.
- **ESPN team abbreviations** differ from the standard codes in places (`GS`, `SA`, `NY`, `NO`,
  `UTAH`, `WSH`). Map them to `GSW`, `SAS`, `NYK`, `NOP`, `UTA`, `WAS`.
- **Roster endpoint:** `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{espnTeamId}/roster`.
- Schedule dates are converted to the US Eastern calendar date of ESPN's UTC tip time.

Rejected:

- **NBA CDN** (`cdn.nba.com/static/json/staticData/scheduleLeagueV2.json`): the official
  schedule, but it returned HTTP 403 (Akamai "Access Denied") to a script, even with browser
  headers. Could be read through the browser pane if ESPN breaks.
- **balldontlie** (`api.balldontlie.io`): needs an API key (HTTP 401 without one), and the free
  tier is rate-limited.

## NBA game logs

- **What:** ESPN scoreboard and game summary box scores: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD` and `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={eventId}`.
- **Terms:** undocumented and unofficial. Personal, low-volume requests only; cache responses and back off on 429 and 5xx. Final game summaries are cached for a year.

For projection refreshes, check each scoreboard day once per requested refresh and reparse cached
final summaries to retain DNP reasons and starter flags. A coverage record stores the source-check
time, date range and daily file hashes only after every requested day succeeds. Empty checked
days are valid coverage. Missing days, an older check than the Yahoo snapshot or changed files
are refused by advice; a player's last appearance date alone is not a freshness measure.

### Descriptive usage and efficiency

Player evidence uses these same ESPN box scores, independent of Yahoo's player statistics.
Team totals must match the playing-athlete attempts and player turnovers before usage context
is retained; reported total team turnovers are used when provided. Recorded player minutes
are summed for team minutes, including overtime and their source rounding. Missing inputs
leave usage unknown.

Estimated USG% follows the box-score approximation documented by
[Basketball Reference](https://www.basketball-reference.com/about/glossary.html) and its
[publisher's glossary](https://faq.sports-reference.com/portal/en/kb/articles/basketball-glossary):
`100 * (FGA + 0.44*FTA + TO) * (teamMIN/5) / (MIN * (teamFGA + 0.44*teamFTA + teamTO))`.
Across games, sum the player's used plays and minutes-adjusted team-opportunity exposures,
then take their ratio; do not average game percentages. This estimate differs from official
NBA on-court possession USG%. The references supply definitions only; no Basketball Reference
data is scraped. True shooting uses `PTS / (2 * (FGA + 0.44*FTA))` on summed actual totals.
The `0.44` factor is an approximation. Usage and efficiency are descriptive and do not alter
the recommendation engine's prior per-minute rates.
