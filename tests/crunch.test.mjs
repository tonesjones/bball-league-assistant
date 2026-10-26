import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterCrunch } from '../src/engine/crunch.mjs';
import { projectTeam } from '../src/engine/needs.mjs';

const prior = (mpg, pts) => ({ mpg, perGame: { pts, reb: 2, ast: 1, stl: 0, blk: 0, fg3m: 1, to: 1, fgm: 4, fga: 9, ftm: 2, fta: 3 } });
const player = (name, positions, mpg, extra = {}) => ({ name, nbaTeam: 'AAA', positions, status: null, slot: 'BN', prior: prior(mpg, 10), ...extra });
const settings = (slots, maxGamesPerWeek = null) => ({ rosterPositions: [...slots, { slot: 'BN', count: 5 }], maxGamesPerWeek });
const days = (...dates) => ({ games: dates.map((date) => ({ date, home: 'AAA', away: 'ZZZ' })) });
const run = (roster, slots, schedule, cap, lines = {}) => rosterCrunch({
  snapshot: { settings: settings(slots, cap), team: { roster } }, schedule, lines, fromDate: '2026-10-20', endDate: '2026-10-26' });

test('more players than slots benches the lowest-priority player, the one projectTeam leaves out', () => {
  const roster = [player('Low Min', ['PG'], 10), player('High Min', ['PG'], 30), player('Mid Min', ['PG'], 20)];
  const slots = [{ slot: 'Util', count: 2 }], schedule = days('2026-10-20');
  const c = run(roster, slots, schedule);
  assert.deepEqual(c.days[0].sits, [{ name: 'Low Min', reason: 'no open slot' }]);
  const team = projectTeam(roster, {}, {}, settings(slots), schedule, '2026-10-20', '2026-10-26');
  assert.deepEqual(team.started.map((s) => s.name).sort(), c.days[0].starts.map((s) => s.name).sort());
});

test('a free slot the player cannot fill shows no eligible position', () => {
  const roster = [player('Big One', ['C'], 30), player('Big Two', ['C'], 20)];
  const c = run(roster, [{ slot: 'C', count: 1 }, { slot: 'G', count: 1 }], days('2026-10-20'));
  assert.deepEqual(c.days[0].sits, [{ name: 'Big Two', reason: 'no eligible position' }]);
});

test('games after the cap show games cap', () => {
  const roster = [player('Solo', ['PG'], 30)];
  const c = run(roster, [{ slot: 'Util', count: 1 }], days('2026-10-20', '2026-10-21', '2026-10-22'), 2);
  assert.deepEqual(c.days.map((d) => d.sits.map((s) => s.reason)), [[], [], ['games cap']]);
  assert.equal(c.byPlayer[0].starts, 2);
});

test('lost production is games sat times the line; an unknown line is unknown, not 0', () => {
  const roster = [player('Sitter', ['PG'], 10), player('Unknown', ['PG'], 5, { prior: null }), player('Starter', ['PG'], 30)];
  const lines = { Sitter: roster[0].prior.perGame };
  const c = run(roster, [{ slot: 'Util', count: 1 }], days('2026-10-20', '2026-10-21'), null, lines);
  const sitter = c.byPlayer.find((e) => e.name === 'Sitter'), unknown = c.byPlayer.find((e) => e.name === 'Unknown');
  assert.equal(sitter.sat, 2);
  assert.equal(sitter.lost.pts, 20);
  assert.equal(sitter.lost.fgm, 8);
  assert.equal(sitter.lost.fga, 18);
  assert.equal(unknown.lost.pts, 'unknown');
  assert.deepEqual(c.chronicSitters, ['Sitter', 'Unknown']);
});

test('a locked player who starts is never shown sitting in their place', () => {
  const roster = [player('Locked Low', ['PG'], 5, { locks: [{ date: '2026-10-20', slot: 'Util' }] }), player('High Min', ['PG'], 30)];
  const slots = [{ slot: 'Util', count: 1 }], schedule = days('2026-10-20');
  const c = run(roster, slots, schedule);
  assert.deepEqual(c.days[0].starts, [{ name: 'Locked Low', slot: 'Util' }]);
  assert.deepEqual(c.days[0].sits, [{ name: 'High Min', reason: 'no open slot' }]);
  const team = projectTeam(roster, {}, {}, settings(slots), schedule, '2026-10-20', '2026-10-26');
  assert.deepEqual(team.started.map((s) => s.name), ['Locked Low']);
});
