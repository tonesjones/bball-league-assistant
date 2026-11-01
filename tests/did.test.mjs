import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planWeek } from '../src/engine/week-plan.mjs';
import { projectPlayers } from '../src/engine/projections.mjs';
import { saveDecision } from '../src/sources/decisions.mjs';
import { hash } from '../src/sources/bakeoff-records.mjs';
import { zeroLine } from '../src/engine/lineup-replay.mjs';
import { choices } from '../scripts/did.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
const did = fileURLToPath(new URL('../scripts/did.mjs', import.meta.url));
const bakeoff = fileURLToPath(new URL('../scripts/bakeoff.mjs', import.meta.url));
const MOVE = { action: 'move', pair: { pickup: { name: 'Casey Fiction', nbaTeam: 'CCC', espnId: '3' },
  drop: { name: 'Alex Sample', nbaTeam: 'AAA', espnId: '1' }, pickupStart: '2026-10-21' } };

// One synthetic decision in a temp dir. The engine holds on this fixture unless engine is 'move'.
async function setup(t, { engine = 'hold', patch = {} } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-did-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture, projections = projectPlayers(f.priors, f.ids, []);
  const report = planWeek({ snapshot: f.snapshot, schedule: f.schedule, projections, ids: f.ids, options: { protectRank: 0 } });
  if (engine === 'move') report.decision = MOVE;
  Object.assign(report, patch);
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await writeFile(path.join(dir, 'data/ids.json'), JSON.stringify(f.ids));
  await writeFile(path.join(dir, 'data/schedule-2026-27.json'), JSON.stringify(f.schedule));
  const snapshotPath = path.join(dir, 'snapshot.json'), text = JSON.stringify(f.snapshot);
  await writeFile(snapshotPath, text);
  const saved = await saveDecision({ report, options: report.options, projections,
    provenance: { snapshotPath, snapshotHash: hash(text), idsHash: hash(JSON.stringify(f.ids)),
      scheduleHash: hash(JSON.stringify(f.schedule)), gameLogCoverage: { hashes: {} } } }, path.join(dir, 'local/decisions'));
  const base = { decisionId: saved.id, week: report.week, date: '2026-10-20', asOf: report.asOf, chatbot: null, rating: null };
  const engineEntries = [{ ...base, source: 'none', decision: 'hold', add: null, drop: null },
    { ...base, source: 'tool', ...(engine === 'move' ? { decision: 'move', start: '2026-10-21', add: { name: 'Casey Fiction', espnId: '3' },
      drop: { name: 'Alex Sample', espnId: '1' } } : { decision: 'hold', add: null, drop: null }) }];
  const input = path.join(dir, 'engine.json');
  await writeFile(input, JSON.stringify(engineEntries));
  execFileSync(process.execPath, [bakeoff, 'record', input], { cwd: dir, stdio: 'pipe' });
  const run = (script, ...args) => execFileSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const log = async () => (await readFile(path.join(dir, 'local/bakeoff.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const gamelogs = async (pts) => {
    const out = path.join(dir, 'local/gamelogs/2026-27'); await mkdir(out, { recursive: true });
    const days = new Map();
    for (const [date, espnId, p] of pts) days.set(date, [...(days.get(date) ?? []), { ...zeroLine(), date, espnId, didNotPlay: false, espnEventId: `g-${date}`, pts: p }]);
    for (const [date, lines] of days) await writeFile(path.join(out, `${date}.json`), JSON.stringify(lines));
  };
  const answer = (input, ...args) => execFileSync(process.execPath, [did, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe', input });
  return { dir, id: saved.id, report, run, log, gamelogs, answer, did: (...a) => run(did, saved.id, ...a), replay: () => run(bakeoff, 'replay', '--to', '2026-11-01') };
}

// Alex scores 5 on each start (a losing PTS week), Blair 25 in all, Casey 40 on 10-21.
const LOGS = [['2026-10-20', '1', 5], ['2026-10-22', '1', 5], ['2026-11-01', '1', 5], ['2026-10-20', '2', 10], ['2026-10-22', '2', 10], ['2026-11-01', '2', 5], ['2026-10-21', '3', 40]];

test('did records an add with the ESPN ID, week and asOf from the decision', async (t) => {
  const s = await setup(t);
  s.did('add', 'Casey Fiction', '--drop', 'Alex Sample', '--on', '2026-10-21', '--tag', 'changed-decision', '--minutes', '4', '--rescue', '--reason', 'streaming');
  const row = (await s.log()).find((e) => e.source === 'tony');
  assert.deepEqual({ ...row, recordedAt: null, date: null, lineups: null }, { decisionId: s.id, week: s.report.week, asOf: s.report.asOf, date: null,
    source: 'tony', chatbot: null, rating: null, tag: 'changed-decision', decision: 'move', start: '2026-10-21', minutes: 4, rescue: true, note: 'streaming',
    add: { name: 'Casey Fiction', espnId: '3' }, drop: { name: 'Alex Sample', espnId: '1' }, taken: false, recordedAt: null, lineups: null });
  assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(row.lineups.proposed.some((g) => g.espnId === '3'));
});

test('did records a hold', async (t) => {
  const s = await setup(t);
  s.did('hold', '--tag', 'no-effect');
  const row = (await s.log()).find((e) => e.source === 'tony');
  assert.equal(row.decision, 'hold'); assert.equal(row.add, null); assert.equal(row.tag, 'no-effect');
  assert.deepEqual(row.lineups.proposed, row.lineups.baseline);
});

test('did refuses a missing tag, an unknown name and a duplicate without --replace', async (t) => {
  const s = await setup(t);
  assert.throws(() => s.did('hold'), /--tag is required/);
  assert.throws(() => s.did('add', 'Nobody Known', '--on', '2026-10-21', '--tag', 'no-effect'), /Unknown player "Nobody Known"/);
  assert.throws(() => s.did('add', 'Casey Fiction', '--drop', 'Nobody Known', '--on', '2026-10-21', '--tag', 'no-effect'), /Unknown player "Nobody Known" in your roster/);
  assert.throws(() => s.did('hold', '--tag', 'busy'), /tag must be one of/);
  assert.equal((await s.log()).filter((e) => e.source === 'tony').length, 0);
  s.did('hold', '--tag', 'no-effect');
  assert.throws(() => s.did('hold', '--tag', 'no-effect'), /already recorded/);
  assert.equal((await s.log()).filter((e) => e.source === 'tony').length, 1);
});

test('did --replace appends a new entry and the newest counts', async (t) => {
  const s = await setup(t, { engine: 'move' });
  s.did('hold', '--tag', 'no-effect');
  s.did('add', 'Casey Fiction', '--drop', 'Alex Sample', '--on', '2026-10-21', '--tag', 'changed-decision', '--replace');
  const rows = (await s.log()).filter((e) => e.source === 'tony');
  assert.equal(rows.length, 2); assert.equal(rows[1].replaces, true);
  await s.gamelogs(LOGS);
  const out = s.replay();
  assert.match(out, /same tag changed-decision/);
  assert.doesNotMatch(out, /no-effect/);
});

test('replay where Tony matched the engine does not count a difference', async (t) => {
  const s = await setup(t, { engine: 'move' });
  s.did('add', 'Casey Fiction', '--drop', 'Alex Sample', '--on', '2026-10-21', '--tag', 'no-effect');
  await s.gamelogs(LOGS);
  const out = s.replay();
  assert.match(out, /same tag no-effect/);
  assert.match(out, /tool: add Casey Fiction drop Alex Sample on 2026-10-21: helped PTS; hurt -/);
  assert.match(out, /tony: add Casey Fiction drop Alex Sample on 2026-10-21: helped PTS; hurt -/);
  assert.match(out, /decisions 1; differing 0;/);
});

test('replay where Tony differed and the engine gained more; a hold scores as zero change', async (t) => {
  const s = await setup(t, { engine: 'move' });
  s.did('hold', '--tag', 'wasted-time');
  await s.gamelogs(LOGS);
  const out = s.replay();
  assert.match(out, /DIFFER/);
  assert.match(out, /tool: add Casey Fiction drop Alex Sample on 2026-10-21: helped PTS; hurt -/);
  assert.match(out, /tony: hold: helped -; hurt -/);
  assert.match(out, /differing 1; tool won 1; tony won 0; tied 0; unscored 0/);
});

test('replay skips decisions whose week has not ended', async (t) => {
  const s = await setup(t);
  s.did('hold', '--tag', 'no-effect');
  assert.match(s.run(bakeoff, 'replay', '--to', '2026-10-31'), /decisions 0;/);
});

test('replay with missing game logs reports unscored with the reason', async (t) => {
  const s = await setup(t, { engine: 'move' });
  s.did('hold', '--tag', 'no-effect');
  const out = s.replay();
  assert.match(out, /tool: unscored \(.*Missing result/);
  assert.match(out, /tony: unscored \(.*Missing result/);
  assert.match(out, /differing 1; tool won 0; tony won 0; tied 0; unscored 1/);
});

test('a pickup outside the capture is unscored with the reason, not an error', async (t) => {
  const s = await setup(t, { engine: 'move' });
  const input = path.join(s.dir, 'tony.json');
  await writeFile(input, JSON.stringify([{ decisionId: s.id, week: s.report.week, asOf: s.report.asOf, date: '2026-10-20', source: 'tony',
    chatbot: null, rating: null, tag: 'no-effect', decision: 'move', start: '2026-10-21', add: { name: 'Nobody Known', espnId: '99' }, drop: null }]));
  s.run(bakeoff, 'record', input);
  const row = (await s.log()).find((e) => e.source === 'tony');
  assert.equal(row.lineups, null);
  await s.gamelogs(LOGS);
  assert.match(s.replay(), /tony: unscored \(Pickup is not in the captured free agents\.\)/);
});

const CASEY_STEP = { pickup: { name: 'Casey Fiction', nbaTeam: 'CCC' }, drop: { name: 'Alex Sample', nbaTeam: 'AAA' }, start: '2026-10-21' };
const ADD_PATCH = { action: 'add', step: CASEY_STEP, waitFor: null, runnersUp: [] };

test('choices lists the engine pick, the runners-up and hold', () => {
  const list = choices({ action: 'add', step: CASEY_STEP, runnersUp: [{ step: { ...CASEY_STEP, drop: null, start: '2026-10-22' } }] });
  assert.deepEqual(list.map((c) => c.label), ["Added Casey Fiction (CCC), dropped Alex Sample, starts 2026-10-21 (engine's pick)",
    'Added Casey Fiction (CCC), into open spot, starts 2026-10-22', 'Held']);
  assert.deepEqual(list[0].args, ['add', 'Casey Fiction', '--drop', 'Alex Sample', '--on', '2026-10-21']);
  assert.deepEqual(list[1].args, ['add', 'Casey Fiction', '--on', '2026-10-22']);
  assert.deepEqual(choices({ action: 'hold', step: null, runnersUp: [] }).map((c) => c.label), ["Held (engine's pick)"]);
  assert.match(choices({ action: 'wait', waitFor: CASEY_STEP, runnersUp: [] })[0].label, /wait for this day/);
});

test('did with no arguments asks about the latest decision and records the chosen add', async (t) => {
  const s = await setup(t, { patch: ADD_PATCH });
  const out = s.answer('1\n3\n\n\n');
  assert.match(out, new RegExp(`Decision ${s.id}`));
  assert.match(out, /Recorded add Casey Fiction/);
  const row = (await s.log()).find((e) => e.source === 'tony');
  assert.deepEqual([row.decision, row.add.name, row.drop.name, row.start, row.tag, row.minutes, row.rescue], ['move', 'Casey Fiction', 'Alex Sample', '2026-10-21', 'no-effect', undefined, undefined]);
});

test('did questions take someone else, retry a bad number, and record minutes and rescue', async (t) => {
  const s = await setup(t, { patch: ADD_PATCH });
  // Options: 1 engine pick, 2 held, 3 someone else.
  s.answer('9\n3\nCasey Fiction\n\n\n1\n4\ny\n', s.id);
  const row = (await s.log()).find((e) => e.source === 'tony');
  assert.deepEqual([row.add.name, row.drop, row.start, row.tag, row.minutes, row.rescue], ['Casey Fiction', null, '2026-10-21', 'changed-decision', 4, true]);
});

test('did questions offer to replace an earlier entry, and stop on no answer', async (t) => {
  const s = await setup(t, { patch: ADD_PATCH });
  s.answer('2\n3\n\n\n');
  assert.throws(() => s.answer('2\n3\n\n\nn\n'), /Kept the earlier entry/);
  s.answer('1\n1\n\n\ny\n');
  const rows = (await s.log()).filter((e) => e.source === 'tony');
  assert.deepEqual(rows.map((r) => [r.decision, r.replaces]), [['hold', undefined], ['move', true]]);
  assert.throws(() => s.answer('1\n'), /Cancelled/);
  assert.equal((await s.log()).filter((e) => e.source === 'tony').length, 2);
});
