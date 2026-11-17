# Update league: capture reference

How the `yahoo-reader` agent captures the Yahoo pages for the nightly check. Don't interpret,
summarize or edit what a page says: copy its text and save it.

The `update-league` skill (`.claude/skills/update-league/SKILL.md`) is the entry point. It checks
the sign-in, starts the agent with a folder name, then builds the facts sheet and follows the
playbook.

## Before you start

Run on Tony's request, or from the nightly update (see
[`designs/nightly-update.md`](designs/nightly-update.md)). Don't poll. If
`local/trade-watch-status.json` exists, use it as user-reported context, not verified live trade
status.

1. Read `YAHOO_LEAGUE_ID` and `YAHOO_TEAM_ID` from `.env`. If either is empty, stop and ask Tony.
2. Save every page in the folder `local/raw/<YYYY-MM-DD-HHmm>/` that the session gave you. The
   agent can't read the clock, so the session that starts it gives it the folder name.
3. Use Claude in Chrome, where Tony stays signed in to Yahoo. Open one new tab for the capture,
   use it for every page, and close it at the end with `tabs_close_mcp`. Leave Tony's tabs alone.

## What is enforced

The browser is signed in as Tony, so the repo's Claude settings remove the ability to change
anything, rather than relying on the rules below alone.

| Layer | Where | What it stops |
|---|---|---|
| Tool deny list | `.claude/settings.json`, `permissions.deny` | Clicking, typing, form filling, page scripts and batched browser actions, for every session and agent in this repo. |
| URL allowlist | `.claude/settings.json` hook, `scripts/guard-yahoo-url.mjs` | Opening any yahoo.com page except the pages in this doc (the table below and the trade research pages), in Tony's league, over https. |
| Agent tool list | `.claude/agents/yahoo-reader.md` | The capture agent has only `Read`, `Write` and the Claude in Chrome tools `tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `get_page_text`, `find`, `read_page` and `tabs_close_mcp`. |
| Afterwards | The facts sheet's Transactions section | Lists Tony's own adds and drops with dates, so a move Tony didn't make stands out. |

To add a page, add it to `src/sources/yahoo-urls.mjs` and its test, and say why in the PR.

## Rules

- **Sign-in page: stop.** If a page shows a Yahoo sign-in, "Sign in", password or verification
  screen, stop the whole capture and tell Tony. Never type a username, password or code. Never
  click "Sign in".
- **Read only.** Open pages by URL and read them. Nothing else: no clicks, typing, key presses,
  forms or page scripts. If a pop-up covers the page, read the text anyway; if the text is
  missing, mark the page `skipped`.
- **Blocked means stop.** If a tool call is denied or a URL is blocked, don't try another way to
  reach the page. Mark it `skipped` with the reason and go on.
- **One read per page.** If a page fails to load, wait at least one minute before one retry. If it
  fails again, skip it, note it in `_log.txt`, and go on.
- **No changes to text.** Save exactly what `get_page_text` returns.

### Saving pages

`get_page_text` returns the text to the model, and the only way to save it is to write that text
out again with the Write tool. On 2026-11-06 an agent stopped on a length-check rule it could not
meet. So:

- Write each page with the Write tool, copying the text exactly as `get_page_text` returned it.
  Leave out the tool's own header (the `Title:`, `URL:` and `Source element:` lines and the `---`
  under them); the file starts at the first line of the page body. Don't fix, trim or reorder
  anything else.
- If two pages return identical text (`matchup.txt` and `matchup-totals.txt` often do), save
  the second by copying the first file.
- Skip the write test and the length check. Log each saved page `ok`, and note in `_log.txt`
  that the length check wasn't possible.
- The sheet's parse is the check. If `npm run sheet` fails on a page, capture that page again.
  Don't edit the saved file.

### Header-only pages

Some pages return only their header from `get_page_text`. Tony's team page did on 2026-11-14.
When that happens:

1. Save what `get_page_text` returned.
2. Use `find` with a query that names the table, such as "roster table containing the team's
   players".
3. Call `read_page` with that `ref_id` and `max_chars` 30000. Never call `read_page` without a
   `ref_id`: the whole page tree is over 120,000 characters of site navigation.
4. Save the result as `<name>-tree.txt`, for example `team-tree.txt`.
5. Log the page `header-only` in `_log.txt`.

The roster table lacks the FAAB balance. After saving `team-tree.txt`, the capture uses `find`
for "Waiver Budget" and saves the matched elements to `team-values.txt`, one element per line, as
the tool printed them. The value looks like `Waiver Budget: $82`.

The sheet reads this file only when `team.txt` did not parse. It takes FAAB from the first
`Waiver Budget: $N` match and prints the source file next to it. With no match or no file, it
prints `UNAVAILABLE`, naming both `team.txt` and `team-values.txt`. The team page's adds line
hides its number from page text, so the sheet counts adds used from `transactions.txt`. The
capture does not search for adds or pending claims, and the sheet reads neither from this file.

## Pages

Replace `{L}` with `YAHOO_LEAGUE_ID`, `{T}` with `YAHOO_TEAM_ID`. Base URL:
`https://basketball.fantasysports.yahoo.com/nba`.

