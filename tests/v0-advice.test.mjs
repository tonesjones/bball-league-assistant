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
const options = (f, extra = {}) => ({ ...f, protectRank: 0, ...extra });
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
  const r = run(f, { seasonMargin: -100 });
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
  const r = run(f, { seasonMargin: -100 });
  assert.ok(r.topPairs[0].changes['FG%'].total < 0);
  assert.ok(r.topPairs[0].changes['FG%'].pWin < 0);
  assert.ok(r.topPairs[0].changes['FT%'].total < 0);
});

test('an unknown side removes both shooting categories from baseline and every pair score', () => {
  for (const side of ['mine', 'opponent']) {
    const f = fresh(); sameSchedule(f);
    for (const team of ['mine', 'opponent']) f.snapshot.matchup.volume[team] = { fgm: 2, fga: 4, ftm: 4, fta: 8 };
    f.snapshot.matchup.volume[side].fga = null;
    Object.assign(f.priors[2].perGame, { fgm: 1, fga: 30, ftm: 1, fta: 30 });
    const r = run(f, { fromDate: '2026-10-22', seasonMargin: -100,
      volumeStatus: { [side]: { status: 'unknown', reason: 'no combination matches' } } });
    for (const c of ['FG%', 'FT%']) {
      assert.equal(r.baseline.categories[c].label, 'unknown');
      assert.equal(r.baseline.categories[c].pWin, null);
      assert.ok(r.topPairs.every((pair) => !(c in pair.changes)));
    }
    near(r.baseline.expectedCategories, 3.5);
    assert.ok(r.topPairs.length > 0);
    for (const pair of r.topPairs) near(pair.score, Object.values(pair.changes).reduce((sum, c) => sum + c.pWin, 0));
    near(r.topPairs[0].score, 0);
    assert.match(r.notes[0], /FG% and FT% are not scored:.*no combination matches/);
    assert.match(formatAdvice(r), new RegExp(`${side}: unknown \\(no combination matches\\)`));
    assert.match(formatAdvice(r), /FG%.*unknown/);
  }
});

test('rebuilt volume is scored and reported, while pre-week missing volume still scores shooting', () => {
  const f = fresh();
  const r = run(f);
  assert.equal(r.baseline.categories['FG%'].label, 'close');
  assert.ok(!r.notes.some((n) => /not scored|rebuilt/.test(n)));
  for (const side of ['mine', 'opponent']) f.snapshot.matchup.volume[side] = { fgm: 2, fga: 4, ftm: 4, fta: 8 };
  const rebuilt = run(f, { fromDate: '2026-10-22',
    volumeStatus: { mine: { status: 'matched' }, opponent: { status: 'matched' } } });
  assert.ok(rebuilt.notes.some((n) => /rebuilt from game logs/.test(n)));
  assert.equal(rebuilt.baseline.categories['FG%'].label, 'close');
  assert.match(formatAdvice(rebuilt), /Shooting volume: mine: matched \| opponent: matched/);
  near(rebuilt.baseline.categories['FG%'].mine, 12 / 24);
});

test('volume status shows unmatched names for both matched and unknown results', () => {
  const f = fresh();
  f.snapshot.matchup.volume.mine = { fgm: 2, fga: 4, ftm: 4, fta: 8 };
  const r = run(f, { fromDate: '2026-10-22', volumeStatus: {
    mine: { status: 'matched', unmatched: ['Alex Sample'] },
    opponent: { status: 'unknown', reason: 'no combination matches', unmatched: ['Blair Example'] },
  } });
  assert.match(formatAdvice(r), /mine: matched; unmatched: Alex Sample/);
  assert.match(formatAdvice(r), /opponent: unknown \(no combination matches\); unmatched: Blair Example/);
});

