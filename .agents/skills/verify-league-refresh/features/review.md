# Private local review

## Sub-features
- Exact decision and brief selection, assets, reload, incomplete pilot and saved ratings.
- Brief clipboard copy and persisted copy event.
- Authentication and isolation of private local data.

## How to get to it (user POV)
Run npm run review -- <decisionId> after the brief, or reopen with that command.
npm run review without an ID chooses the newest decision; this is for manual reopening only.
Use Reload saved data, Saved league check, Copy ChatGPT brief and Save all three ratings.

## Driving it with HTTP and browser
Offline backend proof: run node .agents/skills/verify-league-refresh/check.mjs smoke.
It launches a real isolated server with synthetic files, doctors /api/health, GETs /api/state
and assets, POSTs /api/copied, reloads state and checks its disk event. It verifies incomplete
pilot ratings return 400 without writing a ratings file and unauthenticated state returns 403.
The HTTP transcript and result survive server teardown.

For browser proof use the private link from npm run review -- <decisionId>.
Use observed stable controls: #decision, #meta, #progress, #copy, #copy-status, #reload and #save.
Confirm #meta contains the exact selected decision and capture time. Select another saved decision,
then return to the intended one; reload and confirm its brief and pilot status remain linked.
Click Copy ChatGPT brief; require the success message, clipboard equality with that brief and a new
matching brief-copied line in local/review-ui/events.jsonl. Never claim clipboard success from HTTP alone.
With a skipped pilot, #save and rating controls must be disabled and pilot status Incomplete.
Rate real advice only with Tony's actual ratings; never invent them for verification. Synthetic
rating writes may be tested only in an isolated data root, as tests/review-ui.test.mjs does.
For a complete pilot, radio controls have aria-labels such as Engine advice: 3 out of 5;
verify saved JSONL rows and reload persistence after Tony supplies ratings.
Retain screenshots/DOM state plus file evidence privately. Do not expose the bearer token.

## Gotchas
GET /api/health must match the expected root and codeVersion; origin must be 127.0.0.1.
Launcher state is per checkout and shared. Do not stop Tony's server or drive two sessions.
The smoke helper never touches the shared server descriptor or actual clipboard.
An incomplete pilot intentionally prevents ratings but still permits brief copying.
A backend pass does not prove rendered UI or clipboard. Outcome replay needs completed matchup logs.
