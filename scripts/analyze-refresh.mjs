import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = process.argv[2];
if (process.argv.length !== 3 || !/^\d{4}-\d\d-\d\d-\d{4}$/.test(path.basename(path.resolve(rawDir ?? '.')))) {
  console.error('usage: npm run refresh:analyze -- local/raw/YYYY-MM-DD-HHmm');
  process.exit(1);
}
const stamp = path.basename(path.resolve(rawDir));
const snapshotPath = path.join(root, 'local/snapshots', `${stamp}.json`);
const logDir = path.join(root, 'local/refreshes', stamp);
mkdirSync(logDir, { recursive: true });
function run(script, args, label) {
  console.log(`${label}...`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  const log = path.join(logDir, `${label}.txt`);
  writeFileSync(log, (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.error || result.status !== 0) {
    console.error(`${label} failed. ${result.error?.message ?? ''} See ${log}`);
    process.exit(1);
  }
}
run('build-snapshot.mjs', [path.resolve(rawDir)], 'snapshot');
const schedule = JSON.parse(readFileSync(path.join(root, 'data/schedule-2026-27.json'), 'utf8'));
run('fetch-gamelogs.mjs', ['--season', schedule.season, '--snapshot', snapshotPath], 'game-logs');
run('player-evidence.mjs', [snapshotPath], 'evidence');
run('advise.mjs', [snapshotPath], 'advice');
const evidencePath = path.join(root, 'local/evidence', `${stamp}.json`);
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
const advice = JSON.parse(readFileSync(path.join(root, 'local/advice', `${stamp}.json`), 'utf8'));
console.log(`\nAs of: ${advice.asOf}\nDecision: ${advice.decision.action} (${advice.decisionId})`);
if (advice.decision.reason) console.log(advice.decision.reason);
if (advice.decision.pair) {
  const p = advice.decision.pair;
  console.log(`Add ${p.pickup.name}; ${p.drop ? `drop ${p.drop.name}` : 'no drop (open roster spot)'}; approximate category gain ${p.score.toFixed(3)}`);
  console.log(`Scenario gain range: ${p.scoreRange.map((n) => n.toFixed(3)).join(' to ')}`);
  for (const [category, change] of Object.entries(p.changes)) {
    console.log(`${category}: projected total change ${change.total.toFixed(3)}; approximate category probability change ${change.pWin.toFixed(3)}`);
  }
}
for (const [category, outlook] of Object.entries(advice.baseline?.categories ?? {})) {
  if (outlook.label === 'unknown') console.log(`${category}: unknown; excluded from score`);
}
console.log(`Adds left: ${advice.addsLeft}; unknown starts: yours ${advice.unknownGames.mine}, opponent ${advice.unknownGames.opponent}`);
console.log(`Newly archived transaction groups: ${evidence.transactions.newlyArchived}`);
for (const r of evidence.transactions.newlyArchivedEvents) {
  console.log(`${r.event.team} (${r.event.time}): ${r.event.moves.map((m) => `${m.type} ${m.player}${m.faab != null ? ` ($${m.faab})` : ''}`).join('; ')}`);
}
console.log('Newly archived means first seen in saved captures, not necessarily made since the previous refresh.');
console.log('Limitations: early season sample; prior-season per-minute rates; approximate category scores. See docs/limitations.md.');
console.log(`Evidence: ${evidencePath.replace(/\.json$/, '.md')}\nFull advice: ${path.join(logDir, 'advice.txt')}\nStep logs: ${logDir}`);
