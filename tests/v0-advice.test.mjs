import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tomorrow } from '../src/engine/weeks.mjs';
import { gamesLeft } from '../src/engine/games-left.mjs';
import { needs, projectTeam } from '../src/engine/needs.mjs';
import { advise, pickupStart } from '../src/engine/v0-advice.mjs';
import { formatAdvice } from '../scripts/advise.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(fixture);
const options = (f, extra = {}) => ({ ...f, ...extra });
const run = (f, extra) => advise(f.snapshot, options(f, extra));
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const sameSchedule = (f) => { f.snapshot.freeAgents[0].nbaTeam = 'AAA'; };
const better = (f) => { sameSchedule(f); f.priors[2].perGame.pts = 60; };
const project = (f, roster, totals = {}, volume = {}, from = '2026-10-20', end = '2026-11-01') =>
  projectTeam(roster, totals, volume, f.snapshot.settings, f.schedule, from, end);
const scored = (f, index = 0) => ({ ...f.snapshot.team.roster[0], prior: f.priors[index] });

test('tomorrow uses Los Angeles calendar date, including DST', () => {
  assert.equal(tomorrow('2026-10-20T05:00:00Z'), '2026-10-20');
  assert.equal(tomorrow('2026-11-02T07:30:00Z'), '2026-11-02');
  assert.equal(tomorrow('2027-01-01T07:30:00Z'), '2027-01-01');
});

test('games left includes endpoints and stops at week boundary', () => {
  const f = fresh(), p = f.snapshot.team.roster[0];
  assert.equal(gamesLeft(p, f.schedule, '2026-10-22', '2026-11-01'), 2);
  assert.equal(gamesLeft(p, f.schedule, '2026-11-02', '2026-11-08'), 1);
  assert.equal(gamesLeft(p, f.schedule, '2026-11-02', '2026-11-01'), 0);
});

test('snapshot team supplies schedule; exact priorName supplies the line', () => {
  const f = fresh(), r = run(f);
  assert.equal(r.baseline.categories.PTS.mine, 45);
  assert.equal(r.unscored.length, 0);
});

test('identical teams give 0.5 everywhere and equal swap scores zero', () => {
  const f = fresh(); sameSchedule(f);
  const r = run(f);
  for (const c of Object.values(r.baseline.categories)) assert.equal(c.pWin, 0.5);
  assert.equal(r.topPairs[0].score, 0);
  assert.deepEqual(r.suggestions, []);
});

test('40 banked REB lead with one game left is safe; REB-only upgrade adds near zero', () => {
  const f = fresh(); sameSchedule(f);
  f.snapshot.matchup.totals.mine.REB = 40;
  f.priors[2].perGame.reb = 6;
  const r = run(f, { fromDate: '2026-11-01' });
  assert.ok(r.baseline.categories.REB.pWin > 0.99);
  assert.ok(Math.abs(r.topPairs[0].score) < 0.001);
});

test('TO is fewer-is-better and additional TO lowers its win probability', () => {
  const f = fresh(); sameSchedule(f); f.priors[2].perGame.to = 10;
  const r = run(f);
  assert.ok(r.topPairs[0].changes.TO.total > 0);
  assert.ok(r.topPairs[0].changes.TO.pWin < 0);
  assert.ok(r.topPairs[0].score < 0);
  assert.equal(r.suggestions.length, 0);
});

test('FG/FT percentages use banked plus remaining makes and attempts, not averages', () => {
  const f = fresh();
  const p = project(f, [scored(f)], { 'FG%': 0.99, 'FT%': 0.01 }, { fgm: 1, fga: 2, ftm: 1, fta: 10 });
  near(p.totals['FG%'], 16 / 32);
  near(p.totals['FT%'], 13 / 25);
  sameSchedule(f);
  Object.assign(f.priors[2].perGame, { fgm: 8, fga: 30, ftm: 5, fta: 20 });
  const r = run(f);
  assert.ok(r.topPairs[0].changes['FG%'].total < 0);
  assert.ok(r.topPairs[0].changes['FG%'].pWin < 0);
  assert.ok(r.topPairs[0].changes['FT%'].total < 0);
});

