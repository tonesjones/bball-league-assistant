# Task 17b: shared state and the ChatGPT return loop

Requested by Tony on 2026-10-25, from a workflow Sol proposed. Needs Task 17 (PR #48). Claude,
Codex and ChatGPT should work from the same facts, and ChatGPT's conclusions should come back
for review. Lineup preferences change which moves `advise` may suggest, so the preferences part
bumps `MODEL_VERSION`.

## Problem

Tony's standing decisions (who is the IL opening, who holds which Util slots on a packed day,
which proposals are still pending) live in chat history. Each assistant rebuilds them, and
they go out of date: the October 20 ChatGPT context brief in the vault misses later
corrections. ChatGPT's answers go nowhere afterward.

## Rules

- League data stays in `local/` snapshots. No LLM keeps a copy of the roster, stats or
  injuries anywhere else (AGENTS.md rule 2). Notes point to the snapshot they used.
- Only Tony's own judgments go in the shared note: preferences, decisions and open questions,
  each dated.
- A preference that should change advice goes in a git-ignored JSON file the engine reads, not
  only in a note.

## Behavior

### State note (vault)

- One private note, `10 Projects/bball-league-assistant state.md` in the vault, following the
  vault's `CLAUDE.md`. Sections: standing preferences, decisions (proposed, approved and done
  as separate dated entries), open questions, and ChatGPT carry-forward notes marked
  "unreviewed" until Tony or Claude checks them.
- Claude and Codex read it before advising or reviewing. Each names the snapshot it used and
  flags any note entry that conflicts with the snapshot (for example, a player named as the IL
  opening who is no longer on the roster).
- Replace the October 20 note `50 Claude/Prompts/Basketball ChatGPT context brief.md` with a
  pointer to `npm run brief`, so there is one source.

### Preferences file (engine)

- `local/preferences.json`, git-ignored: `{ "ilCandidates": [name], "notIlCandidates": [name],
  "lineupLocks": [{ "date": "YYYY-MM-DD", "slot": "Util", "player": name }] }`. No file means no
  preferences. A name not on the roster fails loudly.
- `advise` honors lineup locks when it fits each day's legal lineup, and treats an open spot from
  an IL move as available only for players in `ilCandidates`. It never treats a player in
  `notIlCandidates` as an IL opening.
- `MODEL_VERSION` 5 (or the next free number if Task 15 merges first).

### Brief (Task 17 extension)

- `npm run brief -- --state <path>` adds a "Standing decisions" section that copies the state
  note's preferences, decisions and open questions word for word. Without `--state` the section
  says none were supplied. The brief never reads league data from the note.
- The prompt (brief prompt version 2) asks ChatGPT to end with a "Carry-forward" section: at most
  5 dated bullets, each marked proposed, with no transaction stated as done.
- Tony pastes the carry-forward section back. Claude or Codex adds it to the state note as
  unreviewed. Nothing from it reaches `local/preferences.json` without Tony's OK.

## Done when

- [ ] The state note template exists in the vault and the October 20 brief points to `npm run brief`.
- [ ] Preference tests: a lineup lock fixes that day's slot; a non-candidate never opens an IL
  spot; an unknown name fails; no file changes nothing.
- [ ] Brief tests: `--state` copies the sections word for word; without it the section says none.
- [ ] The prompt version is 2 and asks for the carry-forward section.
- [ ] `MODEL_VERSION` is bumped and `npm test` passes.
