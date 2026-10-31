# Codex briefing prompt

Paste this prompt into Codex for each league check, or keep a Codex skill whose only instruction
is "follow the prompt in docs/codex-briefing.md", so the skill never drifts from this file. It
extends [the refresh prompt](codex-refresh.md) with a private run log that Claude can read later. The
vault contains plain Markdown files with YAML frontmatter, tracked in git.

At the end of a successful run Tony has the ChatGPT brief on his clipboard. He pastes the brief
into ChatGPT, decides, and records what he did with `npm run did`.

```text
Run one league check in C:\TestCode\bball-league-assistant. Do not install a schedule or poll.

1. Read AGENTS.md, docs/update-league.md and docs/chatgpt-brief.md. Follow
   docs/update-league.md to capture Yahoo into a new local/raw/<timestamp>/ folder.
   Use the current local time for <timestamp>. Open allowed URLs and read only.
   Read each page only with locator('body').innerText() in the in-app browser and save the
   text unchanged. Never click, type, submit, evaluate or run other page scripts, or change Yahoo.
   If a sign-in page appears, stop capture and tell me. Never sign in or enter credentials.
   Do not bypass blocked tools or URLs. Keep capture diagnostics in local/.
2. Run: npm run refresh:analyze -- local/raw/<timestamp>
   This command fetches public ESPN data. In Codex, use network-enabled shell execution
   (request the normal tool approval with require_escalated when network access is restricted).
   Do not first run it in a known network-restricted shell. If access is denied or unavailable,
   stop and report game-logs; do not change network settings, bypass a denial, or treat old logs
   as freshly checked. Yahoo collection remains browser-only and follows step 1.
   local/refreshes/<timestamp>/status.json records each step as ok, failed or not run, the
   failed step and the decision ID. Use its failedStep as the failed step name in step 4.
   Only after success, take <decisionId> from this run's analysis output, then run:
   npm run brief -- <decisionId> --state "C:\TestCode\Obsidian\Claude\10 Projects\bball-league-assistant state.md"
   Stop processing at the first failure. Do not run later processing commands or fix anything.
   Still record the failed run in step 4. A sign-in stop also takes this failure path.
   Take the decision ID and action from this run's script output. Take the brief path
   from the brief command. Verify that it belongs to that decision ID.
   Never substitute an older decision or brief. Use - for a missing ID or brief path.
3. If the brief succeeded, copy it to the clipboard:
   Get-Content -Raw "<brief path>" | Set-Clipboard
   Do not claim the clipboard copy succeeded unless it did. A brief copy never proves pasting,
   reading, or a Yahoo action.
   After Tony decides, run npm run did with his answer (see docs/designs/league-move-checker.md,
   CUJ 3). Do not invent his answer.
4. Log this run in the vault file:
   C:\TestCode\Obsidian\Claude\10 Projects\bball-league-assistant runs.md
   Read only what is needed to preserve this note. If missing, create it with:
   ---
   type: log
   project: "[[bball-league-assistant]]"
   ---
   Append ONE line under ## Runs. Create the heading if missing. Preserve existing content.
   Use the current local date and time, and this exact line format:
   - YYYY-MM-DD HH:MM capture=<folder> decision=<id> result=<add|wait|hold|failed: step> brief=<path>
   Use add, wait or hold only when both commands succeeded and the script reports that action.
   Otherwise use failed: <step>, with a short, generic step name. If the script reports
   insufficient evidence, use failed: insufficient-evidence; never relabel it hold.
   This is a run status, not a claim that a transaction happened.
   Include no player names, team names, page text, brief text or numbers from the brief.
   Keep all league data in local/. Do not change the state note or any other vault file.
   Before editing, check the vault git status. If the runs note already has uncommitted
   changes, stop logging and report the conflict. Leave all other changes alone.
   Stage only the runs note, then commit only that file:
   git -C C:/TestCode/Obsidian/Claude add -- "10 Projects/bball-league-assistant runs.md"
   git -C C:/TestCode/Obsidian/Claude commit -m "Log bball refresh <timestamp>" -- "10 Projects/bball-league-assistant runs.md"
   Before pushing, check where the push goes and what it sends:
   git -C C:/TestCode/Obsidian/Claude fetch origin
   git -C C:/TestCode/Obsidian/Claude status -sb
   git -C C:/TestCode/Obsidian/Claude log --oneline --stat "@{u}..HEAD"
   Push only if the branch tracks origin/<the same branch>, is not behind it, and every outgoing
   commit changes only the runs note. Then push to that named target:
   git -C C:/TestCode/Obsidian/Claude push origin <branch>
   Run these commands separately. Stop at the first logging, commit, check or push failure.
   If a check fails or the push is refused or denied approval, do not retry or work around it:
   report the entry as committed but unpushed, with the commit hash and the reason.
   Report the failed step without appending another line or retrying the refresh.
5. Before reporting completion, distinguish the evidence for each stage: brief generated and
   clipboard copy verified. A successful analysis alone does not establish a complete run.
   Report missing stages explicitly. Vault commit/push status is separate.

   Report in chat, in this order:
   - "Brief copied to clipboard: paste it into ChatGPT." with the brief path, or the failed step.
   - Capture folder, decision ID and the one-line log entry. If logging failed, label the
     entry unsaved or unpushed as appropriate.
   Report failures by step name. Never paste page text or brief text.

Rules:
- In the league repo, edit no files outside local/. Report parser or script failures; do not fix them.
- Never switch branches, commit, stash or push in the league repo. Leave its git state unchanged.
- Only the named vault runs note may be edited and committed outside local/.
- Never use git add -A. Never switch vault branches, stash, reset or force-push.
- Every league number comes from scripts. Do not compute, adjust or summarize league data yourself.
```

## Dry run

Paste the prompt above with this instruction first. Replace the folder with Tony's choice.

```text
Dry run: replace step 1's capture with the existing local/raw/<timestamp>/ folder I name.
Read the same guides, but do not open Yahoo or capture pages. Use that exact folder in step 2.
Keep the stale-data checks. Run the remaining steps, including the vault log, commit and push.
Use the current run time for the log and commit timestamp, and the existing folder for capture=.
```

## Catch up a decision

If a refresh produced a decision and brief but the clipboard copy (step 3) or the report (step 5)
was skipped or failed, paste the prompt above with this instruction first. Do it before the move's
start date.

```text
Catch-up: do not capture or refresh. Use decision <decisionId>. Read the same guides, then run
only steps 3 and 5 for that decision.
```

## Why these rules

- **Yahoo stays read-only.** Tony makes every transaction and does every Yahoo sign-in.
- **Scripts compute the advice.** Failed runs must not reuse an older decision or brief.
- **The repo stays unchanged outside `local/`.** Other sessions may share the folder.
- **The vault gets only run metadata.** It may sync. League evidence stays in `local/`.
- **Only the runs note is committed.** Other vault work must stay out of the commit.
