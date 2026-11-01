# bball-league-assistant

A tool for one Yahoo head-to-head, 9-category fantasy basketball league. When a roster decision is pending, it searches the available players and proposes one action for the week: add today, wait for a named later day, or hold. Each proposal comes with the category counts behind it. The tool never makes a move. You make every move by hand in Yahoo.

League data comes from Yahoo pages read in a browser you are already signed in to, not from the Yahoo API. An LLM agent saves the pages unchanged, and plain Node code computes every number.

## Status

The week planner (`src/engine/week-plan.mjs`) and the shadow log are the current design. [`PLAN.md`](PLAN.md) has the goals, the stop rule and the build checklist. [`docs/designs/league-move-checker.md`](docs/designs/league-move-checker.md) has the reasoning. Rules for coding agents are in [`AGENTS.md`](AGENTS.md).

## Set up

Node 20 or later is required.

```
cp .env.example .env        # add your league and team IDs
npm test
```

## Run a league check

1. Capture the Yahoo pages to `local/raw/YYYY-MM-DD-HHmm`. Codex is the primary capture host: see [`docs/codex-refresh.md`](docs/codex-refresh.md). Claude is the maintained backup: in Claude Code, say "update league" and the `yahoo-reader` agent saves the pages. See [`docs/update-league.md`](docs/update-league.md).
2. Run the analysis on that folder:

   ```
   npm run refresh:analyze -- local/raw/YYYY-MM-DD-HHmm
   ```

   The command builds the snapshot, fetches game logs, runs `advise` and prints a summary with the decision ID. The step logs and the full report go to `local/refreshes/YYYY-MM-DD-HHmm/`.

3. Optional: write a context-check prompt for ChatGPT.

   ```
   npm run brief -- <decisionId>
   ```

   The command writes `local/briefs/<decisionId>.md`. Without an ID it uses the newest decision. The brief hides the chosen action. See [`docs/chatgpt-brief.md`](docs/chatgpt-brief.md).

4. Decide, then record what you did:

   ```
   npm run did
   ```

   It asks about the newest decision: what you did (the engine's pick, a runner-up, hold, or someone else), how much the tool mattered, your minutes, and whether the check needed rescuing. Answer each with a number or Enter. To ask about an older decision, pass its ID: `npm run did -- <decisionId>`. If you already recorded the decision, it offers to replace that entry.

   Scripts and Codex can skip the questions with flags:

   ```
   npm run did -- <decisionId> hold --tag T [--minutes N] [--rescue] [--reason "..."] [--replace]
   npm run did -- <decisionId> add "<player>" [--drop "<player>"] --on YYYY-MM-DD --tag T [same flags]
   ```

   `--tag` is required. The tags are `changed-decision`, `caught-mistake`, `no-effect` and `wasted-time`. `--minutes` records how long the decision took, and `--rescue` marks a league check that needed rescuing.

## Read the proposal

The report names one action: add, wait or hold. A `dependsOn` line names a player when a cautious case changes the action: the pickup at his weakest minutes and rates, or the drop at his strongest. It gives his games, his season and prior minutes, and the cautious action. A pickup with no prior season always gets one. The report also shows each category's change and the as-of time of the data. [`docs/limitations.md`](docs/limitations.md) lists the known limits of the evidence and the model.

`npm run advise` runs the planner on one snapshot. `refresh:analyze` calls it for you. To run it alone, pass a file from `local/snapshots/`. Without a path, it uses the newest snapshot. Add `--allow-stale` to override the snapshot age limit, or `--max-age-hours N` to change it. Every run writes an immutable record to `local/decisions/<decisionId>.json` and a copy of the advice to `local/advice/`.

## Compare the engine with your choices

`did` writes a `tony` entry to the shadow log, `local/bakeoff.jsonl`. After the decision window has passed, replay both sides against the box scores:

```
npm run bakeoff -- replay --to YYYY-MM-DD
```

The replay prints, for each decision you recorded, what the engine's action and your action would have gained against doing nothing, or "unscored" with the reason. Other `bakeoff` commands are `record <entries.json>` and `score --week N --from YYYY-MM-DD --to YYYY-MM-DD`.

## Data commands

| Command | What it does |
|---|---|
| `npm run import:draftlab` | Imports last season's priors into `data/priors/` from a [Draft Lab](https://github.com/tonesjones/fantasy-basketball-mock-draft) checkout next to this repo. Never hand-edit that folder. |
| `npm run fetch:schedule` | Writes the 2026-27 NBA schedule to `data/schedule-2026-27.json`. |
| `npm run build:ids` | Writes the player ID map `data/ids.json`. |
| `npm run match:ids` | Matches the newest snapshot's players against the ID map. |
| `npm run fetch:gamelogs -- --season 2026-27 --snapshot <file>` | Fetches box scores through the snapshot date. `--from` and `--to` change the date range. `refresh:analyze` runs this for you. |

## Where outputs go

Everything the tool reads from Yahoo or writes about your team goes in `local/`, which Git ignores: `raw/`, `snapshots/`, `refreshes/`, `advice/`, `decisions/`, `briefs/` and `bakeoff.jsonl`. Preferences that change advice, such as protected players, live in `local/protected.json` and `local/preferences.json`. Another checkout needs its own copies.

## Subdirectories and system boundaries

- `scripts/`: [`scripts/README.md`](scripts/README.md). The command-line entry points behind the `npm run` commands, and the Yahoo URL guard hook.
- `src/`: [`src/README.md`](src/README.md). Library code, split into [`src/engine/`](src/engine/README.md) (pure planning and scoring, no I/O) and [`src/sources/`](src/sources/README.md) (ESPN fetching, Yahoo page parsing, validation and storage).
- `tests/`: `node:test` suites with small synthetic fixtures in `tests/fixtures/`.
- `data/`: generated inputs: `data/priors/`, `data/ids.json` and `data/schedule-2026-27.json`.
- `docs/`, `tasks/`: how-to guides, the design in `docs/designs/`, data sources and task specs.

## Global invariants

- The tool reads Yahoo and never changes anything there. `.claude/settings.json` denies the browser click, type, form and script tools. On `navigate` and `preview_start` calls, `scripts/guard-yahoo-url.mjs` blocks any Yahoo URL that `src/sources/yahoo-urls.mjs:checkUrl` refuses.
- An LLM agent only saves Yahoo page text. Code in `src/` computes every number.
- `src/engine/` does no I/O and uses no randomness, so the same inputs give the same output.
- A change to recommendations or scores bumps `MODEL_VERSION` in `src/engine/advice-common.mjs`.
- Anything about your league goes in `local/`, which Git ignores. Tests use synthetic fixtures only.

## Global side effects

- Network: ESPN's public API (`https://site.api.espn.com`), with caching in `local/cache/espn/`, at least 500 ms between requests, and backoff on 429, 500, 502, 503 and 504.
- Files: generated data in `data/`, and everything else in `local/`. `import-draftlab.mjs --out` can write elsewhere when run directly. Decision records and briefs are never overwritten. The shadow log `local/bakeoff.jsonl` is append-only.

## System verification

- Run: `npm test`

## Retired work

Specs for the earlier phases are in [`tasks/archive/`](tasks/archive/). [`tasks/`](tasks/) holds the first two task specs.
