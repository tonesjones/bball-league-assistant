import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as decisions from '../src/sources/decisions.mjs';
import * as advise from '../scripts/advise.mjs';
import { latestDecisionId } from '../scripts/did.mjs';
import { easternDate, logHash } from '../src/sources/gamelogs.mjs';

const cli = fileURLToPath(new URL('../scripts/advise.mjs', import.meta.url));
const fixture = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url), 'utf8'));

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-default-decisions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const through = easternDate(fixture.snapshot.asOf), text = '[]\n';
  const files = { 'snapshot.json': fixture.snapshot, 'data/ids.json': fixture.ids,
    'data/priors/players.json': fixture.priors, 'data/schedule-2026-27.json': fixture.schedule,
    'local/gamelogs/2026-27/_coverage.json': { from: through, through, checkedAt: fixture.snapshot.asOf,
      hashes: { [through]: logHash(text) } } };
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), JSON.stringify(value));
  }
  await writeFile(path.join(dir, `local/gamelogs/2026-27/${through}.json`), text);
  const decisionsDir = path.join(dir, 'local/decisions');
  const previous = await decisions.saveDecision({ report: { asOf: fixture.snapshot.asOf } }, decisionsDir);
  const logPath = path.join(dir, 'local/bakeoff.jsonl');
  await writeFile(logPath, JSON.stringify({ decisionId: previous.id, source: 'none', decision: 'hold' }) + '\n');
  return { dir, decisionsDir, logPath, run: (...args) => execFileSync(process.execPath,
    [cli, 'snapshot.json', '--allow-stale', ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }) };
}

test('advise failure after planning leaves existing decisions and shadow log unchanged', async (t) => {
  for (const failure of ['advice folder is a file', 'advice output is a directory']) {
    await t.test(failure, async (t) => {
      const s = await setup(t);
      const before = await readdir(s.decisionsDir), logBefore = await readFile(s.logPath, 'utf8');
      if (failure === 'advice folder is a file') await writeFile(path.join(s.dir, 'local/advice'), 'blocked');
      else await mkdir(path.join(s.dir, 'local/advice/snapshot.json'), { recursive: true });
      assert.throws(() => s.run(), /EEXIST|EISDIR|EPERM/);
      assert.deepEqual(await readdir(s.decisionsDir), before);
      assert.equal(await readFile(s.logPath, 'utf8'), logBefore);
    });
  }
});

test('shared decision picker prefers the newest capture over a later-written older capture', async (t) => {
  const s = await setup(t);
  for (const file of await readdir(s.decisionsDir)) await rm(path.join(s.decisionsDir, file));
  const records = [
    { id: 'new-data', report: { asOf: '2026-10-30T22:00:00Z' }, createdAt: '2026-10-30T22:01:00Z' },
    { id: 'old-data-rerun', report: { asOf: '2026-10-30T21:54:00Z' }, createdAt: '2026-10-30T22:10:00Z' },
  ];
  const put = (record) => writeFile(path.join(s.decisionsDir, `${record.id}.json`), JSON.stringify(record));
  for (const r of records) await put(r);
  assert.equal(await latestDecisionId(s.decisionsDir), 'new-data');
  assert.equal((await decisions.newestDecision(s.decisionsDir)).id, 'new-data');
  await put({ ...records[0], id: 'tie-newer', createdAt: '2026-10-30T22:12:00Z' });
  await put({ id: 'invalid-asof', report: { asOf: 'invalid' }, createdAt: '2026-11-01T00:00:00Z' });
  await put({ id: 'missing-asof', createdAt: '2026-11-02T00:00:00Z' });
  assert.equal((await decisions.newestDecision(s.decisionsDir)).id, 'tie-newer');
});

test('roster check refuses pre-add captures, permits later captures, legacy entries and an override', () => {
  const asOf = '2026-10-30T22:00:00Z', recordedAt = '2026-10-30T22:05:00.000Z';
  const move = { source: 'tony', decision: 'move', recordedAt };
  assert.throws(() => advise.snapshotRosterChanges(asOf, [move]),
    (err) => err.message.includes(asOf) && err.message.includes(recordedAt) && /capture again/i.test(err.message));
  assert.doesNotThrow(() => advise.snapshotRosterChanges(recordedAt, [move]));
  assert.doesNotThrow(() => advise.snapshotRosterChanges('2026-10-30T22:06:00Z', [move]));
  assert.doesNotThrow(() => advise.snapshotRosterChanges(asOf, [{ ...move, recordedAt: undefined }]));
  assert.doesNotThrow(() => advise.snapshotRosterChanges(asOf, [{ ...move, source: 'tool' }, { ...move, decision: 'hold' }]));
  assert.doesNotThrow(() => advise.snapshotRosterChanges(asOf, [move], { allowRosterChange: true }));
});

test('advise blocks a recorded roster change before saving and persists the explicit override', async (t) => {
  const s = await setup(t), recordedAt = new Date(Date.parse(fixture.snapshot.asOf) + 1).toISOString();
  await writeFile(s.logPath, JSON.stringify({ source: 'tony', decision: 'move', recordedAt }) + '\n');
  const before = await readdir(s.decisionsDir), logBefore = await readFile(s.logPath, 'utf8');
  assert.throws(() => s.run(), /capture again/i);
  assert.deepEqual(await readdir(s.decisionsDir), before);
  assert.equal(await readFile(s.logPath, 'utf8'), logBefore);
  s.run('--allow-roster-change');
  const report = JSON.parse(await readFile(path.join(s.dir, 'local/advice/snapshot.json'), 'utf8'));
  const saved = await decisions.readDecision(report.decisionId, s.decisionsDir);
  assert.equal(saved.options.allowRosterChange, true);
  assert.equal(saved.report.decisionId, saved.id);
});
