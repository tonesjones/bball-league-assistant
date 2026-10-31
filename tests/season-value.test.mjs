import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonValues } from '../src/engine/season-value.mjs';

const player = (name, overrides = {}) => ({ name, perGame: { g: 70, pts: 10, reb: 4, ast: 3,
  stl: 1, blk: 1, fg3m: 1, to: 2, fgm: 5, fga: 10, ftm: 4, fta: 5, ...overrides } });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('better counting stats rank higher and more turnovers lower value', () => {
  const values = seasonValues([player('Aster'), player('Bramble', { pts: 20, reb: 8, ast: 6, stl: 2, blk: 2, fg3m: 2 }),
    player('Clover', { to: 4 })]);
  assert.ok(values.get('Bramble').rank < values.get('Aster').rank);
  assert.ok(values.get('Aster').value > values.get('Clover').value);
  assert.ok(values.get('Clover').z.TO < 0);
  near(values.get('Bramble').z.PTS, Math.sqrt(2));
  assert.equal(values.get('Aster').z['FT%'], 0);
});

test('FG and FT impact use volume and pool attempt-weighted percentages', () => {
  const values = seasonValues([
    player('Dapple', { fgm: 8, fga: 30, ftm: 2, fta: 10 }),
    player('Ember', { fgm: 3, fga: 5, ftm: 4, fta: 5 }),
    player('Fable', { fgm: 12, fga: 20, ftm: 16, fta: 20 }),
  ]);
  assert.ok(values.get('Dapple').z['FG%'] < 0);
  assert.ok(values.get('Ember').z['FG%'] > 0);
  assert.ok(values.get('Fable').z['FG%'] > values.get('Ember').z['FG%']);
  assert.ok(values.get('Fable').z['FT%'] > values.get('Ember').z['FT%']);
  const impacts = [8, 3, 12].map((makes, i) => {
    const attempts = [30, 5, 20][i];
    return makes - attempts * 23 / 55;
  });
  const mean = impacts.reduce((a, b) => a + b, 0) / 3;
  const sd = Math.sqrt(impacts.reduce((a, b) => a + (b - mean) ** 2, 0) / 3);
  near(values.get('Fable').z['FG%'], (impacts[2] - mean) / sd);
});

test('availability scales positive values and leaves negative values unchanged', () => {
  const priors = [player('Glimmer', { pts: 30 }), player('Hollow', { pts: 30, g: 35 }),
    player('Indigo', { pts: 1 }), player('Juniper', { pts: 1, g: 10 })];
  const values = seasonValues(priors);
  assert.ok(values.get('Glimmer').value > 0);
  near(values.get('Hollow').value, values.get('Glimmer').value / 2);
  assert.ok(values.get('Indigo').value < 0);
  assert.equal(values.get('Juniper').value, values.get('Indigo').value);
  assert.equal(values.get('Hollow').games, 35);
  near(seasonValues(priors, { fullSeasonGames: 35 }).get('Hollow').value, values.get('Glimmer').value);
});

test('second pass uses only the top poolSize players and scores everyone', () => {
  const priors = [player('Kestrel', { pts: 40 }), player('Lantern', { pts: 20 }), player('Mallow', { pts: 0 })];
  const all = seasonValues(priors), top = seasonValues(priors, { poolSize: 2 });
  assert.equal(top.size, 3);
  assert.notEqual(all.get('Kestrel').perGameZ, top.get('Kestrel').perGameZ);
  near(top.get('Kestrel').z.PTS, 1);
  near(top.get('Lantern').z.PTS, -1);
  near(top.get('Mallow').z.PTS, -3);
  assert.deepEqual(seasonValues(priors, { poolSize: 100 }), all);
});

test('skips absent and zero-game lines; stable ties have contiguous ranks and deterministic output', () => {
  const priors = [player('Willow'), player('Orchid'), { name: 'Absent', perGame: null }, player('Zero', { g: 0 }),
    player('Negative', { g: -1 })];
  const before = structuredClone(priors);
  const values = seasonValues(priors);
  assert.deepEqual([...values.keys()], ['Orchid', 'Willow']);
  assert.deepEqual([...values.values()].map((p) => p.rank), [1, 2]);
  assert.ok([...values.values()].every((p) => p.value === 0 && Object.values(p.z).every((z) => z === 0)));
  assert.deepEqual(seasonValues(priors), values);
  assert.deepEqual(priors, before);
  assert.deepEqual(seasonValues([]), new Map());
});

test('season-only players scale by g/70, stay out of the pool and leave other values unchanged', () => {
  const priors = [player('Aster'), player('Bramble', { pts: 20, reb: 8 }), player('Clover', { to: 4 })];
  const rookie = { ...player('espn:9', { pts: 30, g: 7 }), source: 'season-only' };
  const poolFilter = (p) => p.source !== 'season-only';
  const before = seasonValues(priors, { poolFilter });
  const after = seasonValues([...priors, rookie], { poolFilter });
  for (const p of priors) near(after.get(p.name).value, before.get(p.name).value);
  const unscaled = seasonValues([...priors, { ...rookie, perGame: { ...rookie.perGame, g: 70 } }], { poolFilter });
  near(after.get('espn:9').value, unscaled.get('espn:9').value / 10);
  assert.ok(after.get('espn:9').perGameZ > 0);
  assert.notEqual(seasonValues([...priors, rookie]).get('Aster').value, before.get('Aster').value);
});
