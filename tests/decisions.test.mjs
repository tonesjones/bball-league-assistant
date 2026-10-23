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
import { projectPlayers } from '../src/engine/projections.mjs';
import { hash } from '../src/sources/bakeoff-records.mjs';
import { zeroLine } from '../src/engine/lineup-replay.mjs';

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

test('record saves each source lineup, rejects duplicate arms and prepares a hashed rehearsal packet', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-replay-record-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
  const projections = projectPlayers(f.priors, f.ids, []);
  const report = advise(f.snapshot, { ...f, projections, protectRank: 0 });
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await mkdir(path.join(dir, 'docs'), { recursive: true });
  await writeFile(path.join(dir, 'docs/bakeoff-prompt.md'), await readFile(new URL('../docs/bakeoff-prompt.md', import.meta.url)));
  await writeFile(path.join(dir, 'data/ids.json'), JSON.stringify(f.ids));
  await writeFile(path.join(dir, 'data/schedule-2026-27.json'), JSON.stringify(f.schedule));
  const snapshotPath = path.join(dir, 'snapshot.json'), snapshotText = JSON.stringify(f.snapshot);
  await writeFile(snapshotPath, snapshotText);
  const saved = await saveDecision({ report, options: report.options, projections,
    provenance: { snapshotPath, snapshotHash: hash(snapshotText), idsHash: hash(JSON.stringify(f.ids)),
      scheduleHash: hash(JSON.stringify(f.schedule)), gameLogCoverage: { hashes: {} } } }, path.join(dir, 'local/decisions'));
  const base = { decisionId: saved.id, week: report.week, date: '2026-10-20', asOf: report.asOf,
    decision: 'hold', add: null, drop: null, chatbot: null, rating: null };
  const entries = [{ ...base, source: 'tool' }, { ...base, source: 'none' },
    { ...base, source: 'chatbot', chatbot: 'Example', decision: 'move', start: '2026-10-20',
      add: { name: 'Casey Fiction', espnId: '3' }, drop: { name: 'Alex Sample', espnId: '1' } }];
  const input = path.join(dir, 'entries.json'); await writeFile(input, JSON.stringify(entries));
  const cli = fileURLToPath(new URL('../scripts/bakeoff.mjs', import.meta.url));
  const run = () => execFileSync(process.execPath, [cli, 'record', input], { cwd: dir, stdio: 'pipe' });
  run();
  const logPath = path.join(dir, 'local/bakeoff.jsonl'), before = await readFile(logPath, 'utf8');
  const rows = before.trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows[0].lineups.proposed, rows[0].lineups.baseline);
  assert.notDeepEqual(rows[2].lineups.proposed, rows[0].lineups.proposed);
  assert.ok(rows[2].lineups.proposed.some((g) => g.espnId === '3'));
  assert.ok(rows.every((r) => r.recordedAt));
  assert.throws(run, /already recorded/);
  assert.equal(await readFile(logPath, 'utf8'), before);
  const starts = new Map(rows.flatMap((r) => [...r.lineups.baseline, ...r.lineups.proposed, ...r.lineups.opponent])
    .map((g) => [`${g.date}/${g.espnId}`, g]));
  const byDay = new Map();
  for (const g of starts.values()) {
    if (!byDay.has(g.date)) byDay.set(g.date, []);
    byDay.get(g.date).push({ ...zeroLine(), date: g.date, espnId: g.espnId, didNotPlay: false,
      espnEventId: `game-${g.date}`, pts: 20 });
  }
  const logsDir = path.join(dir, 'local/gamelogs/2026-27'); await mkdir(logsDir, { recursive: true });
  for (const [date, lines] of byDay) await writeFile(path.join(logsDir, `${date}.json`), JSON.stringify(lines));
  const scored = execFileSync(process.execPath, [cli, 'score', '--week', '1', '--from', report.window.start, '--to', report.window.end], { cwd: dir, encoding: 'utf8' });
  assert.match(scored, /tool\t-\thold\tscored/);
  assert.match(scored, /chatbot\tExample\tmove\tscored/);
  assert.match(scored, /not a weekly plan/);
  const prepare = fileURLToPath(new URL('../scripts/prepare-pilot.mjs', import.meta.url));
  execFileSync(process.execPath, [prepare, saved.id], { cwd: dir, stdio: 'pipe' });
  const folder = path.join(dir, 'local/pilot-packets', (await readdir(path.join(dir, 'local/pilot-packets')))[0]);
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json')));
  assert.equal(manifest.status, 'rehearsal-not-frozen');
  for (const [name, expected] of Object.entries(manifest.hashes)) assert.equal(hash(await readFile(path.join(folder, name))), expected);
  assert.ok(manifest.hashes['evidence.json']);
  assert.ok(!manifest.hashes['report.json']);
  await writeFile(path.join(dir, 'data/ids.json'), '{}');
  assert.throws(() => execFileSync(process.execPath, [prepare, saved.id], { cwd: dir, stdio: 'pipe' }), /ids hash changed/);
});
