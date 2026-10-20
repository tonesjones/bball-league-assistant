import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { matchSnapshot } from '../src/sources/id-map.mjs';

let file = process.argv[2];
if (!file) {
  const files = (await readdir('local/snapshots')).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error('no snapshots in local/snapshots');
  file = join('local', 'snapshots', files.at(-1));
}
const result = matchSnapshot(JSON.parse(await readFile(file, 'utf8')), JSON.parse(await readFile('data/ids.json', 'utf8')));
console.log(`Matched ${result.matched.length}; unmatched ${result.unmatched.length}`);
for (const p of result.unmatched) console.log(`${p.name} (${p.nbaTeam}) [${p.where}]`);
await mkdir(join('local', 'reports'), { recursive: true });
await writeFile(join('local', 'reports', 'ids-snapshot-unmatched.json'), JSON.stringify(result.unmatched, null, 2));
