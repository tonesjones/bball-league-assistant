# Generate and copy a ChatGPT brief

## Sub-features
- Explicit decision selection, standing decisions, immutable brief file and clipboard copy.

## How to get to it (user POV)
After successful analysis, run npm run brief -- <decisionId> --state
"C:\TestCode\Obsidian\Claude\10 Projects\bball-league-assistant state.md".
The command is one line with the actual freshly printed decision ID.

## Driving it with PowerShell
1. Read the standing state note as required by docs/update-league.md; flag conflicts with the snapshot.
2. Run the brief command, save its exit status and printed path, and verify the basename is exactly
   <decisionId>.md and the file contains that decision's as-of timestamp. Do not substitute another file.
3. Copy using Get-Content -Raw "<brief path>" | Set-Clipboard.
   Compare Get-Clipboard -Raw to the file contents locally without printing private contents.
   Record only equality and the selected ID. Clipboard copying is not proof of a paste into ChatGPT.
4. Verify the decision record still matches its immutable snapshot using the normal brief CLI checks.

## Gotchas
The brief CLI makes no network calls but consumes private files and the state note.
Reusing an ID with an existing brief fails intentionally rather than overwriting it.
Avoid running the no-ID default in a real refresh; newest decision may belong to another run.
The smoke helper uses a clearly synthetic brief file; it does not test brief generation or clipboard.
