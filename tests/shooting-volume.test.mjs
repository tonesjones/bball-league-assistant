import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateVolume } from '../src/engine/shooting-volume.mjs';

const row = (espnId, overrides = {}) => ({ espnId, date: '2026-10-20', espnEventId: 'fake-event',
  fgm: 2, fga: 4, ftm: 4, fta: 8, fg3m: 0, pts: 8, reb: 3, ast: 2, stl: 1, blk: 0, to: 1, ...overrides });
const totals = { PTS: 8, REB: 3, AST: 2, STL: 1, BLK: 0, TO: 1, '3PM': 0, 'FG%': 0.5, 'FT%': 0.5 };
const input = (logs = [row('1')]) => ({ roster: [{ espnId: '1', slot: 'Util' }, { espnId: '2', slot: 'BN' }],
  totals, logs, from: '2026-10-20', to: '2026-10-20', slots: 1 });
const assumption = 'every open slot filled';
const matched = { status: 'matched', fgm: 2, fga: 4, ftm: 4, fta: 8, unmatched: [], assumption };

test('surplus candidates are resolved by exact counting totals, including BN candidates', () => {
  assert.deepEqual(estimateVolume(input([row('1', { reb: 7 }), row('2')])), matched);
});

test('mismatched totals from a dropped player are unknown', () => {
  const f = input(); f.totals = { ...totals, PTS: 20 };
  assert.deepEqual(estimateVolume(f), { status: 'unknown', reason: 'no combination matches', unmatched: [], assumption });
});

test('matching combinations with different shooting volume are ambiguous', () => {
  const f = input([row('1'), row('2', { fgm: 3, fga: 6, ftm: 2, fta: 4 })]);
  assert.deepEqual(estimateVolume(f), { status: 'unknown', reason: 'ambiguous', unmatched: [], assumption });
});

test('multiple combinations with identical shooting volume remain matched', () => {
  assert.deepEqual(estimateVolume(input([row('1'), row('2')])), matched);
});

test('no relevant logs, including logs outside the date range, are unknown', () => {
  for (const logs of [[], [row('3')], [row('1', { date: '2026-10-19' })], [row('1', { date: '2026-10-21' })]]) {
    assert.deepEqual(estimateVolume(input(logs)), { status: 'unknown', reason: 'no logs', unmatched: [], assumption });
  }
});

test('unmatched players are reported without preventing an exact match, and IL players are skipped', () => {
  const f = input(); f.roster.push({ name: 'Casey Sample', espnId: null, slot: 'BN' });
  assert.deepEqual(estimateVolume(f), { ...matched, unmatched: ['Casey Sample'], assumption });
  f.totals = { ...totals, PTS: 20 };
  assert.deepEqual(estimateVolume(f), { status: 'unknown', reason: 'no combination matches', unmatched: ['Casey Sample'], assumption });
  f.totals = totals;
  for (const slot of ['IL', 'IL+']) {
    f.roster.at(-1).slot = slot;
    assert.deepEqual(estimateVolume(f), matched);
  }
});

test('a week with no banked days matches zero without logs or matched players', () => {
  const f = input([]); f.to = '2026-10-19'; f.roster.push({ name: 'Casey Sample', slot: 'BN' });
  assert.deepEqual(estimateVolume(f), { status: 'matched', fgm: 0, fga: 0, ftm: 0, fta: 0, unmatched: ['Casey Sample'], assumption });
});

test('null or zero counting totals with null percentages match zero even without logs', () => {
  const f = input([]);
  for (const counts of [null, 0, 'mixed']) {
    f.totals = Object.fromEntries(Object.keys(totals).map((c) => [c,
      c.endsWith('%') ? null : counts === 'mixed' ? (c === 'REB' ? 0 : null) : counts]));
    assert.deepEqual(estimateVolume(f), { status: 'matched', fgm: 0, fga: 0, ftm: 0, fta: 0, unmatched: [], assumption });
  }
  for (const c of Object.keys(totals)) {
    assert.equal(estimateVolume({ ...f, totals: { ...f.totals, [c]: 1 } }).status, 'unknown');
  }
});

test('search spans days and compares Yahoo percentages at three decimals', () => {
  const f = input([row('1', { fgm: 1, fga: 3, ftm: 0, fta: 0, pts: 2 }),
    row('2', { date: '2026-10-21', fgm: 2, fga: 6, ftm: 0, fta: 0, pts: 4 })]);
  f.to = '2026-10-21';
  f.totals = { PTS: 6, REB: 6, AST: 4, STL: 2, BLK: 0, TO: 2, '3PM': 0, 'FG%': 0.333, 'FT%': null };
  assert.deepEqual(estimateVolume(f), { status: 'matched', fgm: 3, fga: 9, ftm: 0, fta: 0, unmatched: [], assumption });
  f.totals['FG%'] = 0.334;
  assert.deepEqual(estimateVolume(f), { status: 'unknown', reason: 'no combination matches', unmatched: [], assumption });
});

test('every candidate counts on days below the slot limit', () => {
  const f = input([row('1'), row('2')]); f.slots = 3;
  assert.deepEqual(estimateVolume(f), { status: 'unknown', reason: 'no combination matches', unmatched: [], assumption });
});

test('surplus choices on multiple days are resolved together against the week totals', () => {
  const f = input([row('1'), row('2', { reb: 5 }),
    row('1', { date: '2026-10-21', reb: 7 }), row('2', { date: '2026-10-21', reb: 11 })]);
  f.to = '2026-10-21';
  f.totals = { PTS: 16, REB: 14, AST: 4, STL: 2, BLK: 0, TO: 2, '3PM': 0, 'FG%': 0.5, 'FT%': 0.5 };
  assert.deepEqual(estimateVolume(f), { status: 'matched', fgm: 4, fga: 8, ftm: 8, fta: 16, unmatched: [], assumption });
});

test('every counting total and both displayed percentages must match', () => {
  for (const key of ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', '3PM', 'FG%', 'FT%']) {
    const f = input(); f.totals = { ...totals, [key]: totals[key] + 0.01 };
    assert.deepEqual(estimateVolume(f), { status: 'unknown', reason: 'no combination matches', unmatched: [], assumption });
  }
});

const week = (days) => {
  const f = input(); f.slots = 10;
  f.roster = Array.from({ length: 13 }, (_, i) => ({ espnId: String(i), slot: 'BN' }));
  f.logs = Array.from({ length: days }, (_, d) => f.roster.map((p) =>
    row(p.espnId, { date: `2026-10-${20 + d}` }))).flat();
  f.to = `2026-10-${19 + days}`;
  f.totals = { PTS: 80 * days, REB: 30 * days, AST: 20 * days, STL: 10 * days,
    BLK: 0, TO: 10 * days, '3PM': 0, 'FG%': 0.5, 'FT%': 0.5 };
  return f;
};

test('six-day week with thirteen candidates and ten slots matches using counting-sum pruning', () => {
  const f = week(6);
  for (const line of f.logs) if (Number(line.espnId) >= 10) line.blk = 1;
  assert.deepEqual(estimateVolume(f), { status: 'matched', fgm: 120, fga: 240, ftm: 240, fta: 480,
    unmatched: [], assumption });
});

test('node budget exhaustion returns unknown even after finding matching volume', () => {
  assert.deepEqual(estimateVolume(week(3)), { status: 'unknown', reason: 'search too large', unmatched: [], assumption });
});
