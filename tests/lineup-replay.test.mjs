import test from 'node:test';
import assert from 'node:assert/strict';
import { realizedGain, summarize, flips } from '../src/engine/bakeoff.mjs';
import { zeroLine } from '../src/engine/lineup-replay.mjs';

const start = (id, date = '2026-10-21') => ({ espnId: id, name: id, date, slot: 'Util' });
const row = (id, pts, more = {}) => ({ ...zeroLine(), espnId: id, date: '2026-10-21',
  espnEventId: 'one', didNotPlay: false, pts, ...more });
const entry = () => ({ source: 'tool', decision: 'move', start: '2026-10-21', rating: null,
  add: { espnId: 'pickup' }, drop: { espnId: 'drop' },
  lineups: { from: '2026-10-20', through: '2026-10-21', baseline: [start('starter')],
    proposed: [start('pickup')], opponent: [start('opponent')], banked: { mine: zeroLine(), opponent: zeroLine() } } });
const logs = () => [row('starter', 20), row('pickup', 25), row('drop', 100), row('opponent', 22)];
const score = (e = entry(), rows = logs()) => realizedGain(e, rows, { to: '2026-10-21' });

test('a benched pickup contributes nothing; unrelated dropped bench production also contributes nothing', () => {
  const e = entry(); e.lineups.proposed = e.lineups.baseline;
  const r = score(e);
  assert.equal(r.status, 'scored');
  assert.equal(r.gain.PTS, 0);
  assert.deepEqual(r.gamesPlayed, { add: 0, drop: 0 });
});

test('saved starts subtract a displaced starter and replay opponent categories', () => {
  const r = score();
  assert.equal(r.gain.PTS, 5);
  assert.deepEqual(flips(r.gain, r.finalTotals, r.finalVolume), { helped: ['PTS'], hurt: [] });
  assert.equal(r.replayed.baseline.pts, 20);
  assert.equal(r.replayed.proposed.pts, 25);
});

test('effective date excludes earlier games from the delta and later games from the window', () => {
  const e = entry();
  e.lineups.baseline.unshift(start('drop', '2026-10-20'));
  e.lineups.proposed.unshift(start('drop', '2026-10-20'));
  const r = score(e, [...logs(), row('drop', 100, { date: '2026-10-20' }), row('pickup', 1000, { date: '2026-10-22' })]);
  assert.equal(r.gain.PTS, 5);
  assert.equal(r.finalTotals.mine.PTS, 120);
});

test('a complete hold is zero, but absent results are unscored even for hold', () => {
  const e = entry(); e.decision = 'hold'; e.add = null; e.drop = null;
  assert.equal(score(e).gain.PTS, 0);
  assert.deepEqual(score(e).gamesPlayed, { add: 0, drop: 0 });
  assert.equal(score(e, []).status, 'unscored');
});

test('missing results, volume, IDs, duplicate rows and unfinished windows are unscored', () => {
  for (const mutate of [
    (e, rows) => rows.splice(0, 1),
    (e, rows) => { delete rows[0].fga; },
    (e) => { e.lineups.baseline[0].espnId = null; },
    (e, rows) => rows.push(rows[0]),
    (e) => { e.lineups.banked.mine.fga = null; },
    (e) => { e.lineups.through = '2026-10-22'; },
  ]) {
    const e = entry(), rows = logs(); mutate(e, rows);
    const r = score(e, rows);
    assert.equal(r.status, 'unscored'); assert.equal(r.gain, null); assert.ok(r.reasons.length);
  }
  assert.equal(score({ ...entry(), lineups: null }).status, 'unscored');
});

test('only an explicit DNP counts as zero; percentage gains retain makes and attempts and TO sign', () => {
  const r = score(entry(), [row('starter', 0, { didNotPlay: true }),
    row('pickup', 10, { fgm: 4, fga: 8, ftm: 2, fta: 3, to: 2 }), row('opponent', 20)]);
  assert.equal(r.status, 'scored'); assert.equal(r.gain.TO, -2);
  assert.deepEqual(r.gain['FG%'], { makes: 4, attempts: 8 });
  assert.deepEqual(r.gain['FT%'], { makes: 2, attempts: 3 });
});

test('unscored decisions do not become zero gains in source means', () => {
  const e = entry();
  const [summary] = summarize([{ entry: e, ...score(e) }, { entry: e, ...score(e, []) }]);
  assert.equal(summary.scored, 1); assert.equal(summary.unscored, 1);
  assert.equal(summary.meanGain.PTS, 5);
  assert.equal(summarize([{ entry: e, ...score(e, []) }])[0].meanGain, null);
});

test('an add-only move gains the pickup production with no drop', () => {
  const e = entry(); e.drop = null; e.lineups.proposed = [start('starter'), start('pickup')];
  const r = score(e);
  assert.equal(r.gain.PTS, 25);
  assert.deepEqual(r.gamesPlayed, { add: 1, drop: 0 });
});
