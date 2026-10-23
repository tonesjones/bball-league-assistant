import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tomorrow } from '../src/engine/weeks.mjs';
import { gamesLeft } from '../src/engine/games-left.mjs';
import { needs, projectTeam, strongLine, UNKNOWN_MPG } from '../src/engine/needs.mjs';
import { advise, pickupStart } from '../src/engine/v0-advice.mjs';
import { formatAdvice, readRoles, snapshotFreshness } from '../scripts/advise.mjs';
import { logHash, easternDate } from '../src/sources/gamelogs.mjs';
import { projectPlayers } from '../src/engine/projections.mjs';

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

test('one modestly strong observed game allows a move that clears every minutes-only case', () => {
  const f = fresh(); better(f);
  const logs = [{ ...f.priors[0].perGame, espnId: '1', date: '2026-10-21', espnEventId: 'game',
    min: 30, starter: true, didNotPlay: false, pts: 20, reb: 6, ast: 5,
    fgm: 7, fga: 13, ftm: 5, fta: 6 }];
  const projections = projectPlayers(f.priors, f.ids, logs);
  const r = run(f, { projections, roles: { stream: ['Alex Sample'] } });
  const pair = r.decision.pair ?? r.decision.best;
  assert.ok(logs[0].pts / logs[0].min > f.priors[0].perGame.pts / f.priors[0].mpg);
  assert.ok(pair.minuteScenarios.every((s) => s.scoreRange[0] >= r.holdBelow));
  assert.equal(r.decision.action, 'move');
  assert.ok(pair.rateScenarios.every((s) => s.scoreRange[0] >= r.holdBelow));
});

test('strong observed production can withhold a drop even when every minutes-only case recommends it', () => {
  const f = fresh(); better(f);
  const logs = [{ ...f.priors[0].perGame, espnId: '1', date: '2026-10-21', espnEventId: 'game',
    min: 30, starter: true, didNotPlay: false, pts: 100, reb: 20, ast: 20, stl: 5, blk: 5,
    fgm: 40, fga: 60, ftm: 20, fta: 20, fg3m: 0, to: 0 }];
  const projections = projectPlayers(f.priors, f.ids, logs);
  const r = run(f, { projections, roles: { stream: ['Alex Sample'] } });
  assert.equal(r.decision.action, 'insufficient');
  assert.ok(r.decision.best.minuteScenarios.every((s) => s.scoreRange[0] >= r.holdBelow));
  assert.ok(r.decision.best.rateScenarios.some((s) => s.scoreRange[0] < r.holdBelow));
  assert.match(formatAdvice(r), /per-minute/);
});

test('current starter versus bench regression withholds an apparent prior-only upgrade after one game', () => {
  const f = fresh(); sameSchedule(f);
  f.snapshot.matchup.end = '2026-10-22';
  f.schedule.games = [{ date: '2026-10-22', home: 'AAA', away: 'BBB' }];
  f.priors[0].mpg = 20;
  f.priors[2].mpg = 30;
  for (const key of Object.keys(f.priors[0].perGame)) if (key !== 'g') f.priors[0].perGame[key] *= 2 / 3;
  const logs = [{ espnId: '1', date: '2026-10-21', espnEventId: 'game', min: 30, starter: true, didNotPlay: false },
    { espnId: '3', date: '2026-10-21', espnEventId: 'game', min: 18, starter: false, didNotPlay: false }];
  const opts = { fromDate: '2026-10-22', protectRank: 0, holdBelow: 0.01, seasonMargin: -100 };
  assert.equal(run(f, opts).decision.action, 'move', 'reproduces the old prior-only recommendation');
  const projections = projectPlayers(f.priors, f.ids, logs, { asOf: f.snapshot.asOf });
  const r = run(f, { ...opts, projections });
  assert.equal(r.decision.action, 'insufficient');
  const best = r.decision.best;
  assert.equal(best.minuteScenarios.length, 4);
  assert.ok(best.scoreRange[0] < 0 && best.scoreRange[1] > opts.holdBelow);
  assert.equal(best.drop.minutes.starts, 1);
  assert.equal(best.pickup.minutes.starts, 0);
  assert.match(formatAdvice(r), /Game logs checked:/);
  const five = Array.from({ length: 5 }, (_, i) => logs.map((l) => ({ ...l, espnEventId: `game-${i}` }))).flat();
  const later = projectPlayers(f.priors, f.ids, five);
  assert.ok(later.players[0].mpg > projections.players[0].mpg);
  assert.ok(later.players[2].mpg < projections.players[2].mpg);
  assert.equal(run(f, { ...opts, projections: later }).decision.action, 'insufficient', 'fixed prior endpoint still blocks the move');
});

