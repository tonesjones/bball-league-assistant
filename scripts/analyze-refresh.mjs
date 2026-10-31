import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = process.argv[2];
if (process.argv.length !== 3 || !/^\d{4}-\d\d-\d\d-\d{4}$/.test(path.basename(path.resolve(rawDir ?? '.')))) {
  console.error('usage: npm run refresh:analyze -- local/raw/YYYY-MM-DD-HHmm');
  process.exit(1);
}
const stamp = path.basename(path.resolve(rawDir));
const snapshotPath = path.join(root, 'local/snapshots', `${stamp}.json`);
const logDir = path.join(root, 'local/refreshes', stamp);
// A rerun of the same capture keeps the earlier attempt's logs in attempt-<n>/.
const earlier = existsSync(logDir) ? readdirSync(logDir).filter((f) => !/^attempt-\d+$/.test(f)) : [];
if (earlier.length) {
  const attempt = path.join(logDir, `attempt-${readdirSync(logDir).filter((f) => /^attempt-\d+$/.test(f)).length + 1}`);
  mkdirSync(attempt);
  for (const f of earlier) renameSync(path.join(logDir, f), path.join(attempt, f));
}
mkdirSync(logDir, { recursive: true });
// status.json says which steps finished, so a failed run is never mistaken for a complete one.
const stages = Object.fromEntries(['snapshot', 'game-logs', 'advice'].map((s) => [s, 'not run']));
const status = { capture: path.resolve(rawDir), stages, failedStep: null, decisionId: null };
const saveStatus = () => writeFileSync(path.join(logDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`);
function run(script, args, label) {
  console.log(`${label}...`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  const log = path.join(logDir, `${label}.txt`);
  writeFileSync(log, (result.stdout ?? '') + (result.stderr ?? ''));
  const ok = !result.error && result.status === 0;
  stages[label] = ok ? 'ok' : 'failed';
  if (ok) saveStatus();
  else {
    status.failedStep = label;
    saveStatus();
    console.error(`${label} failed. ${result.error?.message ?? ''} See ${log}`);
    console.error(`Steps: ${Object.entries(stages).map(([s, v]) => `${s} ${v}`).join('; ')}. No decision was made.`);
    process.exit(1);
  }
}
saveStatus();
run('build-snapshot.mjs', [path.resolve(rawDir)], 'snapshot');
const schedule = JSON.parse(readFileSync(path.join(root, 'data/schedule-2026-27.json'), 'utf8'));
run('fetch-gamelogs.mjs', ['--season', schedule.season, '--snapshot', snapshotPath], 'game-logs');
run('advise.mjs', [snapshotPath], 'advice');
const advice = JSON.parse(readFileSync(path.join(root, 'local/advice', `${stamp}.json`), 'utf8'));
status.decisionId = advice.decisionId;
saveStatus();
// Report sections 1, 2 and 8 come from the same code that formats the full report.
const { planSummary } = await import(pathToFileURL(path.join(root, 'scripts/advise.mjs')).href);
console.log(`\nDecision: ${advice.decisionId}`);
console.log(planSummary(advice).join('\n'));
console.log('Limitations: early season sample; prior-season per-minute rates; approximate category scores. See docs/limitations.md.');
console.log(`Full advice: ${path.join(logDir, 'advice.txt')}\nStep logs: ${logDir}`);
