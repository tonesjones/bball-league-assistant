import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadProjectionLogs } from '../src/sources/gamelogs.mjs';

test('fetch CLI reparses cached finals, keeps DNPs, and records checked empty days', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-fetch-logs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logDir = path.join(dir, 'local/gamelogs/2026-27');
  const cacheDir = path.join(dir, 'local/cache/espn');
  await mkdir(logDir, { recursive: true }); await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(logDir, '2026-10-21.json'), '[{"old":true}]');
  const summary = { header: { id: 'synthetic-game' }, boxscore: { players: [{ team: { abbreviation: 'NO' }, statistics: [{
    labels: ['MIN','PTS','FG','3PT','FT','REB','AST','TO','STL','BLK'], athletes: [
      { athlete: { id: '1', displayName: 'Sample Starter' }, starter: true, didNotPlay: false, stats: ['30','13','5-6','0-0','3-4','14','5','1','2','3'] },
      { athlete: { id: '2', displayName: 'Sample DNP' }, starter: false, didNotPlay: true, reason: "COACH'S DECISION", stats: [] },
    ],
  }] }] } };
  await writeFile(path.join(cacheDir, 'summary-synthetic-game.json'), JSON.stringify(summary));
  const preload = path.join(dir, 'mock-source.mjs');
  await writeFile(preload, `globalThis.fetch = async (url) => {
    if (!url.includes('/scoreboard?dates=')) throw new Error('Final summary should come from cache');
    const events = url.endsWith('20261021') ? [{ id: 'synthetic-game', status: { type: { name: 'STATUS_FINAL' } } }] : [];
    return { ok: true, json: async () => ({ events }) };
  };`);
  const snapshot = path.join(dir, 'snapshot.json');
  const asOf = '2026-10-22T20:00:00Z';
  await writeFile(snapshot, JSON.stringify({ asOf }));
  const cli = fileURLToPath(new URL('../scripts/fetch-gamelogs.mjs', import.meta.url));
  execFileSync(process.execPath, ['--import', pathToFileURL(preload).href, cli, '--season', '2026-27', '--from', '2026-10-21', '--snapshot', snapshot], { cwd: dir });
  const loaded = await loadProjectionLogs('2026-27', { root: path.join(dir, 'local/gamelogs'), from: '2026-10-21', asOf });
  assert.equal(loaded.logs.length, 2);
  assert.equal(loaded.logs[0].starter, true);
  assert.equal(loaded.logs[0].team, 'NOP');
  assert.equal(loaded.logs[1].didNotPlay, true);
  assert.equal(loaded.logs[1].min, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(logDir, '2026-10-22.json'))), []);
});
