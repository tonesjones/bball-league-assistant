# Playbook regression set

A saved set of past nights that a new playbook version must still answer correctly. It catches a
rule change that fixes one night and breaks another.

## A case

A case is a folder `local/regression/<date>-<slug>/`. It holds:

- `case.md`, with:
  - the capture folder or saved facts sheet the case uses,
  - the date,
  - the playbook rule it tests,
  - what the advice must say and must not say.
- Any saved inputs the case needs.

Real names stay in `local/`. The folder is git-ignored, so a case can name real players.

## Run the set

1. For each case, start a fresh subagent. It follows [`league-playbook.md`](league-playbook.md) on
   the case's saved inputs only. It opens no live pages.
2. The main session compares each result to the case's `case.md`.
3. The main session appends `pass` or `fail` for each case to `local/regression/results.md`, with
   the playbook version.

Run every case before merging a playbook version bump. A failed case blocks the merge until the
playbook or the case changes, and the reason goes in the pull request.

## First case

`2026-11-14-last-day-check`. It tests the last-day rule in the playbook's "The last day of a close
week" section. The advice must not rank a long-term swap first on the last day of a close week.
When no last-day fit beats the lineup, the headline must be HOLD.
