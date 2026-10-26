# Codex briefing prompt

Paste this prompt into Codex for each scheduled league check. It extends
[the refresh prompt](codex-refresh.md) with a private run log that Claude can read later.
The vault contains plain Markdown files with YAML frontmatter, tracked in git.

```text
Run one league check in C:\TestCode\bball-league-assistant. Do not install a schedule or poll.

1. Read AGENTS.md, docs/update-league.md and docs/chatgpt-brief.md. Follow
   docs/update-league.md to capture Yahoo into a new local/raw/<timestamp>/ folder.
   Use the current local time for <timestamp>. Open allowed URLs and read only.
   Save page text unchanged. Never click, type, submit, run page scripts or change Yahoo.
   If a sign-in page appears, stop capture and tell me. Never sign in or enter credentials.
   Do not bypass blocked tools or URLs. Keep capture diagnostics in local/.
2. Run: npm run refresh:analyze -- local/raw/<timestamp>
   Only after success, run:
   npm run brief -- --state "C:\TestCode\Obsidian\Claude\10 Projects\bball-league-assistant state.md"
   Stop processing at the first failure. Do not run later processing commands or fix anything.
   Still record the failed run in step 3. A sign-in stop also takes this failure path.
   Take the decision ID and action from this run's script output. Take the brief path
   from the brief command. Verify that it belongs to that decision ID.
   Never substitute an older decision or brief. Use - for a missing ID or brief path.
3. Log this run in the vault file:
   C:\TestCode\Obsidian\Claude\10 Projects\bball-league-assistant runs.md
   Read only what is needed to preserve this note. If missing, create it with:
   ---
   type: log
   project: "[[bball-league-assistant]]"
   ---
   Append ONE line under ## Runs. Create the heading if missing. Preserve existing content.
   Use the current local date and time, and this exact line format:
   - YYYY-MM-DD HH:MM capture=<folder> decision=<id> result=<move|hold|failed: step> brief=<path>
   Use move or hold only when both commands succeeded and the script reports that action.
   Otherwise use failed: <step>, with a short, generic step name. If the script reports
   insufficient evidence, use failed: insufficient-evidence; never relabel it hold.
   This is a run status, not a claim that a transaction happened.
   Include no player names, team names, page text, brief text or numbers from the brief.
   Keep all league data in local/. Do not change the state note or any other vault file.
   Before editing, check the vault git status. If the runs note already has uncommitted
   changes, stop logging and report the conflict. Leave all other changes alone.
   Stage only the runs note, then commit only that file and push the vault's current branch:
   git -C C:/TestCode/Obsidian/Claude add -- "10 Projects/bball-league-assistant runs.md"
   git -C C:/TestCode/Obsidian/Claude commit -m "Log bball refresh <timestamp>" -- "10 Projects/bball-league-assistant runs.md"
   git -C C:/TestCode/Obsidian/Claude push
   Run these commands separately. Stop at the first logging, commit or push failure.
   Report the failed step without appending another line or retrying the refresh.
4. Report in chat: capture folder, decision ID, brief path and the one-line log entry.
   If logging failed, label the entry unsaved or unpushed as appropriate.
   Report failures by step name. Never paste page text, brief text or league details.

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

## Why these rules

- **Yahoo stays read-only.** Tony makes every transaction and does every Yahoo sign-in.
- **Scripts compute the advice.** Failed runs must not reuse an older decision or brief.
- **The repo stays unchanged outside `local/`.** Other sessions may share the folder.
- **The vault gets only run metadata.** It may sync. League evidence stays in `local/`.
- **Only the runs note is committed.** Other vault work must stay out of the commit.