test('projected advice can still recommend robust moves and crosses missing production into every minutes case', () => {
  const f = fresh(); better(f);
  let projections = projectPlayers(f.priors, f.ids, []);
  assert.equal(run(f, { projections }).decision.action, 'move');
  f.priors[1].perGame = null;
  projections = projectPlayers(f.priors, f.ids, []);
  const report = run(f, { projections });
  const pair = report.topPairs[0];
  assert.equal(pair.minuteScenarios.length, 4);
  assert.ok(pair.minuteScenarios.every((s) => s.scoreRange[0] < s.scoreRange[1]));
  const core = run(f, { projections, protectedNames: [f.snapshot.team.roster[0].name] });
  assert.equal(core.decision.action, 'hold');
  assert.equal(core.topPairs.length, 0);
});

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
  assert.equal(r.decision.action, 'hold');
});

test('an unprojected stream drop needs evidence before its apparent gain is trusted', () => {
  const f = fresh(); sameSchedule(f); f.priors[0].perGame = null;
  f.priors[2].perGame.pts = 20;
  for (let i = 0; i < 12; i++) f.priors.push({ name: `Anchor ${i}`, perGame: {
    ...f.priors[1].perGame, pts: 40, reb: 10, ast: 10, stl: 2, blk: 2, fg3m: 3,
    fga: 20, fgm: 12, fta: 10, ftm: 9, to: 1,
  } });
  const extra = { roles: { stream: ['Alex Sample'] } };
  const r = run(f, extra);
  assert.equal(r.decision.action, 'insufficient');
  assert.ok(r.decision.best.score >= r.holdBelow);
  assert.ok(r.decision.best.scoreRange[0] < r.holdBelow);
  assert.deepEqual(r.decision.missing, [{ name: 'Alex Sample', nbaTeam: 'AAA', side: 'mine', starts: 3, reason: 'no prior' }]);
  assert.match(formatAdvice(r), /^Insufficient evidence: /);
  assert.match(formatAdvice(r), /Missing: Alex Sample \(AAA, mine\): 3 starts, no prior/);
  assert.match(formatAdvice(r), /Score range: /);
  Object.assign(f.priors[2].perGame, { pts: 80, reb: 20, ast: 20, stl: 4, blk: 4, fg3m: 6,
    fga: 30, fgm: 27, fta: 20, ftm: 19, to: 0.1 });
  assert.equal(run(f, extra).decision.action, 'move');
});

test('unknown opponent starts widen the outlook and can withhold a zero-fill upgrade', () => {
  const f = fresh(); better(f); f.priors[1].perGame = null;
  for (let i = 0; i < 12; i++) f.priors.push({ name: `Anchor ${i}`, perGame: {
    ...f.priors[0].perGame, pts: 1000, reb: 1000, ast: 1000, stl: 1000, blk: 1000,
    fg3m: 1000, fgm: 90, fga: 100, ftm: 90, fta: 100, to: 0.1,
  } });
  const r = run(f, { holdBelow: 0.0002 });
  assert.equal(r.decision.action, 'insufficient');
  assert.ok(r.decision.best.score >= r.holdBelow);
  assert.ok(r.decision.best.scoreRange[0] < r.holdBelow);
  for (const c of Object.values(r.baseline.categories)) {
    assert.equal(c.complete, false);
    assert.ok(c.pWinRange[0] < c.pWinRange[1]);
  }
  assert.ok(r.baseline.expectedRange[0] < r.baseline.expectedRange[1]);
  assert.deepEqual(r.decision.missing, [{ name: 'Blair Example', nbaTeam: 'BBB', side: 'opponent', starts: 3, reason: 'no prior' }]);
  assert.match(formatAdvice(r), /PTS\s+45\.000\s+0\.000\s+\d\.\d{2}-\d\.\d{2}\s+incomplete/);
  assert.match(formatAdvice(r), /Missing: Blair Example \(BBB, opponent\): 3 starts, no prior/);
  assert.equal(run(f, { holdBelow: r.decision.best.scoreRange[1] }).decision.action, 'insufficient');
  const hold = run(f, { holdBelow: r.decision.best.scoreRange[1] + 0.01 });
  assert.equal(hold.decision.action, 'hold');
  assert.ok(hold.decision.reason.includes(r.decision.best.scoreRange[1].toFixed(3)));
  f.snapshot.team.addsUsedThisWeek = 4;
  assert.equal(run(f).decision.reason, 'No adds left this week.');
});

