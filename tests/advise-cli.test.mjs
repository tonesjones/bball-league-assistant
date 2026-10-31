import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MODEL_VERSION } from '../src/engine/advice-common.mjs';
import { formatPlan, planSummary, readRoles, snapshotFreshness } from '../scripts/advise.mjs';
import { logHash, easternDate } from '../src/sources/gamelogs.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(fixture);
const better = (f) => { f.snapshot.freeAgents[0].nbaTeam = 'AAA'; f.priors[2].perGame.pts = 60; };

test('roles file helper defaults empty, reads legacy protection as core, merges, and validates', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'advise-roles-'));
  const rolesFile = path.join(dir, 'roles.json'), protectedFile = path.join(dir, 'protected.json');
  try {
    assert.deepEqual(await readRoles(rolesFile, protectedFile), { core: [], stream: [] });
    await writeFile(protectedFile, JSON.stringify({ protected: ['Alex Sample'] }));
    const legacy = await readRoles(rolesFile, protectedFile);
    assert.deepEqual(legacy, { core: ['Alex Sample'], stream: [] });
    await writeFile(rolesFile, JSON.stringify({ core: ['Blair Example'], stream: ['Casey Fiction'] }));
    assert.deepEqual(await readRoles(rolesFile, protectedFile),
      { core: ['Blair Example', 'Alex Sample'], stream: ['Casey Fiction'] });
    await writeFile(rolesFile, JSON.stringify({ stream: ['Álex Sample Jr.'] }));
    await assert.rejects(readRoles(rolesFile, protectedFile), /both core and stream/);
    await rm(protectedFile);
    for (const roles of [{}, { core: ['Alex Sample'] }, { stream: ['Alex Sample'] }]) {
      await writeFile(rolesFile, JSON.stringify(roles));
      assert.deepEqual(await readRoles(rolesFile, protectedFile), { core: [], stream: [], ...roles });
    }
    for (const bad of ['null', '[]', '{"core": "x"}', '{"stream": [1]}', '{"core": null}', 'not json',
      '{"core": ["Alex Sample"], "stream": ["Álex Sample Jr."]}']) {
      await writeFile(rolesFile, bad);
      await assert.rejects(readRoles(rolesFile, protectedFile), (err) => err.message.startsWith(`${rolesFile}:`));
    }
    await rm(rolesFile);
    for (const bad of ['{"protected": "x"}', '{"protected": [1]}', 'not json']) {
      await writeFile(protectedFile, bad);
      await assert.rejects(readRoles(rolesFile, protectedFile), (err) => err.message.startsWith(protectedFile));
    }
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});

test('snapshot freshness uses a fixed clock, refuses old data, and permits an explicit stale override', () => {
  const asOf = '2026-10-20T00:00:00Z', now = Date.parse('2026-10-20T12:00:00Z');
  assert.deepEqual(snapshotFreshness(asOf, { now }), { ageHours: 12, maxAgeHours: 12, stale: false });
  assert.throws(() => snapshotFreshness(asOf, { now: now + 3_600_000 }), /13.00 hours old/);
  assert.deepEqual(snapshotFreshness(asOf, { now: now + 3_600_000, allowStale: true }),
    { ageHours: 13, maxAgeHours: 12, stale: true });
  assert.equal(snapshotFreshness(asOf, { now, maxAgeHours: 24 }).stale, false);
  assert.throws(() => snapshotFreshness('bad', { now, allowStale: true }), /invalid snapshot/);
  for (const maxAgeHours of [-1, Infinity, NaN]) assert.throws(() => snapshotFreshness(asOf, { now, maxAgeHours }), /max-age-hours/);
});

