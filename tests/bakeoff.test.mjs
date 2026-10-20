import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { realizedGain, flips, validateEntry, summarize } from '../src/engine/bakeoff.mjs';

const entries = (await readFile(new URL('./fixtures/bakeoff/log.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
const logs = JSON.parse(await readFile(new URL('./fixtures/bakeoff/gamelogs.json', import.meta.url)));
test('gain counts categories, TO sign, percentage volume, and GP', () => {
  const r = realizedGain(entries[0], logs, { from:'2026-10-20', to:'2026-10-21' });
  assert.equal(r.gain.PTS, 12); assert.equal(r.gain.TO, 2); assert.deepEqual(r.gain['FG%'], { makes:5, attempts:0 });
  assert.equal(r.gamesPlayed.add, 2);
});
test('flips detects change and leaves distant result alone', () => {
  const gain = realizedGain(entries[0], logs, { from:'2026-10-20', to:'2026-10-21' }).gain;
  const totals = { mine:{'FG%':0.5,'FT%':0.75,'3PM':10,PTS:20,REB:10,AST:10,STL:3,BLK:2,TO:8}, opponent:{'FG%':0.49,'FT%':0.70,'3PM':0,PTS:25,REB:0,AST:0,STL:0,BLK:0,TO:20} };
  const volume = { mine:{fgm:10,fga:20,ftm:6,fta:8}, opponent:{fgm:0,fga:1,ftm:0,fta:1} };
  assert.deepEqual(flips(gain, totals, volume), { helped: ['PTS'], hurt: [] });
  for (const c of ['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO']) totals.mine[c] = c === 'TO' ? 1 : 999;
  assert.deepEqual(flips(gain, totals, volume), { helped: [], hurt: [] });
});
test('validates all errors and summarizes sources', () => {
  assert.throws(() => validateEntry({}), /week.*date.*source.*add.*drop.*rating.*asOf/s);
  const results = entries.map((entry) => ({ entry, gain:{'3PM':1,PTS:2,REB:3,AST:4,STL:5,BLK:6,'FG%':{makes:1,attempts:1},'FT%':{makes:0,attempts:0},TO:2}, flips:{ helped:['PTS'], hurt:['AST'] } }));
  const s = summarize(results); assert.equal(s.length, 2); assert.equal(s[0].moves, 1); assert.equal(s[0].meanRating, 4);
  assert.equal(s[1].moves, 2); assert.equal(s[1].meanRating, 4);
  assert.equal(s[1].helped, 2); assert.equal(s[1].hurt, 2); assert.equal(s[1].net, 0);
  assert.deepEqual(s[1].meanGain, results[0].gain);
});

test('flips: TO gain lowers turnovers, taken moves are undone, rounded percentages ignored', () => {
  const zero = { '3PM': 0, PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0, 'FG%': { makes: 0, attempts: 0 }, 'FT%': { makes: 0, attempts: 0 }, TO: 0 };
  const side = (to, fg) => ({ '3PM': 10, PTS: 100, REB: 50, AST: 20, STL: 5, BLK: 5, 'FG%': fg, 'FT%': 0.8, TO: to });
  const totals = { mine: side(12, 0.5), opponent: side(11, 0.5) };
  const volume = { mine: { fgm: 50, fga: 100, ftm: 8, fta: 10 }, opponent: { fgm: 499, fga: 1000, ftm: 8, fta: 10 } };
  assert.deepEqual(flips({ ...zero, TO: 2 }, totals, volume), { helped: ['TO'], hurt: [] });
  assert.deepEqual(flips({ ...zero, TO: -2 }, totals, volume), { helped: [], hurt: [] });
  assert.deepEqual(flips({ ...zero, TO: -2 }, totals, volume, { taken: true }), { helped: [], hurt: ['TO'] });
  assert.deepEqual(flips({ ...zero, TO: 2 }, { ...totals, mine: side(10, 0.5) }, volume, { taken: true }), { helped: ['TO'], hurt: [] });
  assert.deepEqual(flips(zero, totals, volume), { helped: [], hurt: [] });
});

const zero = { '3PM': 0, PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0, 'FG%': { makes: 0, attempts: 0 }, 'FT%': { makes: 0, attempts: 0 }, TO: 0 };

test('harmful flips distinguish win, tie and loss for counting and percentage categories', () => {
  const totals = { mine: { PTS: 10, TO: 5, 'FG%': 0.5, 'FT%': 0.8 }, opponent: { PTS: 9, TO: 6, 'FG%': 0.49, 'FT%': 0.7 } };
  const volume = { mine: { fgm: 5, fga: 10, ftm: 8, fta: 10 }, opponent: { fgm: 49, fga: 100, ftm: 7, fta: 10 } };
  const gain = { ...zero, PTS: -1, TO: -2, 'FG%': { makes: 0, attempts: 2 }, 'FT%': { makes: -2, attempts: 0 } };
  assert.deepEqual(flips(gain, totals, volume), { helped: [], hurt: ['FG%', 'FT%', 'PTS', 'TO'] });
  assert.deepEqual(flips(gain, totals, volume, { taken: true }), { helped: [], hurt: [] });
  assert.deepEqual(flips({ ...zero, PTS: 1 }, { mine: { PTS: 9 }, opponent: { PTS: 10 } }, {}), { helped: ['PTS'], hurt: [] });
});

test('a hold scores zero gain, games and flips', () => {
  const entry = validateEntry({ ...entries[0], source: 'none', decision: 'hold', add: null, drop: null });
  const result = realizedGain(entry, logs, { from: '2026-10-20', to: '2026-10-21' });
  assert.deepEqual(result, { gain: zero, gamesPlayed: { add: 0, drop: 0 } });
  const totals = { mine: { ...zero, 'FG%': 0.5, 'FT%': 0.8 }, opponent: { ...zero, 'FG%': 0.4, 'FT%': 0.7 } };
  const volume = { mine: { fgm: 5, fga: 10, ftm: 8, fta: 10 }, opponent: { fgm: 4, fga: 10, ftm: 7, fta: 10 } };
  for (const taken of [false, true]) assert.deepEqual(flips(result.gain, totals, volume, { ...entry, taken }), { helped: [], hurt: [] });
});

test('mid-week start excludes earlier games for both players and respects window end', () => {
  const entry = validateEntry({ ...entries[0], decision: 'move', start: '2026-10-21' });
  const result = realizedGain(entry, logs, { from: '2026-10-20', to: '2026-10-21' });
  assert.deepEqual(result, { gain: { ...zero, PTS: 4, REB: -2, STL: -1, '3PM': 1, TO: 1, 'FG%': { makes: 2, attempts: 0 }, 'FT%': { makes: -1, attempts: 0 } }, gamesPlayed: { add: 1, drop: 1 } });
  assert.deepEqual(realizedGain(entry, logs, { to: '2026-10-20' }), { gain: zero, gamesPlayed: { add: 0, drop: 0 } });
});

test('legacy entries default to a move starting on date and still score', () => {
  const { decision, start, ...old } = entries[0];
  const entry = validateEntry(old);
  assert.equal(entry.decision, 'move'); assert.equal(entry.start, old.date);
  const expected = realizedGain(entry, logs, { to: '2026-10-21' });
  assert.equal(expected.gain.PTS, 12);
  assert.deepEqual(realizedGain(old, logs, { from: '2026-10-19', to: '2026-10-21' }), expected);
});

test('validation accepts reasons and notes and rejects invalid new fields', () => {
  for (const rejectReason of ['wrong-role', 'core-player', 'bad-data', 'injury', 'timing', 'other']) {
    assert.equal(validateEntry({ ...entries[0], rejectReason, note: 'Synthetic rejection' }).rejectReason, rejectReason);
  }
  for (const [fields, error] of [
    [{ decision: 'skip' }, /decision/], [{ decision: null }, /decision/], [{ start: null }, /start/],
    [{ start: '2026-02-30' }, /start/], [{ start: 'tomorrow' }, /start/],
    [{ decision: 'hold' }, /add.*drop/s], [{ source: 'none', chatbot: 'Bot A' }, /chatbot/],
    [{ rejectReason: 'unknown' }, /rejectReason/], [{ note: 42 }, /note/],
  ]) assert.throws(() => validateEntry({ ...entries[0], ...fields }), error);
});

test('summary counts holds, rejection reasons and averages each category including holds', () => {
  const move = { entry: { ...entries[0], rejectReason: 'core-player' }, gain: { ...zero, PTS: 12, TO: -2, 'FG%': { makes: 2, attempts: 4 }, 'FT%': { makes: -1, attempts: -2 } }, flips: { helped: ['PTS'], hurt: ['TO', 'FG%'] } };
  const hold = { entry: { ...entries[0], decision: 'hold', add: null, drop: null, rating: null, rejectReason: 'timing' }, gain: zero, flips: { helped: [], hurt: [] } };
  const baseline = { ...hold, entry: { ...hold.entry, source: 'none', rejectReason: undefined } };
  const [tool, none] = summarize([move, hold, baseline]);
  assert.deepEqual(tool, { source: 'tool', moves: 1, holds: 1, helped: 1, hurt: 2, net: -1,
    meanGain: { ...zero, PTS: 6, TO: -1, 'FG%': { makes: 1, attempts: 2 }, 'FT%': { makes: -0.5, attempts: -1 } }, meanRating: 4,
    rejectReasons: { 'wrong-role': 0, 'core-player': 1, 'bad-data': 0, injury: 0, timing: 1, other: 0 } });
  assert.equal(none.source, 'none'); assert.equal(none.moves, 0); assert.equal(none.holds, 1);
  assert.deepEqual(none.meanGain, zero); assert.equal(none.meanRating, null);
  assert.deepEqual(summarize([]), []);
});
