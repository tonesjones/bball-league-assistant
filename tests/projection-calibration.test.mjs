import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWeights } from '../src/engine/projection-calibration.mjs';
import { parseHistoricalLogs } from '../src/sources/espn-history.mjs';

const stats = { pts: 10, reb: 5, ast: 3, stl: 1, blk: 1, to: 2, fg3m: 1, fgm: 4, fga: 10, ftm: 1, fta: 2 };
const prior = { id: '1', name: 'Synthetic Player', mpg: 20, perGame: { g: 60, ...stats } };
const row = (date, i, factor = 1) => ({ espnId: '1', espnEventId: String(i), date, min: 20,
  starter: null, didNotPlay: false, ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v * factor])),
  fga: 10, fta: 2 });

test('calibration uses only games before the prediction window for projection inputs', () => {
  const logs = [row('2025-10-22', 1, 2), row('2025-10-27', 2, 1), row('2025-11-10', 3, 100)];
  const before = evaluateWeights([{ prior, logs }], ['2025-10-27'], [2, 8]);
  const after = evaluateWeights([{ prior, logs: [...logs.slice(0, 2), row('2025-11-10', 3, 200)] }], ['2025-10-27'], [2, 8]);
  assert.deepEqual(before, after);
  assert.equal(before.mae['season-average'].PTS, 10);
  assert.equal(before.mae['prior-only'].PTS, 0);
  assert.ok(Math.abs(before.mae[2].PTS - 10 / 3) < 1e-10);
  assert.ok(before.mae[8].PTS < before.mae[2].PTS);
});

test('weekly totals count observed appearances and preserve shooting volume weighting', () => {
  const logs = [row('2025-10-22', 1), row('2025-10-27', 2), row('2025-10-28', 3)];
  logs[1].fgm = 0; logs[1].fga = 1;
  logs[2].fgm = 9; logs[2].fga = 9;
  const scales = Object.fromEntries(['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TO', 'FG%', 'FT%'].map((c) => [c, 1]));
  const r = evaluateWeights([{ prior, logs }], ['2025-10-27'], [2], scales);
  assert.equal(r.mae[2].PTS, 0);
  assert.equal(r.mae[2]['FG%'], 0.5);
  assert.equal(r.counts.PTS, 1);
  const absent = { prior: { ...prior, id: '2', name: 'Absent Player' }, logs: [row('2025-10-22', 4)] };
  assert.deepEqual(evaluateWeights([{ prior, logs }, absent], ['2025-10-27'], [2], scales), r);
});

const historical = () => ({ filters: [{ name: 'season', value: '2026' }],
  names: ['minutes', 'points', 'totalRebounds', 'assists', 'steals', 'blocks', 'turnovers',
    'fieldGoalsMade-fieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'],
  events: { '1': { gameDate: '2025-10-23T01:00:00Z' } },
  seasonTypes: [{ displayName: '2025-26 Regular Season', categories: [{ events: [{ eventId: '1', stats: ['20', '10', '5', '3', '1', '1', '2', '4-10', '1-2', '1-3'] }] }] },
    { displayName: '2025-26 Preseason', categories: [{ events: [{ eventId: 'bad', stats: [] }] }] }] });

test('historical parser checks season, labels, dates, duplicates and shooting pairs; excludes preseason', () => {
  const j = historical(), rows = parseHistoricalLogs(j, prior);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2025-10-22');
  assert.equal(rows[0].fgm, 4); assert.equal(rows[0].fga, 10); assert.equal(rows[0].fg3m, 1);
  const bad = structuredClone(j); bad.filters[0].value = '2027';
  assert.throws(() => parseHistoricalLogs(bad, prior), /season mismatch/);
  const duplicate = structuredClone(j); duplicate.seasonTypes[0].categories[0].events.push(duplicate.seasonTypes[0].categories[0].events[0]);
  assert.throws(() => parseHistoricalLogs(duplicate, prior), /Duplicate/);
  const malformed = structuredClone(j); malformed.seasonTypes[0].categories[0].events[0].stats[7] = '11-10';
  assert.throws(() => parseHistoricalLogs(malformed, prior), /shooting pair/);
  assert.equal(parseHistoricalLogs({ filters: [{ name: 'league', value: 'nba' }] }, prior), null);
  assert.throws(() => parseHistoricalLogs({}, prior), /season mismatch/);
});