test('zero games left produces deterministic probabilities and zero swap scores', () => {
  const f = fresh(); f.snapshot.matchup.totals.mine = { PTS: 3, TO: 2 };
  const r = run(f, { fromDate: '2026-11-02' });
  for (const c of Object.values(r.baseline.categories)) assert.ok([0, 0.5, 1].includes(c.pWin));
  assert.equal(r.baseline.categories.PTS.pWin, 1);
  assert.equal(r.baseline.categories.TO.pWin, 0);
  assert.ok(r.topPairs.every((p) => p.score === 0));
  assert.deepEqual(r.suggestions, []);
});

test('daily starts use mpg, allow BN, exclude IL/IL+ and every blocked status', () => {
  const f = fresh(); f.snapshot.settings.rosterPositions[0].count = 1;
  const low = scored(f); low.prior.mpg = null;
  const high = { ...scored(f, 2), name: 'High', slot: 'BN' };
  const roster = [low, high, ...['IL', 'IL+'].map((slot) => ({ ...high, slot })),
    ...['O', 'INJ', 'SUSP', 'NA'].map((status) => ({ ...high, status }))];
  const p = project(f, roster);
  assert.equal(p.started.length, 3);
  assert.ok(p.started.every((g) => g.name === 'High'));
});

test('remaining games cap stops both teams and is reapplied after each swap', () => {
  const f = fresh(); better(f); f.snapshot.settings.maxGamesPerWeek = 1;
  const r = run(f);
  assert.equal(r.baseline.categories.PTS.mine, 15);
  assert.equal(r.baseline.categories.PTS.opponent, 15);
  assert.equal(r.topPairs[0].changes.PTS.total, 45);
  assert.equal(project(f, [scored(f)]).started.length, 1);
});

test('waivers delay pickup while the dropped player keeps earlier games', () => {
  const f = fresh(); f.snapshot.freeAgents[0].waiverClears = 'Oct 21';
  const r = run(f);
  assert.equal(r.topPairs[0].pickupStart, '2026-10-21');
  assert.equal(r.topPairs[0].pickup.games, 1);
  assert.equal(r.topPairs[0].changes.PTS.total, -15);
  assert.equal(pickupStart({ waiverClears: 'Jan 2' }, '2026-12-30', { start: '2026-12-28', end: '2027-01-03' }), '2027-01-02');
});

test('addsFrom and fromDate override pickup processing; drop keeps earlier starts', () => {
  const f = fresh(); sameSchedule(f); f.priors[2].perGame.pts = 30;
  f.snapshot.freeAgents[0].waiverClears = 'Oct 21';
  const r = run(f, { addsFrom: '2026-11-01' });
  assert.equal(r.topPairs[0].pickupStart, '2026-11-01');
  assert.equal(r.topPairs[0].pickup.games, 1);
  assert.equal(r.topPairs[0].changes.PTS.total, 15);
  assert.equal(run(f, { fromDate: '2026-11-01' }).topPairs[0].pickupStart, '2026-11-01');
  assert.equal(run(f, { addsFrom: '2026-11-02' }).topPairs[0].score, 0);
});

test('protected names are normalized before excluding drops', () => {
  const f = fresh(); better(f);
  assert.equal(run(f).suggestions.length, 1);
  assert.deepEqual(run(f, { protectedNames: ['Álex Sample Jr.'] }).topPairs, []);
});

test('each unavailable pickup status is excluded', () => {
  for (const status of ['O', 'INJ', 'SUSP', 'NA']) {
    const f = fresh(); better(f); f.snapshot.freeAgents[0].status = status;
    assert.deepEqual(run(f).topPairs, []);
  }
});

test('unmapped, ambiguous, missing-prior and null-line players remain unscored and unranked', () => {
  for (const where of ['roster', 'freeAgent', 'opponent']) {
    for (const failure of ['unmapped', 'ambiguous', 'missing', 'null']) {
      const f = fresh(); better(f);
      const index = where === 'roster' ? 0 : where === 'opponent' ? 1 : 2;
      if (failure === 'unmapped') f.ids.players.splice(index, 1);
      if (failure === 'ambiguous') f.ids.players.push({ ...f.ids.players[index] });
      if (failure === 'missing') f.ids.players[index].priorName = null;
      if (failure === 'null') f.priors[index].perGame = null;
      const r = run(f);
      assert.equal(r.unscored.length, 1);
      assert.equal(r.unscored[0].where, where);
      if (where !== 'opponent') assert.deepEqual(r.topPairs, []);
    }
  }
});

