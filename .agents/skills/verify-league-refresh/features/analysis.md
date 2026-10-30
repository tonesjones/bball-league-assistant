# Analyze one capture

## Sub-features
- Snapshot parsing, live ESPN log fetch, descriptive evidence, advice and decision record.
- Stale-input refusal and failed-step diagnostics.

## How to get to it (user POV)
Run npm run refresh:analyze -- local/raw/YYYY-MM-DD-HHmm with the actual verified capture folder.

## Driving it with PowerShell
1. Run Doctor first. Require a fresh, complete capture for full proof. Preserve previous timestamped
   step logs, advice, snapshot and evidence before rerunning that folder.
2. Run the command above with the actual folder and network-enabled shell execution. With restricted
   networking request normal require_escalated approval BEFORE the ESPN call.
3. Capture stdout/stderr and exit code. Require the final Decision, Evidence, Full advice and Step logs
   summary, not merely some output files. Confirm local/decisions/<printed-id>.json exists,
   its report.asOf and provenance.snapshotPath match this capture, and its commit matches this checkout.
4. Retain local/refreshes/<timestamp>/ step logs, evidence paths and exact new decision ID.
   status.json there lists each step as ok, failed or not run; a rerun moves the earlier
   attempt's logs to attempt-<n>/.
   Do not invent numbers or use an older decision on failure.

## Gotchas
The CLI writes caches, transaction history, evidence and immutable decisions and uses ESPN network.
It is not an offline test. Evidence enforces age independently and has no stale override.
A failed run may leave earlier outputs. Never change timestamps to pass freshness.
If network is denied, stop; do not reuse logs as freshly checked. smoke skips all these commands.
