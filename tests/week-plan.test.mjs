import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { planWeek } from '../src/engine/week-plan.mjs';
import { projectPlayers, minutesCase } from '../src/engine/projections.mjs';
import { matchPlayers } from '../src/engine/advice-common.mjs';
import { needs, projectTeam } from '../src/engine/needs.mjs';
import { seasonValues } from '../src/engine/season-value.mjs';
import { addDays } from '../src/engine/weeks.mjs';

// All names, IDs, teams, schedules and box scores below are invented.
const CATEGORIES = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TO', 'FG%', 'FT%'];
const COUNTING = CATEGORIES.slice(0, 7);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${message ?? 'values differ'}: ${actual} versus ${expected}`);

function line(quality = 10) {
  return { g: 70, fgm: quality / 3, fga: quality * 2 / 3,
    ftm: quality / 5, fta: quality / 4, pts: quality, reb: quality / 2,
    ast: quality / 3, stl: quality / 10, blk: quality / 10,
    fg3m: quality / 6, to: 0 };
}

function addPlayer(f, where, name, nbaTeam, { quality = 10, mpg = 30,
  perGame = line(quality), projected = true, ...extra } = {}) {
  const espnId = String(f.ids.players.length + 1);
  const player = { name, nbaTeam, status: null, positions: ['PG'],
    ...(where === 'available' ? { waiverClears: null } : { slot: 'Util' }), ...extra };
  const list = where === 'roster' ? f.snapshot.team.roster
    : where === 'opponent' ? f.snapshot.matchup.opponentRoster : f.snapshot.freeAgents;
  list.push(player);
  f.ids.players.push({ name, team: nbaTeam, espnId, priorName: name });
  if (projected) f.projections.players.push({ name, team: nbaTeam, mpg, perGame });
  return player;
}

function game(f, date, home, away = 'ZZZ') {
  f.schedule.games.push({ date, home, away });
}

function fixture({ start = '2026-10-20', end = '2026-10-26', open = 0, adds = 1 } = {}) {
  const f = {
    snapshot: {
      asOf: `${addDays(start, -1)}T20:00:00Z`,
      settings: { scoringType: 'headone', rosterPositions: [
        { slot: 'Util', count: 1 }, { slot: 'BN', count: open }, { slot: 'IL+', count: 1 },
      ], maxAddsPerWeek: adds, maxGamesPerWeek: null },
      team: { addsUsedThisWeek: 0, roster: [] },
      matchup: { week: 1, start, end,
        totals: { mine: Object.fromEntries(COUNTING.map((c) => [c, 0])),
          opponent: Object.fromEntries(COUNTING.map((c) => [c, 0])) },
        volume: { mine: { fgm: 0, fga: 0, ftm: 0, fta: 0 },
          opponent: { fgm: 0, fga: 0, ftm: 0, fta: 0 } }, opponentRoster: [] },
      freeAgents: [],
    },
    ids: { players: [] }, projections: { players: [] }, schedule: { games: [] },
  };
  addPlayer(f, 'roster', 'Alex Sample', 'AAA');
  addPlayer(f, 'opponent', 'Blair Example', 'BBB');
  addPlayer(f, 'available', 'Casey Fiction', 'CCC', { quality: 30 });
  game(f, start, 'AAA', 'BBB');
  game(f, start, 'CCC', 'DDD');
  return f;
}

const priorFor = (f, name) => f.projections.players.find((p) => p.name ===
  f.ids.players.find((p) => p.name === name).priorName);
const run = (f, options = {}) => planWeek({ ...f,
  options: { protectRank: 0, ...f.options, ...options } });
const key = (step) => [step.start, step.pickup.espnId ?? step.pickup.name,
  step.drop?.espnId ?? step.drop?.name ?? ''];
const planKey = (plan) => plan.map(key);

// Independent scoring for fully known fixtures, using the spec's two lineup modes.
// This deliberately does not use the planner to choose or score a one-step plan.
function knownGain(f, swaps, players = f.projections.players, scoring = {}) {
  const { match } = matchPlayers({ ids: f.ids, priors: players, poolSize: 150 });
  const roster = match(f.snapshot.team.roster, 'roster');
  const opponent = match(f.snapshot.matchup.opponentRoster, 'opponent');
  const available = match(f.snapshot.freeAgents, 'available');
  const byName = new Map([...roster, ...available].map((p) => [p.name, p]));
  const matched = swaps.map((s) => ({ start: s.start, pickup: byName.get(s.pickup.name),
    drop: s.drop ? byName.get(s.drop.name) : null }));
  const from = f.options?.fromDate ?? f.snapshot.matchup.start;
  const project = (list, side, steps = [], preferPickups = false) => projectTeam(list,
    f.snapshot.matchup.totals[side], f.snapshot.matchup.volume[side], f.snapshot.settings,
    f.schedule, from, f.snapshot.matchup.end, steps, null, { preferPickups });
  const before = project(roster, 'mine'), other = project(opponent, 'opponent');
  const automatic = project(roster, 'mine', matched);
  const preferred = project(roster, 'mine', matched, true);
  const pickupNames = new Set(swaps.map((s) => s.pickup.name));
  const starts = (p) => p.started.filter((g) => pickupNames.has(g.name)).length;
  const after = starts(preferred) > starts(automatic) ? preferred : automatic;
  return needs(after, other, undefined, scoring).expectedCategories
    - needs(before, other, undefined, scoring).expectedCategories;
}

function streamFixture() {
  const f = fixture({ start: '2026-10-19', end: '2026-10-23', adds: 2 });
  f.roles = { stream: ['Alex Sample'] };
  f.schedule.games = [];
  for (const date of ['2026-10-19', '2026-10-20']) game(f, date, 'CCC', 'BBB');
  addPlayer(f, 'available', 'Drew Placeholder', 'DDD', { quality: 30 });
  for (const date of ['2026-10-22', '2026-10-23']) game(f, date, 'DDD', 'BBB');
  return f;
}

test('Guardrails: each guardrail rule blocks its drop, and blockedByRule counts it once', () => {
  for (const rule of ['core', 'ilCapacity', 'lineupLock', 'noPrior', 'rank', 'seasonValue']) {
    const f = fixture();
    let options = {};
    if (rule === 'core') f.roles = { core: ['Alex Sample'] };
    if (rule === 'ilCapacity') {
      f.roles = { core: ['Alex Sample'] };
      addPlayer(f, 'roster', 'Ellis Synthetic', 'EEE', { slot: 'IL+', status: 'O' });
    }
    if (rule === 'lineupLock') f.preferences = { lineupLocks: [
      { player: 'Alex Sample', slot: 'Util', date: '2026-10-22' },
    ] };
    if (rule === 'noPrior') f.projections.players = f.projections.players.filter((p) => p.name !== 'Alex Sample');
    if (rule === 'rank') options = { protectRank: 120 };
    if (rule === 'seasonValue') priorFor(f, 'Casey Fiction').perGame = line(1);
    const r = run(f, options);
    assert.equal(r.action, 'hold', rule);
    assert.deepEqual(r.plan, [], rule);
    const expected = { core: 0, ilCapacity: 0, lineupLock: 0, noPrior: 0, rank: 0, seasonValue: 0,
      [rule]: 1 };
    if (rule === 'ilCapacity') expected.core = 1;
    assert.deepEqual(r.guardrail.blockedByRule, expected, `${rule}: count once across all seven search days`);
    if (rule === 'lineupLock') assert.ok(r.preferenceNotes.some((note) => note.includes('Alex Sample')));
  }
  const protectedFixture = fixture();
  protectedFixture.protectedNames = ['Alex Sample'];
  const protectedResult = run(protectedFixture);
  assert.equal(protectedResult.action, 'hold');
  assert.equal(protectedResult.guardrail.blockedByRule.core, 1);
});

test('Empty spot: with an empty roster spot, no step has a drop', () => {
  const f = fixture({ open: 2, adds: 2 });
  f.schedule.games = [];
  game(f, '2026-10-20', 'CCC', 'BBB');
  addPlayer(f, 'available', 'Drew Placeholder', 'DDD', { quality: 30 });
  game(f, '2026-10-21', 'DDD', 'BBB');
  const r = run(f);
  assert.equal(r.action, 'add');
  assert.equal(r.openSpots, 2);
  assert.equal(r.plan.length, 2, 'both useful pickups must actually be evaluated');
  assert.ok(r.plan.every((s) => s.drop === null));
  assert.equal(r.step.drop, null);
  assert.ok(r.runnersUp.every((p) => p.step.drop === null));
});

test('Full days: a pickup whose games fall only on full days gains nothing from them', () => {
  const f = fixture({ open: 1 });
  // Every starter on his game days is stronger, so he gains nothing from games that can't start.
  // A forced start (step 7) displaces a stronger player, so the gain can only be zero or negative.
  priorFor(f, 'Casey Fiction').perGame = line(5);
  const r = run(f);
  assert.ok(r.gain <= 1e-9);
  assert.equal(r.action, 'hold');
  assert.deepEqual(r.plan, []);
  assert.ok(r.baselineLineups.mine.some((g) => g.date === '2026-10-20'));
  assert.ok(knownGain(f, [{ pickup: f.snapshot.freeAgents[0], drop: null, start: '2026-10-20' }]) <= 1e-9);
});

test('Blocked status: a pickup with a blocked status is never a candidate', () => {
  for (const status of ['O', 'D', 'INJ', 'SUSP', 'NA']) {
    const f = fixture({ open: 1 });
    f.snapshot.freeAgents[0].status = status;
    const r = run(f);
    assert.equal(r.action, 'hold', status);
    assert.deepEqual(r.plan, [], status);
    assert.deepEqual(r.runnersUp, [], status);
  }
});

test('Waiver timing: a waiver player who clears Friday is never planned before Friday', () => {
  const f = fixture();
  f.snapshot.freeAgents[0].waiverClears = 'Oct 23';
  game(f, '2026-10-23', 'CCC', 'BBB');
  const r = run(f);
  assert.equal(r.action, 'add', 'a waiver clearing Friday is an effective-now step');
  assert.ok(r.plan.length > 0);
  assert.ok(r.plan.every((s) => s.start >= '2026-10-23'));
  assert.equal(r.step.start, '2026-10-23');
  assert.equal(r.fromDate, '2026-10-20');
  assert.equal(r.addsFrom, r.fromDate);
  assert.equal(r.decision.action, 'move');
  assert.equal(r.decision.pair.pickupStart, '2026-10-23');
});

test('Late clear: a candidate whose earliest start is after the week ends is excluded', () => {
  const f = fixture({ open: 1 });
  f.snapshot.freeAgents[0].waiverClears = 'Oct 27';
  game(f, '2026-10-27', 'CCC', 'BBB');
  const r = run(f);
  assert.equal(r.action, 'hold');
  assert.deepEqual(r.plan, []);
  assert.deepEqual(r.runnersUp, []);
});

test('Missing volume: missing banked makes or attempts leave FG% and FT% out of every plan', () => {
  for (const side of ['mine', 'opponent']) for (const stat of ['fgm', 'fga', 'ftm', 'fta']) {
    const f = fixture();
    f.options = { fromDate: '2026-10-21' };
    game(f, '2026-10-21', 'CCC', 'BBB');
    priorFor(f, 'Casey Fiction').perGame.fgm = 18;
    priorFor(f, 'Casey Fiction').perGame.ftm = 7.4;
    delete f.snapshot.matchup.volume[side][stat];
    const r = run(f);
    assert.equal(r.action, 'add', `${side}/${stat}: counting categories can still support a move`);
    for (const c of ['FG%', 'FT%']) {
      assert.equal(r.baseline.categories[c].pWin, null, `${side}/${stat}/${c}`);
      assert.equal(r.baseline.categories[c].label, 'unknown');
      assert.ok(!(c in r.categories));
      assert.ok(r.unknowns.some((u) => u.category === c));
    }
    assert.deepEqual(Object.keys(r.categories).sort(), [...COUNTING].sort());
    close(r.gain, knownGain(f, r.plan, f.projections.players, { shootingKnown: false }));
    for (const runner of r.runnersUp) {
      close(runner.gain, knownGain(f, [runner.step], f.projections.players, { shootingKnown: false }));
    }
    // An arbitrary reported percentage must not leak into any plan's score.
    const altered = structuredClone(f);
    for (const totals of Object.values(altered.snapshot.matchup.totals)) {
      totals['FG%'] = 0.99; totals['FT%'] = 0.01;
    }
    const again = run(altered);
    close(again.gain, r.gain);
    assert.deepEqual(planKey(again.plan), planKey(r.plan));
    assert.deepEqual(again.runnersUp, r.runnersUp);
  }
});

test('Unknown opponent player: an opponent player with no projection does not change which categories are scored', () => {
  const f = fixture();
  const known = run(f);
  f.projections.players = f.projections.players.filter((p) => p.name !== 'Blair Example');
  const r = run(f);
  assert.deepEqual(Object.keys(r.categories).sort(), Object.keys(known.categories).sort());
  assert.deepEqual(Object.keys(r.categories).sort(), [...CATEGORIES].sort());
  for (const c of CATEGORIES) assert.notEqual(r.baseline.categories[c].pWin, null, c);
  assert.ok(r.unknowns.some((u) => (u.player?.name ?? u.player) === 'Blair Example'));
  assert.equal(r.gainRange.length, 2);
  assert.ok(r.gainRange.every(Number.isFinite));
  assert.ok(r.gainRange[0] <= r.gainRange[1]);
  close(r.gain, r.gainRange[0]);
});

test('Pending claims: pending claims reduce adds left', () => {
  const f = fixture({ open: 1, adds: 4 });
  f.snapshot.team.addsUsedThisWeek = 1;
  f.snapshot.team.pending = { waivers: [
    { date: 'Oct 21', add: 'Ellis Synthetic', drop: null },
    { date: 'Oct 22', add: 'Finn Imaginary', drop: 'Alex Sample' },
  ] };
  assert.equal(run(f).addsLeft, 1);
  assert.equal(run(f).openSpots, 0, 'an add-only pending claim reserves the open spot');
  assert.deepEqual(run(f).plan, [], 'a pending drop cannot be offered again');

  const claimed = fixture({ open: 1, adds: 4 });
  claimed.snapshot.team.pending = { waivers: [{ date: 'Oct 21', add: 'Casey Fiction', drop: null }] };
  assert.equal(run(claimed).addsLeft, 3);
  assert.deepEqual(run(claimed).plan, [], 'a claimed pickup cannot be offered again');

  const exhausted = fixture({ adds: 1 });
  exhausted.snapshot.team.pending = { waivers: [{ date: 'Oct 21', add: 'Ellis Synthetic', drop: null }] };
  const r = run(exhausted);
  assert.equal(r.addsLeft, 0);
  assert.equal(r.action, 'hold');
  assert.deepEqual(r.plan, []);
});

test('Wait: B beats A by more than the bar and waits for Thursday', () => {
  const f = fixture({ end: '2026-10-25' });
  f.roles = { stream: ['Alex Sample'] };
  priorFor(f, 'Casey Fiction').perGame = line(11); // A, Tuesday only
  addPlayer(f, 'available', 'Drew Placeholder', 'DDD', { quality: 30 }); // B
  f.schedule.games = [];
  game(f, '2026-10-20', 'AAA', 'CCC');
  game(f, '2026-10-21', 'AAA', 'BBB');
  game(f, '2026-10-22', 'DDD', 'BBB');
  game(f, '2026-10-24', 'DDD', 'BBB');
  const r = run(f);
  assert.equal(r.action, 'wait');
  assert.equal(r.step, null);
  assert.equal(r.waitFor.pickup.name, 'Drew Placeholder');
  assert.equal(r.waitFor.start, '2026-10-22');
  assert.equal(r.plan[0].drop.name, 'Alex Sample');
  const a = { pickup: f.snapshot.freeAgents[0], drop: f.snapshot.team.roster[0], start: '2026-10-20' };
  const bNow = { ...a, pickup: f.snapshot.freeAgents[1] };
  assert.ok(r.gain - knownGain(f, [a]) > 0.15);
  assert.ok(r.gain - knownGain(f, [bNow]) >= 0.15, 'waiting must also beat adding B now by the bar');
  assert.deepEqual(r.decision, { action: 'hold', pair: null });
});

test('Add now: C plays on the first two open days and a later add reaches only one game', () => {
  const f = fixture({ open: 1, end: '2026-10-21' });
  f.schedule.games = [];
  for (const date of ['2026-10-20', '2026-10-21']) game(f, date, 'CCC', 'BBB');
  const r = run(f);
  assert.equal(r.action, 'add');
  assert.equal(r.step.pickup.name, 'Casey Fiction');
  assert.equal(r.step.start, '2026-10-20');
  assert.equal(r.step.drop, null);
  assert.equal(r.waitFor, null);
  assert.ok(r.gain > knownGain(f, [{ pickup: f.snapshot.freeAgents[0], drop: null, start: '2026-10-21' }]));
  assert.deepEqual(r.decision, { action: 'move', pair: {
    pickup: r.step.pickup, drop: null, pickupStart: r.step.start,
  } });
  const played = r.startsByDay.filter((d) => d.pickupStarts);
  assert.deepEqual(played.map((d) => d.date), ['2026-10-20', '2026-10-21']);
});

test('Hold: no plan clears its bar', () => {
  const r = run(fixture(), { addBar: 10, dropBar: 10 });
  assert.equal(r.action, 'hold');
  assert.ok(r.gain > 0 && r.gain < 10, 'a useful move still falls below the bar');
  assert.equal(r.step, null);
  assert.equal(r.waitFor, null);
  assert.deepEqual(r.decision, { action: 'hold', pair: null });
  for (const c of Object.values(r.categories)) {
    close(c.before, c.after);
    close(c.change, 0);
    close(c.total, 0);
  }
});

test('Two steps: one stream slot and 2 adds chain Monday-Tuesday into Thursday-Friday', () => {
  const f = streamFixture();
  const r = run(f);
  assert.equal(r.action, 'add');
  assert.equal(r.plan.length, 2);
  assert.deepEqual(r.plan.map((s) => s.pickup.name), ['Casey Fiction', 'Drew Placeholder']);
  assert.equal(r.plan[0].start, '2026-10-19');
  assert.ok(r.plan[1].start > '2026-10-20' && r.plan[1].start <= '2026-10-22');
  assert.equal(r.plan[0].drop.name, 'Alex Sample');
  assert.equal(r.plan[1].drop.espnId, r.plan[0].pickup.espnId);
  assert.ok(r.gain > run(f, { maxSteps: 1 }).gain);
  // Report categories refer only to the proposed first step, not the whole chain.
  close(r.categories.PTS.total, 60);
});

test('Two steps: a core pickup is never dropped later in the same plan', () => {
  const f = streamFixture();
  f.roles = { ...f.roles, core: ['Casey Fiction'] };
  const r = run(f);
  assert.ok(r.plan.length);
  assert.ok(r.plan.every((s, i) => r.plan.slice(i + 1).every((t) => t.drop?.name !== 'Casey Fiction')));
});

test('fromDate before the matchup start is refused', () => {
  const f = streamFixture();
  assert.throws(() => run(f, { fromDate: '2026-10-18' }), /before the matchup starts/);
});

test('Beam vs exhaustive: five candidates over three days match an unbounded beam', () => {
  // An unbounded beam keeps every plan the day-by-day expansion generates, so it is an exhaustive
  // search of the plan space. With one stream slot and maxSteps 2 that space has more plans than
  // the default beam of 50 keeps, so the default run has to prune.
  const f = fixture({ start: '2026-10-20', end: '2026-10-22', adds: 2 });
  f.roles = { stream: ['Alex Sample'] };
  for (const [name, team, quality] of [
    ['Drew Placeholder', 'DDD', 14], ['Ellis Synthetic', 'EEE', 18],
    ['Finn Imaginary', 'FFF', 22], ['Gray Madeup', 'GGG', 26],
  ]) addPlayer(f, 'available', name, team, { quality });
  f.schedule.games = [];
  game(f, '2026-10-20', 'CCC', 'BBB');
  game(f, '2026-10-20', 'DDD', 'EEE');
  game(f, '2026-10-21', 'DDD', 'FFF');
  game(f, '2026-10-21', 'GGG', 'BBB');
  game(f, '2026-10-22', 'EEE', 'GGG');
  game(f, '2026-10-22', 'CCC', 'BBB');
  const normal = run(f, { candidates: 5 });
  const exhaustive = run(f, { beam: Infinity, candidates: 5 });
  assert.deepEqual(normal.plan, exhaustive.plan);
  close(normal.gain, exhaustive.gain);
  assert.equal(normal.action, exhaustive.action);
  assert.deepEqual(normal.step, exhaustive.step);
  assert.deepEqual(normal.waitFor, exhaustive.waitFor);
});

test('The 2026-10-22 case: a proposed drop depends on his stronger season minutes and rates', () => {
  const f = fixture({ start: '2026-10-22', end: '2026-10-22' });
  f.roles = { stream: ['Alex Sample'] };
  priorFor(f, 'Alex Sample').mpg = 10;
  priorFor(f, 'Alex Sample').perGame = line(2);
  priorFor(f, 'Casey Fiction').perGame = line(24);
  priorFor(f, 'Blair Example').perGame = line(24);
  const id = f.ids.players.find((p) => p.name === 'Alex Sample').espnId;
  const logs = [0, 1].map((i) => ({ espnId: id, espnEventId: `sample-${i}`,
    date: addDays('2026-10-19', i), starter: true, didNotPlay: false,
    min: 40, ...line(40) }));
  f.projections = projectPlayers(f.projections.players, f.ids, logs, { asOf: f.snapshot.asOf });
  const drop = priorFor(f, 'Alex Sample');
  assert.equal(drop.minutes.prior, 10);
  assert.equal(drop.minutes.season, 40);
  assert.ok(drop.rates.observedPerMinute.pts > drop.original.perGame.pts / drop.original.mpg);
  const cases = ['prior', 'season'].flatMap((m) => ['prior', 'season'].map((r) => {
    const replacement = minutesCase(drop, m, r);
    const players = f.projections.players.map((p) => p === drop ? replacement : p);
    return { players, value: seasonValues(players).get(drop.name).value, m, r };
  })).sort((a, b) => b.value - a.value);
  assert.equal(cases[0].m, 'season');
  assert.equal(cases[0].r, 'season');
  const r = run(f);
  assert.equal(r.action, 'add');
  assert.equal(r.step.drop.name, 'Alex Sample');
  assert.ok(knownGain(f, [r.step], cases[0].players) < 0.15,
    'the highest season-value drop case independently fails the drop bar');
  const dependency = r.dependsOn.find((d) => d.player.name === 'Alex Sample');
  assert.ok(dependency);
  assert.equal(dependency.cautiousAction, 'hold');
  assert.equal(dependency.games, 2);
  assert.equal(dependency.seasonMpg, 40);
  assert.equal(dependency.priorMpg, 10);
});

function seasonOnly(f, name) {
  const entry = f.ids.players.find((p) => p.name === name);
  const p = priorFor(f, name);
  entry.priorName = `espn:${entry.espnId}`;
  p.name = entry.priorName;
  p.source = 'season-only';
  p.perGame.g = 6;
  p.minutes = { games: 6, starts: 6, prior: null, season: p.mpg,
    projected: p.mpg, asOf: f.snapshot.asOf };
}

test('Season-only pickup: a 6-game pickup with no prior is proposed with priorMpg null', () => {
  const f = fixture({ open: 1 });
  f.schedule.games = [];
  game(f, '2026-10-20', 'CCC', 'BBB');
  seasonOnly(f, 'Casey Fiction');
  const r = run(f);
  assert.equal(r.action, 'add');
  assert.equal(r.step.pickup.name, 'Casey Fiction');
  const dependency = r.dependsOn.find((d) => d.player.name === 'Casey Fiction');
  assert.ok(dependency);
  assert.equal(dependency.games, 6);
  assert.equal(dependency.priorMpg, null);
  assert.equal(dependency.cautiousAction, 'hold');
});

test('Season-only drop: noPrior blocks a season-only roster player', () => {
  const f = fixture();
  seasonOnly(f, 'Alex Sample');
  const r = run(f);
  assert.equal(r.action, 'hold');
  assert.deepEqual(r.plan, []);
  assert.equal(r.guardrail.blockedByRule.noPrior, 1);
  assert.deepEqual(r.runnersUp, []);
});

test('Determinism: running twice on one fixture gives byte-identical output', () => {
  const f = streamFixture();
  const before = JSON.stringify(f);
  const first = run(f);
  const second = run(f);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(f), before, 'pure planner must not mutate shared inputs');
});

test('maxSteps: 1 returns the best one-step plan', () => {
  const f = streamFixture();
  const r = run(f, { maxSteps: 1 });
  const choices = [];
  for (let date = f.snapshot.matchup.start; date <= f.snapshot.matchup.end; date = addDays(date, 1)) {
    for (const pickup of f.snapshot.freeAgents) {
      const step = { pickup, drop: f.snapshot.team.roster[0], start: date };
      choices.push({ step, gain: knownGain(f, [step]), id: f.ids.players.find((p) => p.name === pickup.name).espnId });
    }
  }
  choices.sort((a, b) => b.gain - a.gain || a.step.start.localeCompare(b.step.start) || a.id.localeCompare(b.id));
  assert.equal(r.plan.length, 1);
  assert.equal(r.plan[0].pickup.name, choices[0].step.pickup.name);
  assert.equal(r.plan[0].drop.name, choices[0].step.drop.name);
  assert.equal(r.plan[0].start, choices[0].step.start);
  close(r.gain, choices[0].gain);
});

function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

test('Runtime fixture: 13 roster, 13 opponent, 100 available, 7 days and 4 adds', () => {
  const random = mulberry32(20261022);
  const f = fixture({ adds: 4 });
  f.snapshot.team.roster = [];
  f.snapshot.matchup.opponentRoster = [];
  f.snapshot.freeAgents = [];
  f.ids.players = [];
  f.projections.players = [];
  f.schedule.games = [];
  f.snapshot.settings.rosterPositions = [{ slot: 'Util', count: 10 }, { slot: 'BN', count: 3 }];
  const teams = Array.from({ length: 20 }, (_, i) => `A${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`);
  for (const [where, count, first] of [['roster', 13, 'Roster'], ['opponent', 13, 'Opponent'], ['available', 100, 'Available']]) {
    for (let i = 0; i < count; i++) addPlayer(f, where, `${first} Sample ${String(i).padStart(3, '0')}`,
      teams[Math.floor(random() * teams.length)], { quality: 5 + random() * 25,
        mpg: 15 + random() * 20, slot: where === 'available' ? undefined : i < 10 ? 'Util' : 'BN' });
  }
  for (let day = 0; day < 7; day++) {
    const shuffled = [...teams];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const games = 5 + Math.floor(random() * 6);
    for (let i = 0; i < games; i++) game(f, addDays('2026-10-20', day), shuffled[2 * i], shuffled[2 * i + 1]);
  }
  const started = performance.now();
  run(f);
  const elapsed = performance.now() - started;
  console.log(`week-plan runtime: ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed <= 120000, `planner took ${elapsed.toFixed(1)} ms (limit 120000 ms)`);
});
