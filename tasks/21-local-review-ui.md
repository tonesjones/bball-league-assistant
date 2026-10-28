# Local post-refresh review screen

Tony wants to review the nightly league check and save pilot ratings without typing commands.
Use a small loopback-only Node server and plain HTML/CSS/JS, with no runtime dependencies.

## Scope

- Open automatically from the league-refresh briefing after the brief succeeds and the pilot is attempted. Use the exact refresh decision ID for both brief and review.
- Show captured time, model version, the matching brief, the engine/isolated-chatbot/no-move answers, pilot completeness, and saved ratings.
- Copy the brief to the clipboard. Record successful browser copies privately; do not claim a paste, ChatGPT response or Yahoo transaction.
- Save validated 1-5 ratings, optional reasons and notes to the existing pilot-review log. All three recorded arms are required; closed matchups cannot be rated. Retries without changes do not duplicate reviews.
- Replay saved lineups from cached logs after the matchup with the existing scoring functions. Missing evidence stays unscored. No background collection or monitoring.
- Bind to 127.0.0.1, require a per-server access token for data/writes, reject foreign Host/Origin, serve only explicit assets, and render saved text safely.
- Keep the collector read-only. Update the project skill's referenced briefing; no advice formulas or model version changes.

## Done when

- [x] HTTP/service tests verify decision linkage, validation, persistence, retry behavior, deadline, incomplete pilots, private access and results.
- [x] Browser check verifies copy, rating save/reload, safe text rendering and narrow-screen layout using synthetic data only.
- [x] `npm test` passes.
- [x] Refresh instructions and usage docs include the review command and exact decision ID.

Verification: 232 tests pass. Browser QA used synthetic records only: saved ratings 4/3/4,
reloaded the saved values, copied and read back the exact synthetic brief, verified that copying
preserves an unsaved rating edit, and checked desktop and 390px layouts. A raw HTML-like chatbot
reply rendered as text. Launcher reuse returned the same local service. No Yahoo collection,
real review edits, vault writes or external chatbot run occurred during development.
