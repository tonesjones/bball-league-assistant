import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { advise } from '../src/engine/v0-advice.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const number = (n) => n.toFixed(3);
const signed = (n) => `${n >= 0 ? '+' : ''}${number(n)}`;

export function formatAdvice(report) {
  const lines = [`Snapshot: ${report.asOf}`, `Week ${report.week}: ${report.window.start} to ${report.window.end}`,
    `From: ${report.fromDate} | Adds from: ${report.addsFrom} | Adds left: ${report.addsLeft}`, '',
    'Category     Mine       Opponent   P(win)   Need'];
  for (const [c, v] of Object.entries(report.baseline.categories)) {
    lines.push(`${c.padEnd(8)} ${number(v.mine).padStart(10)} ${number(v.opponent).padStart(10)} ${number(v.pWin).padStart(8)}   ${v.label}`);
  }
  lines.push('', ...report.notes, '', 'Suggestions:');
  const pairLines = (pair, i) => {
    lines.push(`${i + 1}. Pick up ${pair.pickup.name} (${pair.pickup.nbaTeam}, ${pair.pickup.status ?? 'healthy'}, ${pair.pickup.games} games from ${pair.pickupStart})`,
      `   Drop ${pair.drop.name} (${pair.drop.games} games left) | Score: ${signed(pair.score)} categories`);
    lines.push(`   ${Object.entries(pair.changes).map(([c, v]) => `${c}: total ${signed(v.total)}, P(win) ${signed(v.pWin)}`).join(' | ')}`);
  };
  report.suggestions.forEach(pairLines);
  if (!report.suggestions.length) lines.push('None.');
  lines.push('', 'Top pairs before distinct pickup/drop filter:');
  report.topPairs.forEach(pairLines);
  if (!report.topPairs.length) lines.push('None.');
  lines.push('', 'Unscored players:');
  for (const p of report.unscored) lines.push(`${p.name} (${p.nbaTeam}, ${p.where}): ${p.reason}`);
  if (!report.unscored.length) lines.push('None.');
  return lines.join('\n');
}

function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('dates must be YYYY-MM-DD');
  return value;
}

async function main(args) {
  let snapshotPath;
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--from') options.fromDate = date(args[++i]);
    else if (arg === '--adds-from') options.addsFrom = date(args[++i]);
    else if (arg === '--top') {
      const value = args[++i];
      if (!/^\d+$/.test(value ?? '')) throw new Error('--top must be a nonnegative integer');
      options.top = Number(value);
    } else if (arg.startsWith('-') || snapshotPath) throw new Error(`unexpected argument: ${arg}`);
    else snapshotPath = arg;
  }
  if (!snapshotPath) {
    const dir = 'local/snapshots';
    const files = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.json')).map(async (name) => {
      const file = path.join(dir, name);
      return { file, modified: (await stat(file)).mtimeMs };
    }));
    files.sort((a, b) => b.modified - a.modified || a.file.localeCompare(b.file));
    snapshotPath = files[0]?.file;
    if (!snapshotPath) throw new Error('no local/snapshots/*.json snapshots found');
  }
  const [snapshot, ids, priors, schedule, protection] = await Promise.all([
    snapshotPath, 'data/ids.json', 'data/priors/players.json', 'data/schedule-2026-27.json',
    'config/protected.json',
  ].map(readJson));
  const report = advise(snapshot, { ...options, ids, priors, schedule, protectedNames: protection.protected });
  const text = formatAdvice(report);
  const output = path.join('local/advice', path.basename(snapshotPath));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(text);
  console.log(`\nJSON: ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