| # | Save as | URL | Why it's needed |
|---|---|---|---|
| 1 | `settings.txt` | `/{L}/settings` | Categories, roster slots, adds per week, games cap, playoff weeks. Capture it every time. |
| 2 | `team.txt` | `/{L}/{T}` | Tony's roster, slots, status and FAAB balance. |
| 3 | `matchup.txt` | `/{L}/matchup?mid1={T}` | This week's opponent, both rosters with slots, and banked category totals. Shows the current week by default. |
| 3b | `matchup-totals.txt` | `/{L}/matchup?mid1={T}&week={W}` | Banked makes and attempts (FGM/A, FTM/A) for both teams, which `matchup.txt` lacks once games start. `{W}` is the number in the "Week N" heading of `matchup.txt`. |
| 4 | `fa-1.txt` | `/{L}/players?status=A&pos=P&sort=AR&sdir=1&count=0` | Pickup candidates: available players, ranked, 25 per page. |
| 5 | `fa-2.txt` | same, `count=25` | |
| 6 | `fa-3.txt` | same, `count=50` | |
| 7 | `fa-4.txt` | same, `count=75` | |
| 8 | `transactions.txt` | `/{L}/transactions` | Adds used this week, other teams' moves, winning FAAB bids, and Tony's own adds and drops with dates. |
| 9 | `teams/<N>.txt` | `/{L}/{N}`, for every team number `{N}` from 1 to the league size except `{T}` | Every other roster. The role-change watch list leaves out players on any league roster. In a 12-team league that is 11 more page reads. |
| 10 | `matchup-next.txt` | `/{L}/matchup?mid1={T}&week={W+1}` | Sunday nights only. Next week's opponent and schedule, because a claim placed on Sunday night counts in next week. `{W+1}` is the week number in `matchup.txt` plus 1. |

The matchup page already lists the opponent's roster, but the opponent's team page is still read
as part of row 9. If a field is missing on the matchup page, find the opponent's team number with
`find` and `read_page`, not a page script.

For each page:

1. Open the URL in the tab.
2. Wait for the page to finish loading. If the main content (roster table, player list) is
   missing, wait 3 seconds once more.
3. Check for a sign-in screen (see Rules).
4. Read the page text with `get_page_text`, up to 200000 characters.
5. Write the text to `local/raw/<timestamp>/<save as>` (see "Saving pages").
6. If the page returned only its header, follow "Header-only pages".

## After the last page

Write `local/raw/<timestamp>/_log.txt` with one line per page: file name, the URL you opened,
and `ok`, `skipped`, `header-only` or `sign-in`. Then close the tab and tell Tony the folder path
and any page that wasn't `ok`.

## Cloud capture (public pages, signed out)

A cloud session has no Claude in Chrome, and nobody signs in to Yahoo there. The league's pages
are public, so the session reads them signed out:

```
npm run capture:public
```

The script reads `YAHOO_LEAGUE_ID` and `YAHOO_TEAM_ID` from the environment (the cloud
environment's variables) or from `.env`. It opens the pages in the table above in headless
Chromium, two seconds apart, and saves each page's text unchanged to
`local/raw/<YYYY-MM-DD-HHmm>/`. The folder stamp uses Pacific time; pass `--tz <zone>` to change
it. On a Pacific Sunday it also saves `matchup-next.txt` (`--sunday` or `--no-sunday` overrides).
It prints the folder path and any skipped page. Then build the sheet as below.

What it enforces, in code:

- It never signs in, keeps no cookies between runs, and never clicks or types.
- Every Yahoo request other than GET is aborted, and so is any Yahoo page navigation that
  `checkUrl` refuses.
- One retry per page, a minute later. A page that still fails, or that lands on a sign-in page,
  is logged `skipped`.
- The first line of `_log.txt` is `mode: public (signed out)`. `npm run sheet` reads it and
  accepts the signed-out view, whose header has a "Sign in" link. A Chrome capture has no such
  line, so a signed-out Chrome page still fails as before.

What the public view lacks: Tony's team page shows no adds line, waiver budget or pending claims.
The sheet reads that page for the roster only (`Roster source: team.txt (public view)`), counts
adds used from the transactions page, and prints a FAAB estimate: the $100 season budget minus
Tony's winning bids on the transactions page. The page reaches back only a few days, so the
estimate is an upper bound. Pending claims are unknown; ask Tony when one matters.

Playwright with Chromium is preinstalled in cloud sessions. It is not a package dependency; on a
desktop, use the Chrome capture above.

## Draft and trade pages (only when Tony asks)

Not part of a routine capture. The other teams' pages are routine (row 9). The draft pages
`/{L}/draft` and `/{L}/draftresults` are optional, saved as `draft.txt` and `draftresults.txt`.
They accept no query parameters. Trade proposal, draft editing, lineup and transaction pages stay
blocked, and no trade is submitted.

## Build the facts sheet

For a complete capture, run:

```
npm run sheet -- local/raw/<timestamp>
```

The command writes `local/sheets/<timestamp>.md`. It refreshes the ESPN box scores itself, so it
needs outbound HTTPS to `site.api.espn.com`. It also fetches ESPN's injuries feed for the Injury
report section, and caches it for 2 hours. Add `--no-fetch` to reuse the cached box scores and
the cached injuries file. The
sheet holds numbers only, with no recommendation. A section it can't compute prints
`UNAVAILABLE: <file> (<reason>)`. The [playbook](league-playbook.md) says how each section feeds
the advice.

Record any new limitation in [`limitations.md`](limitations.md) using a synthetic description.
Put real player and league details in ignored `local/` records.