test('fully projected outlooks and pair ranges retain the zero-fill numbers and decisions', () => {
  for (const improve of [false, true]) {
    const f = fresh(); sameSchedule(f); if (improve) better(f);
    const r = run(f);
    for (const c of Object.values(r.baseline.categories)) {
      assert.equal(c.complete, true);
      assert.deepEqual(c.pWinRange, [c.pWin, c.pWin]);
    }
    assert.deepEqual(r.baseline.expectedRange, [r.baseline.expectedCategories, r.baseline.expectedCategories]);
    for (const p of r.topPairs) assert.deepEqual(p.scoreRange, [p.score, p.score]);
    assert.equal(r.decision.action, improve ? 'move' : 'hold');
    assert.doesNotMatch(formatAdvice(r), /Score range: |incomplete/);
  }
});

test('strong line uses nearest ranks, low TO, attempt-weighted shooting and the ranked pool', () => {
  const priors = Array.from({ length: 11 }, (_, i) => {
    const n = i + 1;
    return { name: `Prior ${n}`, perGame: { g: 70, pts: n * 3, reb: n, ast: n * 2,
      stl: n / 2, blk: n / 3, fg3m: n / 4, to: n, fga: n + 1, fgm: (n + 1) * n / 12,
      fta: n * 2, ftm: n * 2 * n / 13 } };
  });
  const line = strongLine(priors);
  const { fgm, ftm, ...counts } = line;
  assert.deepEqual(counts, { pts: 30, reb: 10, ast: 20, stl: 5, blk: 10 / 3, fg3m: 2.5,
    to: 2, fga: 11, fta: 20 });
  near(fgm, 11 * (10 / 12));
  near(ftm, 20 * (10 / 13));
  assert.deepEqual(strongLine([...priors].reverse()), line);
  const top = strongLine(priors, { poolSize: 1 });
  assert.equal(top.pts, 3);
  assert.equal(top.to, 1);
  const noAttempts = structuredClone(priors[0]);
  Object.assign(noAttempts.perGame, { fgm: 999, fga: 0, ftm: 999, fta: 0 });
  const mixed = strongLine([noAttempts, priors[10]]);
  near(mixed.fgm, priors[10].perGame.fgm);
  near(mixed.ftm, priors[10].perGame.ftm);
  assert.equal(strongLine([noAttempts]).fgm, 0);
  assert.equal(strongLine([noAttempts]).ftm, 0);
  assert.throws(() => strongLine([]), /empty|pool/);
  assert.throws(() => strongLine([{ name: 'No games', perGame: { g: 0 } }]), /empty|pool/);
});

test('projectTeam fills unknown starts without changing slots, cap or start records', () => {
  const f = fresh(), unknown = { name: 'Drew Placeholder', nbaTeam: 'AAA', slot: 'BN', prior: null };
  const roster = [scored(f), unknown], fill = strongLine(f.priors);
  const zero = project(f, roster);
  const filled = projectTeam(roster, {}, {}, f.snapshot.settings, f.schedule, '2026-10-20', '2026-11-01', null, fill);
  assert.equal(zero.unknownGames, 3);
  assert.deepEqual(zero.unknownStarts, ['2026-10-20', '2026-10-22', '2026-11-01'].map((date) => ({ name: unknown.name, date })));
  assert.deepEqual(filled.unknownStarts, zero.unknownStarts);
  assert.deepEqual(filled.started, zero.started);
  assert.equal(filled.unknownGames, zero.unknownGames);
  for (const k of Object.keys(zero.line)) {
    near(filled.line[k] - zero.line[k], fill[k] * zero.unknownGames);
    near(filled.remaining[k] - zero.remaining[k], fill[k] * zero.unknownGames);
  }
});

test('four crossed scenarios score the chosen lineup and missing starts count each date once', () => {
  const f = fresh(); better(f);
  f.priors[0].perGame = null;
  f.priors[1].perGame = null;
  f.snapshot.freeAgents[0].waiverClears = 'Oct 22';
  const r = run(f, { roles: { stream: ['Alex Sample'] } });
  assert.equal(r.decision.action, 'insufficient');
  const fill = strongLine(f.priors), [drop] = f.snapshot.team.roster;
  const pickup = { ...f.snapshot.freeAgents[0], prior: f.priors[2] };
  const swap = { pickup, drop, start: '2026-10-22' };
  const expected = [], gains = [];
  for (const mineFill of [null, fill]) for (const opponentFill of [null, fill]) {
    const project = (roster, swap, fill) => projectTeam(roster, {}, {}, f.snapshot.settings, f.schedule,
      '2026-10-20', '2026-11-01', swap, fill);
    const mine = project([drop], null, mineFill);
    const opponent = project(f.snapshot.matchup.opponentRoster, null, opponentFill);
    const baseline = needs(mine, opponent);
    expected.push(baseline.expectedCategories);
    gains.push(needs(project([drop], swap, mineFill), opponent).expectedCategories - baseline.expectedCategories);
  }
  assert.deepEqual(r.baseline.expectedRange, [Math.min(...expected), Math.max(...expected)]);
  assert.deepEqual(r.decision.best.scoreRange, [Math.min(...gains), Math.max(...gains)]);
  assert.deepEqual(r.decision.missing, [
    { name: 'Alex Sample', nbaTeam: 'AAA', side: 'mine', starts: 3, reason: 'no prior' },
    { name: 'Blair Example', nbaTeam: 'BBB', side: 'opponent', starts: 3, reason: 'no prior' },
  ]);
});

