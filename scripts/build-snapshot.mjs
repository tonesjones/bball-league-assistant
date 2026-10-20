// Usage: node scripts/build-snapshot.mjs [rawDir]
// Parses a raw refresh folder (default: newest in local/raw/) into local/snapshots/<folder>.json.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
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
    if (/^(settings|team|matchup|transactions|fa-\d+)\.txt$/.test(f)) pages[f.slice(0, -4)] = readFileSync(join(dir, f), 'utf8');
  }
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
