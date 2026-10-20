# Update league

Steps for the agent that runs "update league". Follow them in order. Don't interpret, summarize or
edit what a page says: copy its text and save it.

## Before you start

1. Read `YAHOO_LEAGUE_ID` and `YAHOO_TEAM_ID` from `.env`. If either is empty, stop and ask Tony.
2. Make the folder `local/raw/<YYYY-MM-DD-HHmm>/`, using the current local time. Example:
   `local/raw/2026-10-19-2130/`. Save every page of this refresh in that one folder.
3. Use the browser Tony is signed in to (see `docs/sources.md`, "Yahoo league pages"). Open a new
   tab for the refresh.

## Rules

- **Sign-in page: stop.** If a page shows a Yahoo sign-in, "Sign in", password or verification
  screen, stop the whole refresh and tell Tony. Never type a username, password or code. Never
  click "Sign in".
- **Read only.** Open pages by URL. Don't click buttons, links that change anything, "Add",
  "Drop", "Trade", "Claim", "Start active players" or lineup controls. Close any pop-up by
  pressing Escape, not by clicking an option in it.
- **One read per page.** If a page fails to load, wait at least one minute before one retry. If it
  fails again, skip it, note it in `_log.txt`, and go on.
- **No changes to text.** Save exactly what the browser's page-text tool returns.

## Pages

Replace `{L}` with `YAHOO_LEAGUE_ID`, `{T}` with `YAHOO_TEAM_ID`. Base URL:
`https://basketball.fantasysports.yahoo.com/nba`.

| # | Save as | URL | Notes |
|---|---|---|---|
| 1 | `settings.txt` | `/{L}/settings` | Only at setup, or when the parser says settings are missing. |
| 2 | `team.txt` | `/{L}/{T}` | Tony's roster. |
| 3 | `matchup.txt` | `/{L}/matchup?mid1={T}` | This week's matchup. Shows the current week by default. |
| 4 | `opponent.txt` | `/{L}/{OPP}` | The opponent's roster. `{OPP}` is the opponent's team number. Read it from the matchup page's link to the opponent's team (`/nba/{L}/<number>`), or with a read-only page script that lists the page's links. |
| 5 | `fa-1.txt` | `/{L}/players?status=A&pos=P&sort=AR&sdir=1&count=0` | Available players, ranked. 25 per page. |
| 6 | `fa-2.txt` | same, `count=25` | |
| 7 | `fa-3.txt` | same, `count=50` | |
| 8 | `fa-4.txt` | same, `count=75` | |
| 9 | `transactions.txt` | `/{L}/transactions` | Adds, drops, trades and winning FAAB bids. |

For each page:

1. Open the URL in the tab.
2. Wait for the page to finish loading. If the main content (roster table, player list) is
   missing, wait 3 seconds once more.
3. Check for a sign-in screen (see Rules).
4. Read the page text with the browser's page-text tool. Ask for up to 200000 characters so
   nothing is cut off.
5. Write the text to `local/raw/<timestamp>/<save as>`.

## After the last page

Write `local/raw/<timestamp>/_log.txt` with one line per page: file name, the URL you opened,
and `ok`, `skipped` or `sign-in`. Then tell Tony the folder path and any page that wasn't `ok`.