test('pairs sort by the worst case and a robust move wins over a higher zero-fill score', () => {
  const f = fresh(); better(f); f.priors[0].perGame = null;
  f.snapshot.team.roster.push({ name: 'Drew Placeholder', nbaTeam: 'AAA', slot: 'BN' });
  f.ids.players.push({ name: 'Drew Placeholder', team: 'AAA', priorName: 'Blair Old' });
  const r = run(f, { roles: { stream: ['Alex Sample', 'Drew Placeholder'] }, holdBelow: 0 });
  assert.equal(r.decision.action, 'move');
  assert.equal(r.decision.pair.drop.name, 'Drew Placeholder');
  const [robust, optimistic] = r.topPairs;
  assert.ok(robust.scoreRange[0] > optimistic.scoreRange[0]);
  assert.ok(robust.score < optimistic.score);
  const uncertain = run(f, { roles: { stream: ['Alex Sample', 'Drew Placeholder'] }, holdBelow: 0.1, top: 0 });
  assert.equal(uncertain.decision.action, 'insufficient');
  assert.equal(uncertain.decision.best.drop.name, 'Alex Sample');
  assert.deepEqual(uncertain.topPairs, []);
});

test('hold below the default threshold, move at the threshold, and retain the best pair with top zero', () => {
  const f = fresh(); sameSchedule(f); f.priors[2].perGame.pts = 15.1;
  const r = run(f);
  assert.equal(r.holdBelow, 0.15);
  assert.equal(r.decision.action, 'hold');
  assert.ok(r.decision.best.score > 0 && r.decision.best.score < 0.15);
  assert.match(r.decision.reason, /expected categories/);
  assert.match(formatAdvice(r), /^Hold:/);
  const move = run(f, { holdBelow: r.decision.best.score, top: 0 });
  assert.equal(move.decision.action, 'move');
  assert.deepEqual(move.topPairs, []);
  assert.match(formatAdvice(move), /^Move: pick up Casey Fiction, drop Alex Sample \[normal\]\nUnknown games: mine 0 \| opponent 0/);
  assert.match(move.notes.join(' '), /refresh the league and rerun/);
  assert.doesNotMatch(move.notes.join(' '), /Pairs are scored independently|ignores positional eligibility/);
  assert.equal(run(f, { holdBelow: 10 }).decision.action, 'hold');
  assert.equal(run(fresh(), { protectedNames: ['Alex Sample'] }).decision.best, null);
  for (const holdBelow of [-1, NaN, Infinity]) assert.throws(() => run(f, { holdBelow }), /holdBelow/);
});

test('no-prior starts consume slots and the cap, contribute zero, and are reported per side and pair', () => {
  const f = fresh(); better(f);
  f.snapshot.settings.rosterPositions[0].count = 1;
  f.priors[0].mpg = UNKNOWN_MPG - 1;
  f.priors[1].perGame = null;
  const unknown = { name: 'Drew Placeholder', nbaTeam: 'AAA', positions: ['C'], slot: 'BN', prior: null };
  f.snapshot.team.roster.push(unknown);
  const r = run(f);
  assert.equal(r.baseline.categories.PTS.mine, 0);
  assert.equal(r.baseline.categories.PTS.opponent, 0);
  assert.deepEqual(r.unknownGames, { mine: 3, opponent: 3 });
  assert.equal(r.topPairs[0].unknownGames, 0);
  const p = project(f, [scored(f), unknown]);
  assert.equal(p.unknownGames, 3);
  assert.equal(p.started.length, 3);
  assert.equal(p.totals.PTS, 0);
  f.snapshot.settings.maxGamesPerWeek = 1;
  assert.equal(project(f, [unknown]).unknownGames, 1);
  for (const slot of ['IL', 'IL+']) assert.equal(project(f, [{ ...unknown, slot }]).unknownGames, 0);
  for (const status of ['O', 'D', 'INJ', 'SUSP', 'NA']) assert.equal(project(f, [{ ...unknown, status }]).unknownGames, 0);
  assert.equal(project(f, [{ ...unknown, nbaTeam: 'ZZZ' }]).unknownGames, 0);
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
  assert.equal(r.decision.action, 'hold');
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
      assert.equal(r.baseline.categories[c].pWinRange, null);
      assert.equal(r.baseline.categories[c].complete, false);
      assert.match(formatAdvice(r), new RegExp(`^${c}\\s.*\\sunknown$`, 'm'));
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
  assert.ok(rebuilt.notes.includes('Shooting volume assumes every open lineup slot was filled.'));
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
  assert.equal(r.decision.action, 'hold');
});

