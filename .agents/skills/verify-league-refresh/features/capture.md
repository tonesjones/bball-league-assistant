# Read-only Yahoo capture

## Sub-features
- Browser-runtime file export preflight.
- Nine required pages including settings and matchup shooting volume.
- Sign-in stop, URL restrictions, unchanged text, save verification and capture log.

## How to get to it (user POV)
Ask for a league refresh, or invoke league-refresh. Follow docs/update-league.md.

## Driving it with browser and filesystem
1. Use Tony's signed-in browser; follow the browser tool's documented runtime APIs. Do not assume
   shell clipboard transfer or a filesystem API exists in that runtime.
2. Before opening Yahoo, write a known string from that same runtime to a new capture folder's
   _write-test.txt; read back and compare exactly, then delete only that test file.
   A PowerShell-only write does NOT verify the browser-to-file route.
3. Open only allowed URLs and read only locator('body').innerText() in the in-app browser.
   Write the returned string directly, unchanged. Read every file back and compare length
   (exact equality when available). Only then mark ok in _log.txt.
4. Confirm settings.txt, team.txt, matchup.txt, matchup-totals.txt, fa-1.txt through fa-4.txt
   and transactions.txt all exist, are nonempty, and have verified ok entries.
5. Save proof of the write/read checks and the page log privately. Successful proof requires
   the actual browser runtime, not a synthetic shell write or unit test.

## Gotchas
A sign-in screen stops the entire capture; never sign in for Tony. No Yahoo clicks, typing,
evaluate, credential entry or HTTP/API fetching. Never use clipboard for page text.
Use the exact URLs and week handling in docs/update-league.md. Observe retry limits there.
A file with the right name does not prove valid content. No capture is performed by smoke.
