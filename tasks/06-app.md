# Task 06: the app

Phase 2. **Don't start until the Phase 0 bakeoff passes its gate** (see [`PLAN.md`](../PLAN.md)).
This is a stub; the full spec is written when Phase 0 ends.

## Goal

A UI Tony uses instead of a CLI: a local web app plus a private Cloudflare deploy.

## Shape

- **Local web app** (`npm start`, opens on localhost): used to test a branch before its PR is
  approved. In daily use it has the **Refresh** button, which runs the league read (Task 02) and
  pushes the new snapshot and advice to Cloudflare. Check whether headless Claude Code with Haiku
  (`claude -p --model haiku`) can drive the browser for this; if not, design the refresh around
  what works.
- **Cloudflare Pages:** production. Deploys `main` on merge; each PR branch gets a preview URL.
  Locked to Tony's email with Cloudflare Access. Pages Functions with KV hold the latest snapshot
  and advice. The push endpoint takes a token from `.env`. Tony sets up the Cloudflare account and
  Access himself; Claude never logs in to the dashboard.
- **Screens:**
    - First-run setup: league URL, pick your team, mark protected players, run the first refresh.
      Each step explains itself.
    - Today's best move: add X, drop Y, why (games left, category gain), as-of time.
    - Free-agent board: ranked for this week, filterable by category.
    - Later, with Task 03: this week's matchup with odds.

## Done when (draft)

- [ ] Tony runs the first-run setup on localhost and on a PR preview URL without help.
- [ ] Every screen renders at 375 px wide without horizontal scrolling.
- [ ] A snapshot push without the token is rejected.
- [ ] The framework choice (plain HTML and JS or a small framework) is recorded with security
      notes and pinned versions.
- [ ] No league data in the public repo.