test('daily starts use mpg, allow BN, exclude IL/IL+ and every blocked status', () => {
  const f = fresh(); f.snapshot.settings.rosterPositions[0].count = 1;
  const low = scored(f); low.prior.mpg = null;
  const high = { ...scored(f, 2), name: 'High', slot: 'BN' };
  const roster = [low, high, ...['IL', 'IL+'].map((slot) => ({ ...high, slot })),
    ...['O', 'D', 'INJ', 'SUSP', 'NA'].map((status) => ({ ...high, status }))];
  const p = project(f, roster);
  assert.equal(p.started.length, 3);
  assert.ok(p.started.every((g) => g.name === 'High'));
});

test('advice can deliberately start a lower-mpg pickup and reports the displaced starter', () => {
  const f = fresh();
  f.snapshot.matchup.start = '2026-10-21';
  f.snapshot.matchup.end = '2026-10-21';
  f.snapshot.settings.rosterPositions = [{ slot: 'C', count: 1 }, { slot: 'PG', count: 1 }];
  f.snapshot.team.roster[0].positions = ['C'];
  f.snapshot.team.roster.push({ name: 'Guard Stream', nbaTeam: 'DDD', positions: ['PG'], status: 'NA', slot: 'PG' });
  f.snapshot.freeAgents[0].positions = ['C'];
  f.priors[2].mpg = 10;
  f.priors[2].perGame.pts = 60;
  f.schedule.games = [{ date: '2026-10-21', home: 'AAA', away: 'CCC' }];

  const r = run(f, { fromDate: '2026-10-21', roles: { core: ['Alex Sample'], stream: ['Guard Stream'] } });
  const pair = r.topPairs[0];
  assert.equal(pair.pickup.name, 'Casey Fiction');
  assert.equal(pair.drop.name, 'Guard Stream');
  assert.ok(pair.score > 0);
  assert.deepEqual(pair.lineup, {
    mode: 'start-pickup',
    automaticPickupStarts: 0,
    pickupStarts: 1,
    displaced: [{ name: 'Alex Sample', date: '2026-10-21' }],
    started: [{ name: 'Casey Fiction', date: '2026-10-21', slot: 'C' }],
  });
  assert.match(formatAdvice(r), /Lineup: deliberately start Casey Fiction once; displaces Alex Sample on 2026-10-21\./);
});

test('a deliberately started pickup keeps its real tradeoff when the automatic bench scores better', () => {
  const f = fresh();
  f.snapshot.matchup.start = '2026-10-21';
  f.snapshot.matchup.end = '2026-10-21';
  f.snapshot.settings.rosterPositions = [{ slot: 'C', count: 1 }, { slot: 'PG', count: 1 }];
  f.snapshot.team.roster[0].positions = ['C'];
  f.snapshot.team.roster.push({ name: 'Guard Stream', nbaTeam: 'DDD', positions: ['PG'], status: 'NA', slot: 'PG' });
  f.snapshot.freeAgents[0].positions = ['C'];
  f.priors[2].mpg = 10;
  Object.assign(f.priors[2].perGame, { fgm: 0, fga: 0, ftm: 0, fta: 0, pts: 0, reb: 0,
    ast: 0, stl: 0, blk: 0, to: 10, fg3m: 0 });
  f.schedule.games = [{ date: '2026-10-21', home: 'AAA', away: 'CCC' }];

  const r = run(f, { fromDate: '2026-10-21', roles: { core: ['Alex Sample'], stream: ['Guard Stream'] } });
  const pair = r.topPairs[0];
  assert.equal(pair.lineup.mode, 'start-pickup');
  assert.equal(pair.lineup.pickupStarts, 1);
  assert.deepEqual(pair.lineup.displaced, [{ name: 'Alex Sample', date: '2026-10-21' }]);
  assert.ok(pair.score < 0);
  assert.equal(pair.changes.PTS.total, -15);
  assert.equal(r.decision.action, 'hold');
});

