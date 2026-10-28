# Update league

Steps for the agent that runs "update league". Follow them in order. Don't interpret, summarize or
edit what a page says: copy its text and save it.

## Before you start

Run on Tony's request, usually after a completed game slate. Do not install a daily schedule
or repeatedly poll. If `local/trade-watch-status.json` exists, use it as user-reported context,
not verified live trade status. Review watched players from the resulting evidence tables,
comparing dates, starts, minutes and production with the previous capture. Preserve uncertainty
when there are too few games. New checkouts do not include ignored local inputs.

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
- **No changes to text.** Save exactly what the browser's page-text read returns.

### Page-text read by host

| Host | Page-text read | Notes |
|---|---|---|
| Claude | `get_page_text`, with up to 200000 characters | The tool deny list blocks everything else. |
| Codex in-app browser | `locator('body').innerText()` on the open tab | The one allowed read. It returns text only and changes nothing. No `evaluate`, no other locator, no `getByRole('body')` (it timed out on 2026-10-26). |

The Codex read differs a little from Claude's: it keeps button labels and non-breaking spaces.
The parsers accept both. Captures read this way on 2026-10-26 built a snapshot and ran advice.
In Codex nothing enforces these rules, so follow them exactly. If the read fails, mark the page
`skipped`; don't try another read method.

## Pages

Replace `{L}` with `YAHOO_LEAGUE_ID`, `{T}` with `YAHOO_TEAM_ID`. Base URL:
`https://basketball.fantasysports.yahoo.com/nba`.

| # | Save as | URL | Why it's needed |
|---|---|---|---|
| 1 | `settings.txt` | `/{L}/settings` | Categories, roster slots, adds per week, games cap, playoff weeks. Every refresh: the snapshot builder reads it from the same folder and fails without it. |
| 2 | `team.txt` | `/{L}/{T}` | Tony's roster, slots, status and FAAB balance. |
| 3 | `matchup.txt` | `/{L}/matchup?mid1={T}` | This week's opponent, both rosters with slots, and banked category totals. Shows the current week by default. |
| 3b | `matchup-totals.txt` | `/{L}/matchup?mid1={T}&week={W}` | Banked makes and attempts (FGM/A, FTM/A) for both teams, which `matchup.txt` lacks once games start. `{W}` is the number in the "Week N" heading of `matchup.txt`. The snapshot takes shooting volume from this page and refuses it if its week or teams differ. |
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
4. Read the page text with this host's page-text read (see "Page-text read by host").
5. Write the text to `local/raw/<timestamp>/<save as>`.

## After the last page

Write `local/raw/<timestamp>/_log.txt` with one line per page: file name, the URL you opened,
and `ok`, `skipped` or `sign-in`. Then tell Tony the folder path and any page that wasn't `ok`.

## Trade research pages (only when Tony asks)

Not part of a routine refresh. Fetch these only when Tony asks for trades (`--trades`). Read
each other team's page `/{L}/{N}` (every team number from 1 to the league size except `{T}`) and
save its text unchanged as `local/raw/<timestamp>/teams/<N>.txt`. `build-snapshot` parses them
into `league.teams` (team number and roster only). Without `--trades`, no team pages are
fetched and the snapshot has no `league` field. The draft pages `/{L}/draft` and
`/{L}/draftresults` are optional, saved as `draft.txt` and `draftresults.txt`. The draft pages accept no query parameters. Trade proposal, draft editing,
lineup and transaction pages stay blocked, and no trade is submitted.

## Build current-season evidence

For a complete capture, process that exact folder in one command:

```
npm run refresh:analyze -- local/raw/<timestamp>
```

The analysis command needs outbound HTTPS to `site.api.espn.com`. In Codex, run it with
network-enabled shell execution; if the shell has restricted network access, request the normal
`require_escalated` tool approval before running. This applies only to the public ESPN fetches,
not Yahoo collection. If approval is denied or access is unavailable, stop and report the failure.
Do not change DNS/proxy settings, bypass denied access, or mark cached logs fresh without checks.
A DNS error such as `ENOTFOUND` can be caused by the run's network restrictions; it is not by
itself proof that ESPN is down.

If Tony requests another attempt after a network-only failure, the same complete capture can
be processed again without reading Yahoo again, provided the snapshot still passes the existing
freshness checks and Tony has made no roster changes. Preserve the original failed-step log
before rerunning, because the pipeline replaces step logs for that timestamp. Do not use
`--allow-stale` without Tony's explicit override. The failed vault log remains historical evidence;
a successful retry is a separate run, not a reason to rewrite it.

This builds the snapshot, refreshes ESPN logs, archives observed transactions, writes player
evidence and runs advice, stopping at the first failed step. It prints the computed decision,
adds remaining, unknown starts and newly archived transaction details. Full advice and step
diagnostics are saved in ignored `local/refreshes/<timestamp>/`; evidence remains in
`local/evidence/`. A failed run can leave outputs from earlier successful steps; only a run
that reaches the final summary is complete. Reruns deduplicate transactions and produce a new
decision record. The step logs and evidence for that timestamp are replaced on rerun.

After a complete run, `npm run brief` writes `local/briefs/<decisionId>.md` for Tony to paste
into ChatGPT, and prints only its path. It reads the saved decision and makes no network calls. Pass
`--state "<vault>/10 Projects/bball-league-assistant state.md"` to include Tony's standing
decisions. Before advising or reviewing, Claude and Codex read that note, name the snapshot they
used, and flag any entry that conflicts with it.

Newly archived events can include backfilled history. They are not guaranteed to have happened
since the previous refresh. Both your team's and other teams' observed moves are shown.

The individual commands remain available for debugging:

```
node scripts/build-snapshot.mjs local/raw/<timestamp>
npm run fetch:gamelogs -- --season 2026-27 --snapshot local/snapshots/<timestamp>.json
npm run evidence -- local/snapshots/<timestamp>.json
```

The browser remains the source for league membership, available players, matchup state and
transactions. ESPN supplies player production and estimated usage. The evidence command
archives observed transactions without duplicates and saves private Markdown/JSON reports.
It displays current-season actuals with sample sizes; it does not recommend a move.

## Models and token use

The Claude Code `yahoo-reader` is configured as `model: haiku`. That is configuration, not
verification of a past run's actual model. It collects unchanged page text and returns only
the capture folder and failures. Node performs snapshot parsing, game-log fetching, transaction
deduplication, evidence tables and recommendation arithmetic; these scripts call no LLM.

In Codex, `.claude/agents/yahoo-reader.md` does not select or launch a model. Keep Sol responsible
for review. Consider a bounded Luna collection assignment only when the signed-in browser and
unchanged-text file export are available to that worker and the handoff is worthwhile. Verify
the actual model where runtime metadata permits; otherwise label it requested but unverified.
Never weaken Yahoo access rules to enable a cheaper worker.

For routine updates, keep collection in its own small context. Run `refresh:analyze` and bring
the compact output to the reviewing chat; read detailed evidence only for a specific uncertainty.
Do not paste whole Yahoo pages, the entire historical transaction archive, or unchanged reports
into the review chat. Retain those inputs privately for debugging. This reduces repeated context;
subscription savings remain unmeasured without comparable observed runs. Tokenomics does not
automatically switch models, and no router or recurring usage audit is needed per refresh.

On each review, record any newly encountered limitation in `docs/limitations.md` using a
synthetic description. Put real player/league details and rejection reasons in ignored local
decision or rehearsal records. Do not treat a descriptive evidence report as a model fix.
