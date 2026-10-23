# Update league

Steps for the agent that runs "update league". Follow them in order. Don't interpret, summarize or
edit what a page says: copy its text and save it.

## Before you start

1. Read `YAHOO_LEAGUE_ID` and `YAHOO_TEAM_ID` from `.env`. If either is empty, stop and ask Tony.
2. Make the folder `local/raw/<YYYY-MM-DD-HHmm>/`, using the current local time. Example:
   `local/raw/2026-10-19-2130/`. Save every page of this refresh in that one folder.
3. Use the browser Tony is signed in to (see `docs/sources.md`, "Yahoo league pages"). Open a new
   tab for the refresh.

The `yahoo-reader` agent (`.claude/agents/yahoo-reader.md`) runs these steps. Use it rather than a
general agent.

## What is enforced

The browser is signed in as Tony, so the repo's Claude settings remove the ability to change
anything, rather than relying on the rules below alone.

| Layer | Where | What it stops |
|---|---|---|
| Tool deny list | `.claude/settings.json`, `permissions.deny` | Clicking, typing, form filling, page scripts and batched browser actions, for every session and agent in this repo. |
| URL allowlist | `.claude/settings.json` hook, `scripts/guard-yahoo-url.mjs` | Opening any yahoo.com page except the pages in this doc (the table below and the trade research pages), in Tony's league, over https. |
| Agent tool list | `.claude/agents/yahoo-reader.md` | The fetch agent has only: open a tab, open a URL, read page text, read page structure, read and write files. |
| Afterwards | Transactions page (Task 02 parser) | Flags any move on Tony's team that Tony didn't make. |

Allowed browser tools: `navigate`, `get_page_text`, `read_page`, `tabs_create`. To add a page,
add it to `src/sources/yahoo-urls.mjs` and its test, and say why in the PR.

## Rules

- **Sign-in page: stop.** If a page shows a Yahoo sign-in, "Sign in", password or verification
  screen, stop the whole refresh and tell Tony. Never type a username, password or code. Never
  click "Sign in".
- **Read only.** Open pages by URL and read them. Nothing else: no clicks, typing, key presses,
  forms or page scripts. If a pop-up covers the page, read the text anyway; if the text is
  missing, mark the page `skipped`.
- **Blocked means stop.** If a tool call is denied or a URL is blocked, don't try another way to
  reach the page. Mark it `skipped` with the reason and go on.
- **One read per page.** If a page fails to load, wait at least one minute before one retry. If it
  fails again, skip it, note it in `_log.txt`, and go on.
- **No changes to text.** Save exactly what the browser's page-text tool returns.

## Pages

Replace `{L}` with `YAHOO_LEAGUE_ID`, `{T}` with `YAHOO_TEAM_ID`. Base URL:
`https://basketball.fantasysports.yahoo.com/nba`.

| # | Save as | URL | Why it's needed |
|---|---|---|---|
| 1 | `settings.txt` | `/{L}/settings` | Categories, roster slots, adds per week, games cap, playoff weeks. Only at setup, or when the parser says settings are missing. |
| 2 | `team.txt` | `/{L}/{T}` | Tony's roster, slots, status and FAAB balance. |
| 3 | `matchup.txt` | `/{L}/matchup?mid1={T}` | This week's opponent, both rosters with slots, and banked category totals. Shows the current week by default. |
| 4 | `fa-1.txt` | `/{L}/players?status=A&pos=P&sort=AR&sdir=1&count=0` | Pickup candidates: available players, ranked, 25 per page. |
| 5 | `fa-2.txt` | same, `count=25` | |
| 6 | `fa-3.txt` | same, `count=50` | |
| 7 | `fa-4.txt` | same, `count=75` | |
| 8 | `transactions.txt` | `/{L}/transactions` | Adds used this week, other teams' moves, winning FAAB bids, and the check that nothing changed on Tony's team. |

The opponent's own team page isn't read: the matchup page already lists both rosters. If the
Task 02 parser finds a field missing there, add the opponent page back, finding the opponent's team
number with `read_page`, not a page script.

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

## Trade research pages (only when Tony asks)

Not part of a routine refresh. For trade research, read each team page `/{L}/{1..12}` and the
draft pages `/{L}/draft` and `/{L}/draftresults`, the same way as the pages above, and save
their text unchanged under `local/raw/<timestamp>/` (`team-<n>.txt`, `draft.txt`,
`draftresults.txt`). The draft pages accept no query parameters. Trade proposal, draft editing,
lineup and transaction pages stay blocked, and no trade is submitted.

## Build current-season evidence

For a complete capture, run these in order with its exact timestamp:

```
node scripts/build-snapshot.mjs local/raw/<timestamp>
npm run fetch:gamelogs -- --season 2026-27 --snapshot local/snapshots/<timestamp>.json
npm run evidence -- local/snapshots/<timestamp>.json
```

The browser remains the source for league membership, available players, matchup state and
transactions. ESPN supplies player production and estimated usage. The evidence command
archives observed transactions without duplicates and saves private Markdown/JSON reports.
It displays current-season actuals with sample sizes; it does not recommend a move.
