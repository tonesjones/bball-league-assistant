import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../scripts/build-snapshot.mjs', import.meta.url));
const fixture = (name) => new URL(`./fixtures/yahoo-pages/${name}.txt`, import.meta.url);

async function capture(t) {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), 'bball-capture-')), '2026-10-27-1100');
  t.after(() => rm(path.dirname(dir), { recursive: true, force: true }));
  await mkdir(dir);
  for (const name of ['settings', 'team', 'matchup', 'fa-1', 'transactions']) await copyFile(fixture(name), path.join(dir, `${name}.txt`));
  return dir;
}
const build = (dir) => spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' });

test('an empty page file stops the build as an incomplete capture', async (t) => {
  const dir = await capture(t);
  await writeFile(path.join(dir, 'settings.txt'), '');
  const result = build(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^capture incomplete: settings\.txt is empty\. Recapture before analysis\./);
});

test('a page logged skipped or sign-in stops the build; a later ok line for the same page replaces it', async (t) => {
  const dir = await capture(t);
  const url = 'https://example.invalid/page';
  await writeFile(path.join(dir, '_log.txt'), [
    `settings.txt ${url} ok`,
    `team.txt | ${url} | sign-in; capture stopped`,
    `matchup.txt ${url} skipped: roster missing`,
    `matchup.txt ${url} ok after retry`,
    `fa-1.txt ${url} skipped: save check failed`,
  ].join('\n'));
  const result = build(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^capture incomplete: team\.txt logged sign-in; fa-1\.txt logged skipped\./);
});
