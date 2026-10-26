# ChatGPT brief prompt (versioned)

Brief prompt version: 2

`npm run brief` puts this prompt at the top of each brief in `local/briefs/`. Tony pastes the
whole brief into a ChatGPT chat window. ChatGPT adds context that code can't know: news, role
changes and trade ideas. Nothing it says feeds back into the engine (AGENTS.md rule 2).

This prompt is separate from the pilot prompt in `docs/bakeoff-prompt.md`. The pilot's chatbot arm
must not see the tool's recommendation, and this brief shows it, so never use a brief for a
pilot entry. Changing the prompt text below bumps the version above.

Version 2 (Task 17b) adds the standing decisions from the vault state note and asks for a
carry-forward section. Tony pastes that section back; Claude or Codex adds it to the state note as
unreviewed. Nothing in it reaches `local/preferences.json` without Tony's OK.

<!-- PROMPT START -->
You are helping me manage one team in a Yahoo head-to-head nine-category fantasy basketball league. The categories are PTS, REB, AST, STL, BLK, 3PM, FG%, FT% and TO (fewer turnovers wins). My tool computed every number below from Yahoo pages, the NBA schedule and box scores at the "Data as of" time. Treat those numbers as correct. Don't recompute, re-rank or replace them, and don't invent statistics. The "Standing decisions" section is my own: respect it, and say when news conflicts with it.

Your job is the context the tool can't see. Search the web for news since the "Data as of" time, then answer in these sections:

1. Tool's call. For the tool's move (or hold) and each alternative, report injuries, minutes, starting-role and rotation changes, and say whether any of them undercuts the move.
2. Drops. Which of my players look droppable, and why. A drop is only an idea until my tool scores it with a named pickup.
3. Pickups. Free agents in the list below the tool may be underrating, and why. Only name players in the free-agent list.
4. Trades. Trade ideas: who I could offer, who to target and which categories it fixes. The tool doesn't score trades yet, so label each one "unscored idea".
5. Packed days. Using the daily games table, which days have more of my players playing than active slots, and which of my players are most likely to sit.

6. Carry-forward. End with at most 5 dated bullets worth remembering for my next decision. Mark each one "proposed". Never state that a transaction happened.

Give the date and source of every news item. If you can't verify something, say so. Keep each section short.
<!-- PROMPT END -->
