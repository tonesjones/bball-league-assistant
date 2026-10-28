# Codex refresh prompt

Paste the prompt below into Codex to run a league refresh. Codex reads Yahoo, runs the scripts
and writes outputs to `local/`. It changes nothing else.

```
Run a league refresh in C:\TestCode\bball-league-assistant.

1. Read AGENTS.md, then follow docs/update-league.md to capture the Yahoo pages into a new
   local/raw/<timestamp>/ folder. Open pages by URL and read them only. Never click, type,
   submit or change anything in Yahoo.
2. If a Yahoo sign-in page appears, stop. Don't sign in or enter credentials. Tell me.
3. Run: npm run refresh:analyze -- local/raw/<timestamp>
   Use network-enabled shell execution for the ESPN fetches. In Codex with restricted network
   access, request normal tool approval with require_escalated. If denied or unavailable, stop;
   do not bypass the denial or reuse old logs as fresh.
   Stop at the first failed step and report it with the step name and error.
4. Use the decision ID printed by step 3:
   npm run brief -- <decisionId> --state "C:\TestCode\Obsidian\Claude\10 Projects\bball-league-assistant state.md"
5. Report the capture folder, the decision ID, the brief path and the refresh summary.
   Don't paste page text or the brief into the chat.

Rules:
- Edit no files outside local/. If a parser or script fails, report it; don't fix it.
- Never switch branches, commit, stash or push. Leave the git working tree as you found it.
- Every number comes from the scripts. Don't compute, adjust or summarize league data yourself.
```

## Why these rules

- **Edit no files outside `local/`.** Codex shares the repo folder with Claude sessions. A fix
  belongs in its own branch and PR, not in a refresh.
- **Never switch branches or commit.** A branch switch in a shared folder once left uncommitted
  edits under another session. See "How to work" in `AGENTS.md`.
