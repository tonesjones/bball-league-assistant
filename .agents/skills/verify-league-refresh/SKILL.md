---
name: verify-league-refresh
description: Verify the basketball assistant's Yahoo capture, refresh CLI, ChatGPT brief, and private local review before a league refresh or after workflow changes.
---

# Verify league refresh

Use Node 20+ and PowerShell from the checkout root. No runtime dependencies or build step.
Primary surface: capture → refresh:analyze → brief CLI; secondary: loopback review screen.
Read AGENTS.md and docs/update-league.md first. Follow the feature map in features/README.md.
This skill verifies behavior; it does not change scoring, repair code, authorize trades, or turn
a rehearsal into live advice. Do not run the pilot or commit/push vault logs unless requested.

## Launch

For a safe offline rehearsal, run:
```powershell
node .agents/skills/verify-league-refresh/check.mjs smoke
```
It starts the actual review server on an OS-selected 127.0.0.1 port with a new synthetic data root,
checks readiness through /api/health, drives the production HTTP routes, and stops its own server.
Success prints PASS and an evidence directory. Exit 1 means failed proof; inspect retained files.
This needs localhost access; request normal network-enabled execution if the sandbox blocks it.
It neither opens a browser nor runs ESPN/Yahoo requests.

For real refresh verification, launch each command in features/analysis.md, then features/brief.md
and features/review.md. The review launcher uses local/review-ui/server.json and can replace an
older server: never run two launchers against one checkout. Shared real local/ state is NOT isolated.
Use the synthetic smoke test for concurrent verification. A new worktree has no .env or private inputs;
do not copy them into a commit or assume that checkout is ready for a live refresh.

## Doctor

One read-only check, with no browser, network, writes, or displayed secret values:
```powershell
node .agents/skills/verify-league-refresh/check.mjs doctor
```
From an isolated worktree, inspect the main checkout explicitly:
```powershell
node .agents/skills/verify-league-refresh/check.mjs doctor C:\TestCode\bball-league-assistant
```
Exit 0 means basic inputs exist and the latest parsed snapshot passes the engine's age check.
Exit 2 lists prerequisites requiring action, not necessarily defects. Exit 1 is an unexpected error.
File existence does not establish valid page content, login, network access, correct browser export,
or UI readiness. Continue with the relevant feature checks even after exit 0.

**Stale rehearsal trap:** evidence and refresh:analyze do not accept --allow-stale, although advise
does. A stale capture cannot complete the normal pipeline. Do not rename a capture, rewrite its
as-of timestamp, change the clock, or silently use an old brief. Use a fresh read-only capture
for a full rehearsal; the offline smoke remains available with stale or absent private data.

## Drive

The helper drives the production HTTP interface using Node fetch, with synthetic files at the
existing disk-input boundary. It checks current server code version/root, HTML/assets, authenticated
decision selection and exact brief content, rejection of incomplete-pilot ratings with no ratings file,
copy-event persistence, and state reload. It also checks unchanged checkout HEAD/status.
The /api/copied call tests event persistence, NOT the browser clipboard.
Use features/review.md for actual rendered controls and clipboard proof.
Use features/capture.md to verify the browser-runtime export that failed on October 28.
Use features/analysis.md and features/brief.md for actual CLI output and immutable decision linkage.
Stop a real refresh at its first failed processing step; report the failure, do not repair during it.

## Evidence

Helper evidence survives in local/verification/review-*/: http.json contains request/action plus
response state; copy-event.json proves disk persistence; result.json records coverage and cleanup.
All artifacts remain git-ignored. Never publish page text, league identifiers, server tokens or briefs.
For live checks create a separate local/verification/ directory using a unique run name and save
command, exit code, stdout/stderr, capture/decision/brief paths, and UI snapshots/screenshots there.

A passing smoke test is proof of review HTTP integration only. Mark capture, network, brief CLI,
browser rendering, and clipboard NOT TESTED until driven. A screenshot alone does not prove a saved
file; a /api/copied response alone does not prove copying. Record both action and resulting state.
Mocks belong only at existing external boundaries; do not bypass handlers with internal setters.
Observe side effects rather than trusting the words dry run: refresh:analyze fetches ESPN and writes
snapshots, caches, transaction history, evidence and decisions. The briefing guide's dry run also
opens review and commits a vault log unless explicitly skipped. Capture originals before a rerun
that replaces timestamped outputs; do not overwrite failed diagnostics.

## Cleanup

The smoke helper closes only its own server in finally, confirms its port no longer answers, removes
only its own scratch directory, and verifies retained HTTP evidence exists. It leaves real decisions,
ratings, clipboard, vault files, shared server descriptor and git refs alone.
After failure, inspect result.json and confirm serverStopped and scratchRemoved; retain evidence.
For a real UI session, leave Tony's pre-existing server running. Only if this verification created the
server and no one else uses it, run npm run review -- --stop in that same checkout. Do not kill by name.
Close only browser tabs created for verification. Preserve real captures and decision records.

## Helpers

check.mjs is executable through node; doctor and smoke invocations are above.
No package installation, recurring task, new service, or engine version bump is needed.
As the workflow changes, use /maintain-verification-skill to update the feature map and rerun proof.
