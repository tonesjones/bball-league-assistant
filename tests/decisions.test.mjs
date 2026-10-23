import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { saveDecision, readDecision } from '../src/sources/decisions.mjs';
import { advise } from '../src/engine/v0-advice.mjs';
import { validateEntry } from '../src/engine/bakeoff.mjs';

test('reruns retain separate immutable records, options and exact daily lineups', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-decisions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
  const report = advise(f.snapshot, { ...f, protectRank: 0 });
  const provenance = { commit: 'abc123', snapshotPath: 'local/snapshots/example.json', projectionVersion: 'prior-v1:hash' };
  const first = await saveDecision({ report, options: { holdBelow: 0.15 }, provenance }, dir);
  const before = await readFile(first.path, 'utf8');
  const second = await saveDecision({ report, options: { holdBelow: 0.3 }, provenance }, dir);
  assert.notEqual(first.id, second.id);
  assert.equal((await readdir(dir)).length, 2);
  assert.equal(await readFile(first.path, 'utf8'), before);
  const a = await readDecision(first.id, dir), b = await readDecision(second.id, dir);
  assert.equal(a.options.holdBelow, 0.15);
  assert.equal(b.options.holdBelow, 0.3);
  assert.deepEqual(a.report.baselineLineups, report.baselineLineups);
  assert.ok(a.report.baselineLineups.mine.length);
  for (const pair of a.report.topPairs) assert.ok(Array.isArray(pair.lineup.started));
  assert.equal(a.provenance.commit, 'abc123');
  await assert.rejects(readDecision('../outside', dir), /decisionId/);
});

test('every bakeoff source must identify the shared decision record', () => {
  const base = { week: 1, date: '2026-10-20', decision: 'hold', add: null, drop: null, rating: null, asOf: '2026-10-20T12:00:00Z', chatbot: null };
  for (const source of ['tool', 'chatbot', 'none']) {
    const entry = { ...base, source, chatbot: source === 'chatbot' ? 'Example' : null };
    assert.throws(() => validateEntry(entry), /decisionId/);
    assert.equal(validateEntry({ ...entry, decisionId: 'example-decision' }).decisionId, 'example-decision');
  }
});

test('bakeoff records three sources against one decision and rejects broken links before appending', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-bakeoff-links-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const records = path.join(dir, 'local/decisions');
  await mkdir(records, { recursive: true });
  const saved = await saveDecision({ report: { week: 1, asOf: '2026-10-20T12:00:00Z' }, options: {}, provenance: {} }, records);
  const entries = ['tool', 'chatbot', 'none'].map((source) => ({ decisionId: saved.id, week: 1, date: '2026-10-20', decision: 'hold', add: null, drop: null, rating: null, asOf: '2026-10-20T12:00:00Z', source, chatbot: source === 'chatbot' ? 'Example' : null }));
  const input = path.join(dir, 'entries.json');
  await writeFile(input, JSON.stringify(entries));
  const cli = fileURLToPath(new URL('../scripts/bakeoff.mjs', import.meta.url));
  const run = () => execFileSync(process.execPath, [cli, 'record', input], { cwd: dir, stdio: 'pipe' });
  run();
  const before = await readFile(path.join(dir, 'local/bakeoff.jsonl'), 'utf8');
  assert.equal(before.trim().split('\n').length, 3);
  await writeFile(input, JSON.stringify([entries[0], { ...entries[1], decisionId: 'missing' }]));
  assert.throws(run, /ENOENT/);
  assert.equal(await readFile(path.join(dir, 'local/bakeoff.jsonl'), 'utf8'), before);
  await writeFile(input, JSON.stringify([{ ...entries[0], week: 2 }]));
  assert.throws(run, /week\/asOf must match/);
});
