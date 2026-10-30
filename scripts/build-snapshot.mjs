// Usage: node scripts/build-snapshot.mjs [rawDir]
// Parses a raw refresh folder (default: newest in local/raw/) into local/snapshots/<folder>.json.
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../src/sources/yahoo-pages/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER = /^(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)$/;

function main() {
  let dir = process.argv[2];
  if (!dir) {
    const rawRoot = join(root, 'local', 'raw');
    const newest = readdirSync(rawRoot).filter((f) => FOLDER.test(f)).sort().pop();
    if (!newest) throw new Error(`no raw folders in ${rawRoot}`);
    dir = join(rawRoot, newest);
  }
  const folder = basename(resolve(dir));
  const m = FOLDER.exec(folder);
  if (!m) throw new Error(`folder name ${folder} is not YYYY-MM-DD-HHmm`);
  const asOf = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString();

  const pages = {};
  for (const f of readdirSync(dir)) {
    if (/^(settings|team|matchup|matchup-totals|transactions|fa-\d+)\.txt$/.test(f)) pages[f.slice(0, -4)] = readFileSync(join(dir, f), 'utf8');
  }
  const teamsDir = join(dir, 'teams');
  if (existsSync(teamsDir)) {
    for (const f of readdirSync(teamsDir)) {
      if (/^\d+\.txt$/.test(f)) pages[`teams/${f.slice(0, -4)}`] = readFileSync(join(teamsDir, f), 'utf8');
    }
  }
  // An empty file or a page the capture logged as skipped or sign-in means the capture is
  // incomplete; say so instead of failing later on a confusing parse error. Agents write
  // _log.txt by hand, so only "<file> <url> <status>" lines count (with spaces or "|" between),
  // and a later line for the same file replaces an earlier one.
  const problems = Object.entries(pages).filter(([, text]) => !text.trim()).map(([k]) => `${k}.txt is empty`);
  const log = join(dir, '_log.txt');
  if (existsSync(log)) {
    const status = {};
    for (const line of readFileSync(log, 'utf8').split(/\r?\n/)) {
      const m = /^(\S+\.txt)[\s|]+https?:\/\/\S+[\s|]*(.*)$/.exec(line.trim());
      if (m) status[m[1]] = m[2];
    }
    for (const [file, s] of Object.entries(status)) if (/^(skipped|sign-in)\b/i.test(s)) problems.push(`${file} logged ${s.split(/[\s:;]/)[0]}`);
  }
  if (problems.length) throw new Error(`capture incomplete: ${problems.join('; ')}. Recapture before analysis.`);
  const snapshot = buildSnapshot(pages, asOf);

  const out = join(root, 'local', 'snapshots', `${folder}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`wrote ${out}`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