test('CLI reads synthetic inputs, prints the plan, and writes equivalent JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'advise-cli-'));
  const f = fresh(); better(f);
  try {
    const files = { 'snapshot.json': f.snapshot, 'data/ids.json': f.ids, 'data/priors/players.json': f.priors,
      'data/schedule-2026-27.json': f.schedule };
    for (const [name, value] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), JSON.stringify(value));
    }
    const cli = fileURLToPath(new URL('../scripts/advise.mjs', import.meta.url));
    const logDir = path.join(dir, 'local/gamelogs/2026-27');
    await mkdir(logDir, { recursive: true });
    const through = easternDate(f.snapshot.asOf), text = '[]\n';
    await writeFile(path.join(logDir, `${through}.json`), text);
    await writeFile(path.join(logDir, '_coverage.json'), JSON.stringify({ from: through, through, checkedAt: f.snapshot.asOf, hashes: { [through]: logHash(text) } }));
    const output = execFileSync(process.execPath, [cli, 'snapshot.json', '--allow-stale', '--max-age-hours', '0', '--drop-bar', '0.02', '--add-bar', '0.03', '--from', '2026-10-22', '--adds-from', '2026-11-01', '--candidates', '5', '--beam', '10', '--drops-per-pickup', '2', '--max-steps', '1', '--pool-size', '100', '--margin', '-0.25', '--protect-rank', '0'], { cwd: dir, encoding: 'utf8' });
    const report = JSON.parse(await readFile(path.join(dir, 'local/advice/snapshot.json'), 'utf8'));
    assert.equal(report.fromDate, '2026-11-01', '--adds-from is an alias for --from; the later one wins');
    assert.equal(report.addsFrom, '2026-11-01');
    assert.deepEqual(Object.fromEntries(['dropBar', 'addBar', 'candidates', 'beam', 'dropsPerPickup', 'maxSteps', 'poolSize', 'seasonMargin', 'protectRank']
      .map((k) => [k, report.options[k]])), { dropBar: 0.02, addBar: 0.03, candidates: 5, beam: 10, dropsPerPickup: 2, maxSteps: 1, poolSize: 100, seasonMargin: -0.25, protectRank: 0 });
    assert.ok(['add', 'wait', 'hold'].includes(report.action));
    const saved = JSON.parse(await readFile(path.join(dir, `local/decisions/${report.decisionId}.json`), 'utf8'));
    assert.equal(saved.provenance.modelVersion, MODEL_VERSION);
    assert.equal(saved.projections.version, 'current-season-rates-v4');
    assert.equal(saved.projections.k, 2);
    assert.equal(saved.projections.players.length, f.priors.length);
    assert.equal(saved.projections.players[0].original.mpg, f.priors[0].mpg);
    assert.equal(report.freshness.stale, true);
    assert.match(output, /^STALE:/);
    assert.throws(() => execFileSync(process.execPath, [cli, 'snapshot.json', '--max-age-hours', '0'], { cwd: dir, stdio: 'pipe' }), /hours old/);
    assert.ok(output.includes(formatPlan(report)));
    assert.match(output, new RegExp(`MODEL_VERSION: ${MODEL_VERSION}`));
    await mkdir(path.join(dir, 'local/snapshots'), { recursive: true });
    await writeFile(path.join(dir, 'local/snapshots/newest.json'), JSON.stringify(f.snapshot));
    const defaultOutput = execFileSync(process.execPath, [cli, '--allow-stale'], { cwd: dir, encoding: 'utf8' });
    assert.match(defaultOutput, /newest.json/);
    await writeFile(path.join(logDir, '_coverage.json'), JSON.stringify({ from: through, through, checkedAt: new Date(Date.parse(f.snapshot.asOf) - 1).toISOString(), hashes: { [through]: logHash(text) } }));
    assert.throws(() => execFileSync(process.execPath, [cli, 'snapshot.json', '--allow-stale'], { cwd: dir, stdio: 'pipe' }), /Game logs are older than the snapshot/);
    for (const args of [['--minutes-k', '0'], ['--minutes-k', '-1'], ['--minutes-k', 'NaN'], ['--minutes-k'], ['--from', '2026-02-30'], ['--adds-from', '2026-02-30'], ['--top', '1'], ['--hold-below', '0.1'], ['--add-only-below', '0.1'], ['--margin', 'Infinity'], ['--margin', 'NaN'], ['--margin'], ['--protect-rank', '-1'], ['--protect-rank', '1.5'], ['--drop-bar', '-1'], ['--drop-bar', 'NaN'], ['--drop-bar'], ['--add-bar', '-1'], ['--add-bar', 'NaN'], ['--add-bar'], ['--candidates', '0'], ['--beam', '0'], ['--drops-per-pickup', '0'], ['--max-steps', '-1'], ['--pool-size', '0'], ['--pool-size', '1.5'], ['--max-age-hours', '-1'], ['--max-age-hours', 'Infinity'], ['--max-age-hours']]) {
      assert.throws(() => execFileSync(process.execPath, [cli, ...args], { cwd: dir, stdio: 'pipe' }), undefined, args.join(' '));
    }
  } finally {
    // Only remove this test's freshly created temporary directory.
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});

