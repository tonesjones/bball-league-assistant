import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectPlayers } from '../src/engine/projections.mjs';
import { hash } from '../src/sources/bakeoff-records.mjs';
import { zeroLine } from '../src/engine/lineup-replay.mjs';
import { saveDecision, readDecision } from '../src/sources/decisions.mjs';
import { planWeek } from '../src/engine/week-plan.mjs';
import { validateEntry } from '../src/engine/bakeoff.mjs';

const plan = (f, projections = { players: f.priors }) => planWeek({ snapshot: f.snapshot, schedule: f.schedule,
  projections, ids: f.ids, options: { protectRank: 0 } });

test('reruns retain separate immutable records, options and exact daily lineups', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-decisions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
  const report = plan(f);
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
  assert.ok(a.report.startsByDay.length);
  for (const day of a.report.startsByDay) assert.ok(Number.isInteger(day.pickupStarts));
  assert.equal(a.provenance.commit, 'abc123');
  await assert.rejects(readDecision('../outside', dir), /decisionId/);
});

test('every bakeoff source must identify the shared decision record', () => {
  const base = { week: 1, date: '2026-10-20', decision: 'hold', add: null, drop: null, rating: null, asOf: '2026-10-20T12:00:00Z', chatbot: null };
  for (const source of ['tool', 'chatbot', 'none', 'tony']) {
    const entry = { ...base, source, chatbot: source === 'chatbot' ? 'Example' : null, ...(source === 'tony' ? { tag: 'no-effect' } : {}) };
    assert.throws(() => validateEntry(entry), /decisionId/);
    assert.equal(validateEntry({ ...entry, decisionId: 'example-decision' }).decisionId, 'example-decision');
  }
});

const cli = fileURLToPath(new URL('../scripts/bakeoff.mjs', import.meta.url));
async function recorded(dir, snapshot, name, decision) {
  const f = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
  const projections = projectPlayers(f.priors, f.ids, []);
  const report = plan({ ...f, snapshot }, projections);
  if (decision) report.decision = decision;
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await writeFile(path.join(dir, 'data/ids.json'), JSON.stringify(f.ids));
  await writeFile(path.join(dir, 'data/schedule-2026-27.json'), JSON.stringify(f.schedule));
  const snapshotPath = path.join(dir, `${name}.json`), text = JSON.stringify(snapshot);
  await writeFile(snapshotPath, text);
  const saved = await saveDecision({ report, options: report.options, projections,
    provenance: { snapshotPath, snapshotHash: hash(text), idsHash: hash(JSON.stringify(f.ids)),
      scheduleHash: hash(JSON.stringify(f.schedule)), gameLogCoverage: { hashes: {} } } }, path.join(dir, 'local/decisions'));
  const base = { decisionId: saved.id, week: report.week, date: '2026-10-20', asOf: report.asOf, chatbot: null, rating: null };
  return { report, base, record: async (entries) => {
    const input = path.join(dir, `${name}-entries.json`);
    await writeFile(input, JSON.stringify(entries));
    return execFileSync(process.execPath, [cli, 'record', input], { cwd: dir, stdio: 'pipe' });
  } };
}

test('record saves tool, none and tony lineups, rejects duplicates and score replays them', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-replay-record-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
  const { report, base, record } = await recorded(dir, f.snapshot, 'full');
  const hold = { decision: 'hold', add: null, drop: null };
  await record([{ ...base, source: 'tool', ...hold }, { ...base, source: 'none', ...hold },
    { ...base, source: 'tony', tag: 'changed-decision', decision: 'move', start: '2026-10-20',
      add: { name: 'Casey Fiction', espnId: '3' }, drop: { name: 'Alex Sample', espnId: '1' } }]);
  const logPath = path.join(dir, 'local/bakeoff.jsonl'), before = await readFile(logPath, 'utf8');
  const rows = before.trim().split(String.fromCharCode(10)).map(JSON.parse);
  assert.deepEqual(rows[0].lineups.proposed, rows[0].lineups.baseline);
  assert.notDeepEqual(rows[2].lineups.proposed, rows[0].lineups.proposed);
  assert.ok(rows[2].lineups.proposed.some((g) => g.espnId === '3'));
  assert.ok(rows.every((r) => r.recordedAt));
  await assert.rejects(record([{ ...base, source: 'none', ...hold }]), /already recorded/);
  assert.equal(await readFile(logPath, 'utf8'), before);
  const starts = new Map(rows.flatMap((r) => [...r.lineups.baseline, ...r.lineups.proposed, ...r.lineups.opponent]).map((g) => [`${g.date}/${g.espnId}`, g]));
  const byDay = new Map();
  for (const g of starts.values()) byDay.set(g.date, [...(byDay.get(g.date) ?? []), { ...zeroLine(), date: g.date, espnId: g.espnId, didNotPlay: false, espnEventId: `game-${g.date}`, pts: 20 }]);
  const logsDir = path.join(dir, 'local/gamelogs/2026-27'); await mkdir(logsDir, { recursive: true });
  for (const [date, lines] of byDay) await writeFile(path.join(logsDir, `${date}.json`), JSON.stringify(lines));
  const scored = execFileSync(process.execPath, [cli, 'score', '--week', '1', '--from', report.window.start, '--to', report.window.end], { cwd: dir, encoding: 'utf8' });
  assert.match(scored, /tool.-.hold.scored/);
  assert.match(scored, /tony.-.move.scored/);
  assert.match(scored, /not a weekly plan/);
});

test('record attaches an add-only tool move into an open spot and refuses one for a full roster', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-add-only-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
  const move = { action: 'move', pair: { pickup: { name: 'Casey Fiction', nbaTeam: 'CCC', espnId: '3' }, drop: null, pickupStart: '2026-10-21' } };
  const entry = (base) => [{ ...base, source: 'tool', decision: 'move', start: '2026-10-21', add: { name: 'Casey Fiction', espnId: '3' }, drop: null }];
  const open = structuredClone(f.snapshot);
  open.team.roster[0].slot = 'IL+';
  const a = await recorded(dir, open, 'open', move);
  await a.record(entry(a.base));
  const [row] = (await readFile(path.join(dir, 'local/bakeoff.jsonl'), 'utf8')).trim().split(String.fromCharCode(10)).map(JSON.parse);
  assert.equal(row.drop, null);
  assert.ok(!row.lineups.baseline.some((g) => g.espnId === '3'));
  assert.deepEqual(row.lineups.proposed.filter((g) => g.espnId === '3').map((g) => g.date), ['2026-10-21']);
  const b = await recorded(dir, f.snapshot, 'full', move);
  await assert.rejects(b.record(entry(b.base)), /needs an open roster spot/);
});
