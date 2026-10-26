import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPlayers, minutesCase } from '../src/engine/projections.mjs';
import { seasonValues } from '../src/engine/season-value.mjs';
import { assignLineup } from '../src/engine/needs.mjs';

const prior = { name: 'Sample Big', mpg: 20, perGame: { g: 70, pts: 10, reb: 6, ast: 1, stl: 1, blk: 1, to: 1, fg3m: 0, fgm: 4, fga: 8, ftm: 2, fta: 3 } };
const ids = { players: [{ espnId: '1', name: 'Sample Big', priorName: 'Sample Big' }] };
const row = (min, fields = {}) => ({ espnId: '1', date: '2026-10-21', espnEventId: 'game-1', min, starter: true, didNotPlay: false, ...fields });
const project = (logs, options) => projectPlayers([prior], ids, logs, options).players[0];

test('one and two games use two pseudo-games and scale every make/attempt and counting rate', () => {
  const p = project([row(30)]);
  assert.equal(p.mpg, 70 / 3);
  assert.equal(p.minutes.games, 1);
  assert.equal(p.minutes.season, 30);
  assert.equal(p.minutes.starts, 1);
  assert.equal(p.perGame.pts, 10 * (70 / 3) / 20);
  assert.equal(p.perGame.fga, 8 * (70 / 3) / 20);
  assert.equal(p.perGame.fgm / p.perGame.fga, 0.5);
  assert.equal(project([row(30), row(34, { espnEventId: 'game-2' })]).mpg, 26);
  assert.equal(project([row(30)], { k: 1 }).mpg, 25);
  assert.throws(() => project([], { k: -1 }), /k/);
});

test('coach DNP counts zero, other reasons and absent players do not count', () => {
  const p = project([row(30), row(0, { espnEventId: 'dnp1', didNotPlay: true, reason: "COACH'S DECISION", starter: false }),
    row(null, { espnEventId: 'dnp2', didNotPlay: true, reason: 'RIGHT CALF', starter: false }),
    row(null, { espnEventId: 'dnp3', didNotPlay: true, reason: 'REST', starter: false }),
    row(40, { espnId: 'other' })]);
  assert.equal(p.minutes.games, 2);
  assert.equal(p.minutes.season, 15);
  assert.equal(p.mpg, 17.5);
  assert.equal(p.minutes.starts, 1);
  assert.equal(project([]).mpg, 20);
  assert.equal(project([]).minutes.season, null);
  assert.throws(() => project([row(undefined)]), /minutes/);
});

test('fixed prior/season cases stay fixed after five games while the blended projection adapts', () => {
  const p = project(Array.from({ length: 5 }, (_, i) => row(30, { espnEventId: `game-${i}` })));
  assert.equal(p.mpg, 190 / 7);
  assert.equal(minutesCase(p, 'prior').mpg, 20);
  assert.equal(minutesCase(p, 'season').mpg, 30);
  assert.equal(minutesCase(p, 'season').perGame.pts, 15);
});

test('increasing minutes changes season value and rank using the same projected lines', () => {
  const rival = { ...structuredClone(prior), name: 'Sample Rival', perGame: { ...prior.perGame, pts: 11, reb: 6.5 } };
  const before = seasonValues([prior, rival]);
  const projected = projectPlayers([prior, rival], ids, [row(40)]).players;
  const after = seasonValues(projected);
  assert.ok(after.get(prior.name).value > before.get(prior.name).value);
  assert.ok(after.get(prior.name).rank < before.get(prior.name).rank);
});

test('logs cannot manufacture category rates for a missing prior', () => {
  const p = projectPlayers([{ name: 'Unknown', mpg: null, perGame: null }], { players: [{ espnId: '1', priorName: 'Unknown' }] }, [row(30)]).players[0];
  assert.equal(p.perGame, null);
  const missingMinutes = projectPlayers([{ ...prior, mpg: null }], ids, [row(30)]).players[0];
  assert.equal(missingMinutes.perGame, null);
});

