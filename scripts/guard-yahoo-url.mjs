// PreToolUse hook for browser navigation. Reads the tool call as JSON on stdin and exits 2
// (blocking the call) when it would open a Yahoo page outside the read-only list.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkUrl } from '../src/sources/yahoo-urls.mjs';

function leagueIdFromEnv() {
  const dir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  try {
    const m = readFileSync(join(dir, '.env'), 'utf8').match(/^YAHOO_LEAGUE_ID=(\d+)\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const input = JSON.parse(readFileSync(0, 'utf8'));
const reason = checkUrl(input.tool_input?.url, leagueIdFromEnv());
if (reason) {
  process.stderr.write(`Blocked by the read-only Yahoo guard: ${reason}. See docs/update-league.md.\n`);
  process.exit(2);
}