const LONG = (s) => `${s} Supercalifragilistic-Wolfeschlegelstein`;
const player = (name, team = 'LAL') => ({ name: LONG(name), nbaTeam: team });
const step = (pickup, drop, start = '2026-10-22') => ({ pickup: player(pickup), drop: drop && player(drop), start });
const report = (extra = {}) => ({
  asOf: '2026-10-21T16:00:00Z', fromDate: '2026-10-22', addsLeft: 3, openSpots: 0,
  projection: { asOf: '2026-10-21T15:00:00Z' }, freshness: { stale: false, ageHours: 1, maxAgeHours: 12 },
  action: 'hold', step: null, waitFor: null, dependsOn: [],
  categories: { PTS: { change: 0.05, total: 12.5 }, 'FG%': { change: -0.01, total: -0.004 } },
  startsByDay: [{ date: '2026-10-22', openSlots: 1, pickupStarts: 1, displaced: [LONG('Displaced One'), LONG('Displaced Two')] },
    { date: '2026-10-23', openSlots: 0, pickupStarts: 0, displaced: [] }],
  runnersUp: [{ step: step('Runner', 'Other Drop'), gain: 0.12, whyLost: 'lower-gain' },
    { step: step('Open Runner', null), gain: 0.02, whyLost: 'below-bar' }],
  unknowns: [{ category: 'FG%', reason: 'banked makes and attempts unavailable' },
    { player: LONG('Mystery'), side: 'mine', starts: 2, reason: 'no projection' }],
  ...extra,
});
const dependsOn = [{ player: player('Pickup'), games: 3, seasonMpg: 20.04, priorMpg: null, cautiousAction: 'hold' }];

test('formatPlan keeps every line within 72 characters, even with long names', () => {
  const reports = [
    report({ action: 'add', step: step('Add', 'Drop'), dependsOn }),
    report({ action: 'add', step: step('Add', null), dependsOn }),
    report({ action: 'wait', waitFor: { pickup: player('Wait'), start: '2026-10-24' } }),
    report(),
    report({ freshness: { stale: true, ageHours: 30.5, maxAgeHours: 12 } }),
    report({ unknowns: [{ player: 'X'.repeat(200), reason: 'no projection' }] }),
  ];
  for (const r of reports) for (const line of formatPlan(r).split('\n')) assert.ok(line.length <= 72, `${line.length}: ${line}`);
});

test('each action prints its action line, and a stale snapshot prints a STALE line first', () => {
  const pat = { name: 'Pat Pickup', nbaTeam: 'LAL' };
  const add = formatPlan(report({ action: 'add', step: { pickup: pat, drop: { name: 'Dan Drop', nbaTeam: 'BOS' }, start: '2026-10-22' } }));
  assert.match(add, /^ADD Pat Pickup \(LAL\), DROP Dan Drop, starts 2026-10-22\n/);
  const open = formatPlan(report({ action: 'add', step: { pickup: pat, drop: null, start: '2026-10-22' } }));
  assert.match(open, /^ADD Pat Pickup \(LAL\), into open spot, starts 2026-10-22\n/);
  const wait = formatPlan(report({ action: 'wait', waitFor: { pickup: { name: 'Wes Wait' }, start: '2026-10-24' } }));
  assert.match(wait, /^WAIT: add Wes Wait to start 2026-10-24\n/);
  assert.match(formatPlan(report()), /^HOLD\n/);
  const stale = formatPlan(report({ freshness: { stale: true, ageHours: 30.5, maxAgeHours: 12 } }));
  assert.match(stale, /^STALE: snapshot is 30.50 hours old \(maximum 12\)\.\n\nHOLD\n/);
  // A long name wraps onto a continuation line instead of overflowing.
  const long = formatPlan(report({ action: 'add', step: step('Add', 'Drop') })).split('\n');
  assert.ok(long[0].startsWith('ADD Add ') && long[1].startsWith('  '));
});

test('formatPlan prints the sections in order and planSummary is sections 1, 2 and 8', () => {
  const r = report({ action: 'add', step: step('Add', 'Drop'), dependsOn });
  const text = formatPlan(r);
  const at = ['ADD ', 'Depends on', 'Category changes', 'Starts by day', 'Adds and spots', 'Runners-up', 'Unknowns', 'As of']
    .map((h) => text.indexOf(h));
  assert.ok(at.every((n, i) => n >= 0 && (!i || n > at[i - 1])), at.join());
  assert.match(text, /PTS\s+P\(win\) \+0\.050\s+total \+12\.500/);
  assert.match(text, /pickup starts yes/);
  assert.match(text, /Adds left 3, open roster spots 0/);
  assert.match(text, /lower-gain/);
  assert.match(text, /Snapshot as of: 2026-10-21T16:00:00Z/);
  assert.match(text, /Projections as of: 2026-10-21T15:00:00Z/);
  const summary = planSummary(r).join('\n');
  assert.match(summary, /^ADD /);
  assert.match(summary, /Depends on/);
  assert.match(summary, new RegExp(`MODEL_VERSION: ${MODEL_VERSION}`));
  assert.doesNotMatch(summary, /Category changes|Runners-up/);
});
