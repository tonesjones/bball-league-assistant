# Chatbot bakeoff prompt

The chatbot gets the same information the tool gets, at the same decision time, so the comparison is fair. This baseline measures whether the tool makes more useful add/drop decisions.

## Chatbot

Chatbot: TBD (Tony picks)

Use one chatbot and one fresh chat per decision. Use no custom instructions or memory. Use the same model for the whole pilot, and record the model name.

## Screenshots

Capture these in the Yahoo app, in order:

1. My roster, including games this week.
2. This week's matchup, showing both teams' category totals.
3. Free agents: available players, all positions, sorted by Yahoo's actual rank (the same view the tool reads, `fa-1.txt` in `docs/update-league.md`). First page only.

Capture them right after the tool's refresh so the chatbot and tool see the same data.

## Frozen prompt

Paste the following text into the fresh chat with the three screenshots. Replace `<N>` with the adds left this week; change nothing else.

```text
You are advising on a fantasy basketball roster. The league is head-to-head, 9-category: PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, TO (fewer TO is better); 12 teams; 4 adds per week; daily lineups. Adds left this week: <N>.

Using only the screenshots, recommend ONE best add/drop for the rest of this week, or say hold. Name the categories you expect the move to help and hurt. Do not invent players, availability, games, or statistics. If the screenshots do not support a legal add/drop, say hold.

Reply in exactly one of these formats:
ADD: <player> | DROP: <player> | HELPS: <cats> | HURTS: <cats> | WHY: <one sentence>
HOLD | WHY: <one sentence>
```

## Log each decision

Record the tool, chatbot, and do-nothing baseline before the week's outcome is known. For a chatbot response, set `source` to `chatbot`, `chatbot` to the chatbot name, `date` to the decision date, `week` to the Yahoo week number, and `asOf` to the refresh timestamp. Set `decision` to `move` or `hold`; for a move, enter `start`, plus `add` and `drop` objects with `name` and `espnId`. Set `rating` to Tony's 1–5 usefulness rating. Use `note` for the raw answer or invalid reason.

Put entries in a JSON array and run `node scripts/bakeoff.mjs record <entries.json>`. The command appends validated entries to `local/bakeoff.jsonl`. For `tool` and `none` entries, set `chatbot` to `null`. Use `null` for a rating you haven't given.

After you act, set `taken` to `true` or `false`. If you reject a suggestion, set `rejectReason` to one of `wrong-role`, `core-player`, `bad-data`, `injury`, `timing` or `other`, and say why in `note`.

**Invalid answers.** If the answer names a player who isn't on the free-agent screenshot, drops a player who isn't on your roster, or doesn't use the reply format, log it as `decision: hold`. Start `note` with `INVALID:`, followed by the reason and the raw answer. It still counts in the pilot. The schema has no invalid field yet, so the `INVALID:` prefix is how those entries are counted.

These fields follow `validateEntry` in `src/engine/bakeoff.mjs`.

## Frozen

Do not edit this prompt during the 2-week pilot. Any prompt change starts a new pilot.