test('lineup order uses projected minutes from the same player lines as the guardrail', () => {
  const rival = { ...structuredClone(prior), name: 'Sample Rival', mpg: 25 };
  const projected = projectPlayers([prior, rival], ids, [row(40)]).players;
  const roster = projected.map((p) => ({ name: p.name, positions: ['C'], prior: p }));
  assert.equal(assignLineup(roster, [{ slot: 'C', count: 1 }])[0].player.name, prior.name);
});

test('observed rates blend current production into nominal projections with two prior games of minutes', () => {
  const played = (min, fields = {}) => row(min, { ...prior.perGame, ...fields });
  const p = project([played(30, { pts: 30 }), played(10, { pts: 20, espnEventId: 'second' }),
    row(0, { espnEventId: 'coach', didNotPlay: true, reason: "COACH'S DECISION" }),
    row(null, { espnEventId: 'injury', didNotPlay: true, reason: 'REST' })]);
  assert.equal(p.rates.games, 2);
  assert.equal(p.rates.minutes, 40);
  assert.equal(p.rates.status, 'observed');
  assert.equal(p.rates.priorMinutes, 2 * prior.mpg);
  for (const stat of Object.keys(prior.perGame).filter((stat) => stat !== 'g')) {
    const sum = stat === 'pts' ? 50 : 2 * prior.perGame[stat];
    assert.equal(p.rates.observedPerMinute[stat], sum / 40);
    assert.equal(p.rates.perMinute[stat], (2 * prior.perGame[stat] + sum) / (2 * prior.mpg + 40));
  }
  for (const stat of Object.keys(prior.perGame).filter((stat) => stat !== 'g')) {
    assert.equal(p.perGame[stat], p.rates.perMinute[stat] * p.mpg);
  }
  assert.equal(minutesCase(p, 'prior', 'season').perGame.pts, prior.mpg * p.rates.perMinute.pts);
  assert.equal(minutesCase(p, 'season', 'season').perGame.pts, (40 / 3) * p.rates.perMinute.pts);
  const custom = project([played(30, { pts: 30 })], { k: 4 });
  assert.equal(custom.rates.priorMinutes, 4 * prior.mpg);
  assert.equal(custom.rates.perMinute.pts, (4 * prior.perGame.pts + 30) / (4 * prior.mpg + 30));
  const unusable = projectPlayers([{ ...prior, mpg: null }], ids, [played(30)]).players[0];
  assert.equal(unusable.rates.perMinute, null);
  assert.equal(unusable.rates.priorMinutes, null);
  assert.equal(unusable.rates.status, 'observed');
  assert.equal(unusable.rates.games, 1);
  assert.equal(unusable.rates.minutes, 30);
  assert.equal(unusable.rates.observedPerMinute.pts, prior.perGame.pts / 30);
  assert.equal(project([row(30)]).rates.status, 'unavailable');
  assert.equal(project([row(30)]).rates.observedPerMinute, null);
  assert.equal(project([row(30)]).rates.perMinute, null);
  assert.equal(project([]).rates.status, 'no-games');
  assert.equal(project([]).rates.observedPerMinute, null);
  assert.equal(project([]).rates.perMinute, null);
});

test('current production overtakes the prior as minutes accumulate and updates season value', () => {
  const cold = (i) => row(20, { ...Object.fromEntries(Object.keys(prior.perGame).filter((k) => k !== 'g').map((k) => [k, 0])),
    fga: 8, fta: 3, espnEventId: `cold-${i}` });
  const one = project([cold(0)]), five = project(Array.from({ length: 5 }, (_, i) => cold(i)));
  assert.equal(one.perGame.pts, (2 * prior.perGame.pts) / (2 * prior.mpg + 20) * one.mpg);
  assert.equal(five.perGame.pts, (2 * prior.perGame.pts) / (2 * prior.mpg + 100) * five.mpg);
  assert.ok(five.perGame.pts < one.perGame.pts);
  assert.ok(five.perGame.fgm / five.perGame.fga < one.perGame.fgm / one.perGame.fga);
  const rival = { ...structuredClone(prior), name: 'Steady Rival', perGame: { ...prior.perGame, pts: 9 } };
  assert.equal(seasonValues([prior, rival]).get(prior.name).rank, 1);
  assert.equal(seasonValues([five, rival]).get(prior.name).rank, 2);
});