test('remaining games cap stops both teams and is reapplied after each swap', () => {
  const f = fresh(); better(f); f.snapshot.settings.maxGamesPerWeek = 1;
  const r = run(f);
  assert.equal(r.baseline.categories.PTS.mine, 15);
  assert.equal(r.baseline.categories.PTS.opponent, 15);
  assert.equal(r.topPairs[0].changes.PTS.total, 45);
  assert.equal(project(f, [scored(f)]).started.length, 1);
  assert.match(r.notes.join(' '), /cap ignores games already used/);
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
  assert.equal(run(f).decision.action, 'move');
  assert.deepEqual(run(f, { protectedNames: ['Álex Sample Jr.'] }).topPairs, []);
});

test('each unavailable pickup status is excluded', () => {
  for (const status of ['O', 'D', 'INJ', 'SUSP', 'NA']) {
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

test('one best move respects adds left, null default, and zero floor', () => {
  const f = fresh(); better(f);
  for (let i = 1; i <= 5; i++) {
    const pickup = `Pickup Fiction ${i}`;
    f.snapshot.freeAgents.push({ ...f.snapshot.freeAgents[0], name: pickup });
    f.ids.players.push({ name: pickup, espnId: `p${i}`, priorName: 'Casey Old' });
  }
  for (const [max, used, expected] of [[4, 2, 2], [null, 0, 4], [2, 9, 0], [0, 0, 0]]) {
    f.snapshot.settings.maxAddsPerWeek = max; f.snapshot.team.addsUsedThisWeek = used;
    const r = run(f, { top: 100 });
    assert.equal(r.addsLeft, expected);
    assert.equal(r.decision.action, expected ? 'move' : 'hold');
    assert.equal('suggestions' in r, false);
    if (expected) assert.deepEqual(r.decision.pair, r.topPairs[0]);
    else {
      assert.match(r.decision.reason, /No adds left/);
      assert.deepEqual(r.decision.best, r.topPairs[0]);
    }
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
    const logDir = path.join(dir, 'local/gamelogs/2026-27');
    await mkdir(logDir, { recursive: true });
    const through = easternDate(f.snapshot.asOf), text = '[]\n';
    await writeFile(path.join(logDir, `${through}.json`), text);
    await writeFile(path.join(logDir, '_coverage.json'), JSON.stringify({ from: through, through, checkedAt: f.snapshot.asOf, hashes: { [through]: logHash(text) } }));
    const output = execFileSync(process.execPath, [cli, 'snapshot.json', '--allow-stale', '--max-age-hours', '0', '--hold-below', '0.02', '--from', '2026-10-22', '--adds-from', '2026-11-01', '--top', '1', '--margin', '-0.25', '--protect-rank', '0'], { cwd: dir, encoding: 'utf8' });
    const report = JSON.parse(await readFile(path.join(dir, 'local/advice/snapshot.json'), 'utf8'));
    assert.equal(report.fromDate, '2026-10-22');
    assert.equal(report.topPairs.length, 1);
    assert.equal(report.topPairs[0].pickupStart, '2026-11-01');
    assert.equal(report.guardrail.seasonMargin, -0.25);
    assert.equal(report.guardrail.protectRank, 0);
    assert.equal(report.holdBelow, 0.02);
    const saved = JSON.parse(await readFile(path.join(dir, `local/decisions/${report.decisionId}.json`), 'utf8'));
    assert.equal(saved.projections.version, 'minutes-rates-pseudogames-v3');
    assert.equal(saved.projections.k, 2);
    assert.equal(saved.projections.players.length, f.priors.length);
    assert.equal(saved.projections.players[0].original.mpg, f.priors[0].mpg);
    assert.equal(report.freshness.stale, true);
    assert.match(output, /^STALE:/);
    assert.throws(() => execFileSync(process.execPath, [cli, 'snapshot.json', '--max-age-hours', '0'], { cwd: dir, stdio: 'pipe' }), /hours old/);
    assert.match(output, /Season value: pickup [+-][\d.]+ \(#\d+\) vs drop [+-][\d.]+ \(#\d+\)/);
    assert.match(output, /Season guardrail:/);
    assert.match(output, /No prior \(protected, starts counted as unknown games\):/);
    assert.ok(output.includes(formatAdvice(report)));
    await mkdir(path.join(dir, 'local/snapshots'), { recursive: true });
    await writeFile(path.join(dir, 'local/snapshots/newest.json'), JSON.stringify(f.snapshot));
    const defaultOutput = execFileSync(process.execPath, [cli, '--allow-stale'], { cwd: dir, encoding: 'utf8' });
    assert.match(defaultOutput, /newest.json/);
    await writeFile(path.join(logDir, '_coverage.json'), JSON.stringify({ from: through, through, checkedAt: new Date(Date.parse(f.snapshot.asOf) - 1).toISOString(), hashes: { [through]: logHash(text) } }));
    assert.throws(() => execFileSync(process.execPath, [cli, 'snapshot.json', '--allow-stale'], { cwd: dir, stdio: 'pipe' }), /Game logs are older than the snapshot/);
    assert.match(output, /Core players: None\./);
    assert.match(output, /Stream players: None\./);
    for (const args of [['--minutes-k', '0'], ['--minutes-k', '-1'], ['--minutes-k', 'NaN'], ['--minutes-k'], ['--from', '2026-02-30'], ['--top', '-1'], ['--margin', 'Infinity'], ['--margin', 'NaN'], ['--margin'], ['--protect-rank', '-1'], ['--protect-rank', '1.5'], ['--hold-below', '-1'], ['--hold-below', 'NaN'], ['--hold-below'], ['--max-age-hours', '-1'], ['--max-age-hours', 'Infinity'], ['--max-age-hours']]) {
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
  assert.ok(unrestricted.decision.pair.score > 0);
  const r = run(f);
  assert.equal(r.decision.action, 'hold');
  assert.deepEqual(r.topPairs, []);
  assert.equal(r.guardrail.blockedPairs, 1);
  assert.equal(r.guardrail.blockedByRule.seasonValue, 1);
});

test('positive seasonMargin blocks a small upgrade; negative margin permits a small downgrade', () => {
  const f = fresh(); sameSchedule(f);
  f.priors[2].perGame.pts = 15.1;
  f.priors.push({ name: 'Marigold Anchor', perGame: { ...f.priors[0].perGame, pts: 100 } },
    { name: 'Nettle Anchor', perGame: { ...f.priors[0].perGame, pts: 0 } });
  const pair = run(f, { holdBelow: 0 }).decision.pair;
  const gap = pair.pickup.seasonValue - pair.drop.seasonValue;
  assert.ok(gap > 0 && gap < 0.01);
  assert.equal(run(f, { seasonMargin: gap + 0.01 }).guardrail.blockedPairs, 1);
  assert.equal(run(f, { seasonMargin: gap, holdBelow: 0 }).decision.action, 'move');
  f.priors[2].perGame.pts = 14.9;
  f.snapshot.freeAgents[0].nbaTeam = 'BBB';
  f.snapshot.team.roster[0].nbaTeam = 'CCC';
  const worse = run(f, { seasonMargin: -100 }).decision.pair;
  const loss = worse.pickup.seasonValue - worse.drop.seasonValue;
  assert.ok(loss < 0);
  assert.equal(run(f, { seasonMargin: loss - 0.01 }).decision.action, 'move');
  assert.equal(run(f, { seasonMargin: loss + 0.01 }).decision.action, 'hold');
});

test('rank protection blocks a drop even for a better pickup', () => {
  const f = fresh(); better(f);
  const pair = run(f).decision.pair;
  assert.ok(pair.pickup.seasonValue > pair.drop.seasonValue);
  assert.equal(pair.drop.seasonRank, 2);
  const r = run(f, { protectRank: 2 });
  assert.equal(r.decision.action, 'hold');
  assert.deepEqual(r.topPairs, []);
  assert.equal(r.guardrail.blockedPairs, 1);
  assert.deepEqual(r.guardrail.protectedByRank, [{ name: pair.drop.name, value: pair.drop.seasonValue, rank: 2 }]);
  assert.equal(r.guardrail.blockedByRule.rank, 1);
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
    assert.equal(r.decision.action, 'hold');
    assert.equal(r.guardrail.blockedPairs, 1);
    assert.equal(r.guardrail.blockedByRule.noPrior, 1);
    assert.deepEqual(r.guardrail.protectedNoPrior, [{ name: 'Alex Sample', nbaTeam: 'AAA',
      reason: failure === 'ambiguous' ? 'ambiguous' : failure === 'unmapped' ? 'not found'
        : failure === 'zero-games' ? 'no games in prior' : 'no prior' }]);
    assert.match(formatAdvice(r), /No prior \(protected, starts counted as unknown games\):\nAlex Sample \(AAA\):/);
  }
});

test('decision and top pairs expose prior-name season values and ranks', () => {
  const f = fresh(); better(f);
  const r = run(f);
  assert.equal(r.guardrail.poolSize, 150);
  for (const pair of [r.decision.pair, ...r.topPairs]) {
    for (const p of [pair.pickup, pair.drop]) {
      assert.ok(Number.isFinite(p.seasonValue));
      assert.ok(Number.isInteger(p.seasonRank));
    }
  }
  assert.match(r.notes.join(' '), /Season guardrail/);
  assert.equal(r.decision.pair.dropRole, 'normal');
});

test('stream roles bypass season value and rank protection, but still require a weekly gain and hold threshold', () => {
  const f = fresh();
  f.priors[2].perGame.pts = 14;
  f.snapshot.freeAgents[0].nbaTeam = 'BBB';
  f.snapshot.team.roster[0].nbaTeam = 'CCC';
  const roles = { stream: ['Álex Sample Jr.'] };
  const r = run(f, { roles, protectRank: 120, seasonMargin: 100 });
  assert.equal(r.decision.action, 'move');
  const pair = r.decision.pair;
  assert.ok(pair.drop.seasonValue > pair.pickup.seasonValue);
  assert.ok(pair.score > 0);
  assert.equal(pair.dropRole, 'stream');
  assert.equal(r.guardrail.blockedPairs, 0);
  assert.deepEqual(r.guardrail.protectedByRank, []);
  assert.match(formatAdvice(r), /Drop Alex Sample \[stream\]/);
  assert.match(formatAdvice(r), /Stream players: Álex Sample Jr\./);
  assert.equal(run(f, { roles, holdBelow: pair.score + 0.01 }).decision.action, 'hold');
  sameSchedule(f);
  f.snapshot.team.roster[0].nbaTeam = 'AAA';
  assert.equal(run(f, { roles, holdBelow: 0 }).decision.action, 'hold');
  f.priors[2].perGame.pts = 15;
  assert.equal(run(f, { roles, holdBelow: 0 }).decision.action, 'hold');
  f.snapshot.freeAgents[0].status = 'O';
  assert.deepEqual(run(f, { roles }).topPairs, []);
});

test('core roles and legacy protected names never drop and count blocked pairs', () => {
  const f = fresh(); better(f);
  for (const extra of [{ roles: { core: ['Álex Sample Jr.'] } }, { protectedNames: ['Alex Sample'] }]) {
    const r = run(f, extra);
    assert.equal(r.decision.action, 'hold');
    assert.deepEqual(r.topPairs, []);
    assert.equal(r.guardrail.blockedPairs, 1);
    assert.deepEqual(r.guardrail.blockedByRule, { core: 1, noPrior: 0, rank: 0, seasonValue: 0 });
    assert.match(formatAdvice(r), /Core players: /);
    assert.match(formatAdvice(r), /core 1 \| noPrior 0 \| rank 0 \| seasonValue 0/);
  }
});

test('stream players without a prior stay eligible but need evidence and report unknown season value', () => {
  const f = fresh(); better(f); f.priors[0].perGame = null;
  const r = run(f, { roles: { stream: ['Alex Sample'] } });
  assert.equal(r.decision.action, 'insufficient');
  assert.equal(r.decision.best.drop.seasonValue, null);
  assert.equal(r.decision.best.drop.seasonRank, null);
  assert.equal(r.decision.best.dropRole, 'stream');
  assert.deepEqual(r.guardrail.protectedNoPrior, []);
  assert.match(formatAdvice(r), /vs drop unknown/);
});

test('normalized role conflicts, including legacy protected names, throw', () => {
  const f = fresh();
  assert.throws(() => run(f, { roles: { core: ['Alex Sample'], stream: ['Álex Sample Jr.'] } }), /both core and stream/);
  assert.throws(() => run(f, { roles: { stream: ['Alex Sample'] }, protectedNames: ['Álex Sample Jr.'] }), /both core and stream/);
});

test('roles file helper defaults empty, reads legacy protection as core, merges, and validates', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'v0-roles-'));
  const rolesFile = path.join(dir, 'roles.json'), protectedFile = path.join(dir, 'protected.json');
  try {
    assert.deepEqual(await readRoles(rolesFile, protectedFile), { core: [], stream: [] });
    await writeFile(protectedFile, JSON.stringify({ protected: ['Alex Sample'] }));
    const legacy = await readRoles(rolesFile, protectedFile);
    assert.deepEqual(legacy, { core: ['Alex Sample'], stream: [] });
    const f = fresh(); better(f);
    assert.equal(run(f, { roles: legacy }).decision.action, 'hold');
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
