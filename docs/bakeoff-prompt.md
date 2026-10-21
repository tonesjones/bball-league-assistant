# Chatbot bakeoff prompt

The chatbot gets the same information the tool gets, at the same decision time, so the comparison is fair. This baseline measures whether the tool makes more useful add/drop decisions.

## Chatbot

Chatbot: ChatGPT, run through the Codex CLI with the `codex-delegate` skill's bridge (`--tier sol`). Record the model name from the bridge's receipt (`model`), for example `gpt-6.1-sol`. A later pilot may switch to Claude; that starts a new pilot.

Use a fresh Codex thread per decision (a new `run`, never `resume`), with no custom instructions or memory, and the same tier for the whole pilot.

## Inputs

The chatbot gets the same Yahoo pages the tool read, as saved text, from the same refresh in `local/raw/<YYYY-MM-DD-HHmm>/`:

1. `team.txt`: my roster, including games this week.
2. `matchup.txt`: this week's matchup, with both teams' category totals.
3. `fa-1.txt`, `fa-2.txt`, `fa-3.txt`: available players, ranked.

Copy only these files into a new empty folder outside any git repository, so the chatbot can't read the tool's code or its output. Run the bridge read-only from that folder:

```bash
python <bridge> run --tier sol --cd <folder> --prompt-file <folder>/prompt.md
```

`prompt.md` is the frozen prompt below with `<N>` filled in.

## Frozen prompt

Use the following text as `prompt.md`. Replace `<N>` with the adds left this week; change nothing else.

```text
You are advising on a fantasy basketball roster. The league is head-to-head, 9-category: PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, TO (fewer TO is better); 12 teams; 4 adds per week; daily lineups. Adds left this week: <N>.

Using the files in this folder (team.txt is my roster, matchup.txt is this week's matchup, fa-*.txt are available players), recommend ONE best add/drop for the rest of this week, or say hold. Name the categories you expect the move to help and hurt. You may use your own knowledge of the players' skills and stats. Take availability, rosters and games this week only from the files; do not invent them. If the files do not support a legal add/drop, say hold.

Reply in exactly one of these formats:
ADD: <player> | DROP: <player> | HELPS: <cats> | HURTS: <cats> | WHY: <one sentence>
HOLD | WHY: <one sentence>
```

## Log each decision

Record the tool, chatbot, and do-nothing baseline before the week's outcome is known. For a chatbot response, set `source` to `chatbot`, `chatbot` to the chatbot name, `date` to the decision date, `week` to the Yahoo week number, and `asOf` to the refresh timestamp. Set `decision` to `move` or `hold`; for a move, enter `start`, plus `add` and `drop` objects with `name` and `espnId`. Set `rating` to Tony's 1–5 usefulness rating. Use `note` for the raw answer or invalid reason.

Put entries in a JSON array and run `node scripts/bakeoff.mjs record <entries.json>`. The command appends validated entries to `local/bakeoff.jsonl`. For `tool` and `none` entries, set `chatbot` to `null`. Use `null` for a rating you haven't given.

After you act, set `taken` to `true` or `false`. If you reject a suggestion, set `rejectReason` to one of `wrong-role`, `core-player`, `bad-data`, `injury`, `timing` or `other`, and say why in `note`.

**Invalid answers.** If the answer names a player who isn't in the `fa-*.txt` files, drops a player who isn't on your roster, or doesn't use the reply format, log it as `decision: hold`. Start `note` with `INVALID:`, followed by the reason and the raw answer. It still counts in the pilot. The schema has no invalid field yet, so the `INVALID:` prefix is how those entries are counted.

These fields follow `validateEntry` in `src/engine/bakeoff.mjs`.

## Frozen

Do not edit this prompt during the 2-week pilot. Any prompt change starts a new pilot.
