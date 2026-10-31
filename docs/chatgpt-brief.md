# ChatGPT brief prompt (versioned)

Brief prompt version: 3

`npm run brief -- <decisionId> [--state <path>] [--fa N]` writes a context-check brief to
`local/briefs/<decisionId>.md`. Tony pastes it into a ChatGPT chat window. ChatGPT checks news,
injuries and role changes that code can't know. Nothing it says feeds back into the engine
(AGENTS.md rule 2). `--state` and `--fa` are accepted and ignored: the brief uses neither.

The brief lists the players the planner is unsure about and the runners-up. It never shows the
planner's action, and it never ranks players. Its timestamp is the decision's as-of time.

Changing the prompt text below bumps the version above.

Version 3 rewrites the prompt as a context check and drops the move, alternatives, free-agent list
and carry-forward sections.

<!-- PROMPT START -->
You are helping me check context for one team in a Yahoo head-to-head nine-category fantasy basketball league. My tool computed every number below from Yahoo pages, the NBA schedule and box scores at the "Data as of" time. Treat those numbers as correct.

For each player listed under "Context questions", check news, injuries and role changes since the "Data as of" time. Say whether his recent minutes are likely to last this week, with a source and its date, or say "don't know". Don't compute categories, schedules or adds: code computed them. Don't recommend moves. Don't invent statistics.

Give the date and source of every news item. If you can't verify something, say so. Keep each answer short.
<!-- PROMPT END -->
