import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { easternDate, logHash } from '../src/sources/gamelogs.mjs';

test('evidence CLI saves outside stats and private transaction history; reruns do not duplicate events', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-evidence-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
  const asOf = new Date().toISOString(), date = easternDate(asOf);
  f.snapshot.asOf = asOf;
  f.snapshot.team.name = 'Sample Team';
  f.snapshot.transactions = [{ team: 'Sample Team', time: 'Oct 21, 1:11 am', moves: [{ type: 'add', player: 'Example Add', faab: 0 }] }];
  f.schedule.games = [{ date, home: 'AAA', away: 'BBB' }];
  const name = `${date}-1200`;
  const row = { espnId: '1', espnEventId: 'sample', date, min: 24, starter: true, didNotPlay: false,
    pts: 12, reb: 6, ast: 3, stl: 1, blk: 2, to: 2, fg3m: 1, fgm: 5, fga: 10, ftm: 1, fta: 2,
    teamContext: { minutes: 240, fga: 80, fta: 20, to: 16 } };
  const text = JSON.stringify([row]);
  const files = { [`local/snapshots/${name}.json`]: f.snapshot, 'data/ids.json': f.ids, 'data/schedule-2026-27.json': f.schedule,
    'local/gamelogs/2026-27/_coverage.json': { from: date, through: date, checkedAt: asOf, hashes: { [date]: logHash(text) } } };
  for (const [file, data] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), JSON.stringify(data));
  }
  await writeFile(path.join(dir, `local/gamelogs/2026-27/${date}.json`), text);
  const cli = fileURLToPath(new URL('../scripts/player-evidence.mjs', import.meta.url));
  const run = () => execFileSync(process.execPath, [cli, `local/snapshots/${name}.json`], { cwd: dir, encoding: 'utf8' });
  assert.match(run(), /Newly archived: 1/);
  assert.match(run(), /Newly archived: 0/);
  const report = JSON.parse(await readFile(path.join(dir, `local/evidence/${name}.json`)));
  assert.equal(report.roster[0].season.perGame.pts, 12);
  assert.ok(report.roster[0].season.estimatedUsgPct > 0);
  assert.equal(report.transactions.mine.length, 1);
  assert.equal((await readFile(path.join(dir, 'local/transactions/history.jsonl'), 'utf8')).trim().split('\n').length, 1);
  assert.match(await readFile(path.join(dir, `local/evidence/${name}.md`), 'utf8'), /not official NBA USG%/);
});