test('greedy distinct picks/drops respect adds left, null default, and zero floor', () => {
  const f = fresh(); better(f);
  for (let i = 1; i <= 5; i++) {
    const name = `Roster Fiction ${i}`, pickup = `Pickup Fiction ${i}`;
    f.snapshot.team.roster.push({ ...f.snapshot.team.roster[0], name });
    f.snapshot.freeAgents.push({ ...f.snapshot.freeAgents[0], name: pickup });
    f.ids.players.push({ name, espnId: `r${i}`, priorName: 'Alex Old' }, { name: pickup, espnId: `p${i}`, priorName: 'Casey Old' });
  }
  f.snapshot.settings.rosterPositions[0].count = 8;
  for (const [max, used, expected] of [[4, 2, 2], [null, 0, 4], [2, 9, 0], [0, 0, 0]]) {
    f.snapshot.settings.maxAddsPerWeek = max; f.snapshot.team.addsUsedThisWeek = used;
    const r = run(f, { top: 100 });
    assert.equal(r.suggestions.length, expected);
    assert.equal(new Set(r.suggestions.map((p) => p.pickup.name)).size, expected);
    assert.equal(new Set(r.suggestions.map((p) => p.drop.name)).size, expected);
    assert.ok(r.suggestions.every((p) => p.score > 0));
    assert.equal(r.suggestions[0]?.score, expected ? r.topPairs[0].score : undefined);
  }
});

test('score is direct change in expected categories and phi is configurable', () => {
  const f = fresh(); better(f);
  const r = run(f), pair = r.topPairs[0];
  near(pair.score, Object.values(pair.changes).reduce((sum, c) => sum + c.pWin, 0));
  const alternate = run(f, { phi: { PTS: 400 } });
  assert.ok(alternate.topPairs[0].score < pair.score);
  assert.match(formatAdvice(r), /Snapshot:.*\nWeek 1:/);
  assert.match(formatAdvice(r), /total .*P\(win\)/);
});

test('CLI reads synthetic inputs, prints advice, and writes equivalent JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v0-advice-'));
  const f = fresh(); better(f);
  try {
    const files = { 'snapshot.json': f.snapshot, 'data/ids.json': f.ids, 'data/priors/players.json': f.priors,
      'data/schedule-2026-27.json': f.schedule,
      'config/protected.json': { protected: [] } };
    for (const [name, value] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), JSON.stringify(value));
    }
    const cli = fileURLToPath(new URL('../scripts/advise.mjs', import.meta.url));
    const output = execFileSync(process.execPath, [cli, 'snapshot.json', '--from', '2026-10-22', '--adds-from', '2026-11-01', '--top', '1'], { cwd: dir, encoding: 'utf8' });
    const report = JSON.parse(await readFile(path.join(dir, 'local/advice/snapshot.json'), 'utf8'));
    assert.equal(report.fromDate, '2026-10-22');
    assert.equal(report.topPairs.length, 1);
    assert.equal(report.topPairs[0].pickupStart, '2026-11-01');
    assert.ok(output.includes(formatAdvice(report)));
    await mkdir(path.join(dir, 'local/snapshots'), { recursive: true });
    await writeFile(path.join(dir, 'local/snapshots/newest.json'), JSON.stringify(f.snapshot));
    const defaultOutput = execFileSync(process.execPath, [cli], { cwd: dir, encoding: 'utf8' });
    assert.match(defaultOutput, /newest.json/);
    for (const args of [['--from', '2026-02-30'], ['--top', '-1']]) {
      assert.throws(() => execFileSync(process.execPath, [cli, ...args], { cwd: dir, stdio: 'pipe' }));
    }
  } finally {
    // Only remove this test's freshly created temporary directory.
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