test('zero games left produces deterministic probabilities and zero swap scores', () => {
  const f = fresh(); f.snapshot.matchup.totals.mine = { PTS: 3, TO: 2 };
  const r = run(f, { fromDate: '2026-11-02' });
  for (const c of Object.values(r.baseline.categories)) assert.ok(c.label === 'unknown' || [0, 0.5, 1].includes(c.pWin));
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
      'data/schedule-2026-27.json': f.schedule };
    for (const [name, value] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), JSON.stringify(value));
    }
    const cli = fileURLToPath(new URL('../scripts/advise.mjs', import.meta.url));
    const output = execFileSync(process.execPath, [cli, 'snapshot.json', '--from', '2026-10-22', '--adds-from', '2026-11-01', '--top', '1', '--margin', '-0.25', '--protect-rank', '0'], { cwd: dir, encoding: 'utf8' });
    const report = JSON.parse(await readFile(path.join(dir, 'local/advice/snapshot.json'), 'utf8'));
    assert.equal(report.fromDate, '2026-10-22');
    assert.equal(report.topPairs.length, 1);
    assert.equal(report.topPairs[0].pickupStart, '2026-11-01');
    assert.equal(report.guardrail.seasonMargin, -0.25);
    assert.equal(report.guardrail.protectRank, 0);
    assert.match(output, /Season value: pickup [+-][\d.]+ \(#\d+\) vs drop [+-][\d.]+ \(#\d+\)/);
    assert.match(output, /Season guardrail:/);
    assert.match(output, /No prior \(protected, not in projection\):/);
    assert.ok(output.includes(formatAdvice(report)));
    await mkdir(path.join(dir, 'local/snapshots'), { recursive: true });
    await writeFile(path.join(dir, 'local/snapshots/newest.json'), JSON.stringify(f.snapshot));
    const defaultOutput = execFileSync(process.execPath, [cli], { cwd: dir, encoding: 'utf8' });
    assert.match(defaultOutput, /newest.json/);
    assert.match(output, /Protected by Tony: 0 \(local\/protected.json\)/);
    const args = ['snapshot.json', '--from', '2026-10-22', '--margin', '-0.25', '--protect-rank', '0'];
    const drop = report.topPairs[0].drop.name;
    await writeFile(path.join(dir, 'local/protected.json'), JSON.stringify({ protected: [drop] }));
    const protectedOutput = execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
    assert.match(protectedOutput, /Protected by Tony: 1 /);
    const protectedReport = JSON.parse(await readFile(path.join(dir, 'local/advice/snapshot.json'), 'utf8'));
    assert.ok(protectedReport.topPairs.every((pair) => pair.drop.name !== drop));
    for (const bad of ['{"protected": "x"}', '{"protected": [1]}', 'not json']) {
      await writeFile(path.join(dir, 'local/protected.json'), bad);
      assert.throws(() => execFileSync(process.execPath, [cli, ...args], { cwd: dir, stdio: 'pipe' }), /local\/protected.json/);
    }
    await rm(path.join(dir, 'local/protected.json'));
    for (const args of [['--from', '2026-02-30'], ['--top', '-1'], ['--margin', 'Infinity'], ['--margin', 'NaN'], ['--margin'], ['--protect-rank', '-1'], ['--protect-rank', '1.5']]) {
      assert.throws(() => execFileSync(process.execPath, [cli, ...args], { cwd: dir, stdio: 'pipe' }));
    }
  } finally {
    // Only remove this test's freshly created temporary directory.
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});

test('a weekly upgrade with lower season value is blocked and counted once', () => {
  const f = fresh();
  f.priors[2].perGame.pts = 14;
  f.snapshot.freeAgents[0].nbaTeam = 'BBB';
  f.snapshot.team.roster[0].nbaTeam = 'CCC';
  const unrestricted = run(f, { seasonMargin: -100 });
  assert.ok(unrestricted.suggestions[0].score > 0);
  const r = run(f);
  assert.deepEqual(r.suggestions, []);
  assert.deepEqual(r.topPairs, []);
  assert.equal(r.guardrail.blockedPairs, 1);
});

