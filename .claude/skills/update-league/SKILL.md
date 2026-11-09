---
name: update-league
description: Capture the Yahoo league pages, run the analysis and record what Tony did. Use when Tony says "update league", "refresh the league" or "run a league check".
---

# Update league

Runs a full refresh in the main session: sign-in check, capture, `refresh:analyze`, show the report, then record the `did` answer. Tony types no npm command.

Read `docs/update-league.md` first. It owns the folder stamp, the page list (20 pages), the URLs, the file names and the save rule. Don't copy its tables here.

## Read-only rules

- No clicks, typing, key presses, forms or page scripts in Yahoo. The settings deny those tools.
- A hook blocks any Yahoo URL outside the list in `src/sources/yahoo-urls.mjs`.
- Never sign in or enter credentials. If a blocked or denied call happens, don't try another route; skip the page and log why.

## Steps

1. **Sign-in check first.** Use the built-in browser pane: `mcp__Claude_Browser__tabs_context`, then `navigate` and `get_page_text`. Open the first league page (`settings`) from `docs/update-league.md`. If a Yahoo sign-in page appears (see "Sign-in page: stop" in that doc), or the pane is hidden or unreachable, stop and tell Tony. Never sign in.
2. **Capture in this session.** Do not use the `yahoo-reader` subagent; it stopped after three pages on 2026-11-06. Read `YAHOO_LEAGUE_ID` and `YAHOO_TEAM_ID` from `.env` (ask Tony if empty). Make the `local/raw/<YYYY-MM-DD-HHmm>/` folder from the current local time. Open each of the 20 pages in `docs/update-league.md` one at a time and save each with the Write tool exactly as that doc's Claude save rule says (page body only, no tool header, nothing edited). Write `_log.txt` at the end and tell Tony about any page that wasn't `ok`.
3. **Analyze.** Run `npm run refresh:analyze -- local/raw/<stamp>`. Then read `local/refreshes/<stamp>/status.json`. If it has a `failedStep`, stop and report that step and its log path (`local/refreshes/<stamp>/<step>.txt`).
4. **Show the report.** Show Tony the printed report, including the role-change list section. Say that the full report is `local/refreshes/<stamp>/advice.txt`.
5. **Record what Tony did.** Ask in chat, mirroring the prompts in `scripts/did.mjs`:
   - What did you do? Hold, or add (with the player, who was dropped if anyone, and the first day the player can start, YYYY-MM-DD). Offer the engine's pick and the runners-up from the report.
   - Which tag fits? `changed-decision` (the tool changed what you did), `caught-mistake` (it stopped a bad move), `no-effect` (you would have done the same without it), `wasted-time` (it cost more than it gave).
   - Minutes spent on this decision (optional).
   - Did Claude or you have to finish the run by hand? If yes, add `--rescue`.

   Then run the non-interactive form with the decision ID from `status.json`:

   ```
   npm run did -- <decisionId> hold --tag <tag> --minutes <n>
   npm run did -- <decisionId> add "<player>" --drop "<player>" --on YYYY-MM-DD --tag <tag> --minutes <n>
   ```

   Other flags that exist: `--rating 1-5`, `--reason "..."`, `--rescue`, `--replace` (only if `did` says the decision is already recorded and Tony agrees to replace it). `--drop` is optional. Use no other flags.