test('positive seasonMargin blocks a small upgrade; negative margin permits a small downgrade', () => {
  const f = fresh(); sameSchedule(f);
  f.priors[2].perGame.pts = 15.1;
  f.priors.push({ name: 'Marigold Anchor', perGame: { ...f.priors[0].perGame, pts: 100 } },
    { name: 'Nettle Anchor', perGame: { ...f.priors[0].perGame, pts: 0 } });
  const pair = run(f).suggestions[0];
  const gap = pair.pickup.seasonValue - pair.drop.seasonValue;
  assert.ok(gap > 0 && gap < 0.01);
  assert.equal(run(f, { seasonMargin: gap + 0.01 }).guardrail.blockedPairs, 1);
  assert.equal(run(f, { seasonMargin: gap }).suggestions.length, 1);
  f.priors[2].perGame.pts = 14.9;
  f.snapshot.freeAgents[0].nbaTeam = 'BBB';
  f.snapshot.team.roster[0].nbaTeam = 'CCC';
  const worse = run(f, { seasonMargin: -100 }).suggestions[0];
  const loss = worse.pickup.seasonValue - worse.drop.seasonValue;
  assert.ok(loss < 0);
  assert.equal(run(f, { seasonMargin: loss - 0.01 }).suggestions.length, 1);
  assert.equal(run(f, { seasonMargin: loss + 0.01 }).suggestions.length, 0);
});

test('rank protection blocks a drop even for a better pickup', () => {
  const f = fresh(); better(f);
  const pair = run(f).suggestions[0];
  assert.ok(pair.pickup.seasonValue > pair.drop.seasonValue);
  assert.equal(pair.drop.seasonRank, 2);
  const r = run(f, { protectRank: 2 });
  assert.deepEqual(r.suggestions, []);
  assert.deepEqual(r.topPairs, []);
  assert.equal(r.guardrail.blockedPairs, 1);
  assert.deepEqual(r.guardrail.protectedByRank, [{ name: pair.drop.name, value: pair.drop.seasonValue, rank: 2 }]);
  assert.equal(advise(f.snapshot, f).guardrail.protectRank, 120);
  assert.match(formatAdvice(r), /Alex Sample: [+-][\d.]+ \(#2\)/);
});

test('roster players without usable priors are protected and listed with lookup reasons', () => {
  for (const failure of ['unmapped', 'ambiguous', 'missing', 'null', 'zero-games']) {
    const f = fresh(); better(f);
    if (failure === 'unmapped') f.ids.players.shift();
    if (failure === 'ambiguous') f.ids.players.push({ ...f.ids.players[0] });
    if (failure === 'missing') f.ids.players[0].priorName = null;
    if (failure === 'null') f.priors[0].perGame = null;
    if (failure === 'zero-games') f.priors[0].perGame.g = 0;
    const r = run(f);
    assert.deepEqual(r.topPairs, []);
    assert.deepEqual(r.suggestions, []);
    assert.equal(r.guardrail.blockedPairs, 1);
    assert.deepEqual(r.guardrail.protectedNoPrior, [{ name: 'Alex Sample', nbaTeam: 'AAA',
      reason: failure === 'ambiguous' ? 'ambiguous' : failure === 'unmapped' ? 'not found'
        : failure === 'zero-games' ? 'no games in prior' : 'no prior' }]);
    assert.match(formatAdvice(r), /No prior \(protected, not in projection\):\nAlex Sample \(AAA\):/);
  }
});

test('suggestions and top pairs expose prior-name season values and ranks', () => {
  const f = fresh(); better(f);
  const r = run(f);
  assert.equal(r.guardrail.poolSize, 150);
  for (const pair of [...r.suggestions, ...r.topPairs]) {
    for (const p of [pair.pickup, pair.drop]) {
      assert.ok(Number.isFinite(p.seasonValue));
      assert.ok(Number.isInteger(p.seasonRank));
    }
  }
  assert.match(r.notes.join(' '), /Season guardrail/);
});
