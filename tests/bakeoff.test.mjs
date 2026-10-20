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
  assert.ok(flips(gain, totals, volume).length > 0);
  for (const c of ['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO']) totals.mine[c] = c === 'TO' ? 1 : 999;
  assert.deepEqual(flips(gain, totals, volume), []);
});
test('validates all errors and summarizes sources', () => {
  assert.throws(() => validateEntry({}), /week.*date.*source.*add.*drop.*rating.*asOf/s);
  const results = entries.map((entry) => ({ entry, gain:{'3PM':1,PTS:2,REB:3,AST:4,STL:5,BLK:6,'FG%':{makes:1,attempts:1},'FT%':{makes:0,attempts:0},TO:2}, flips:['PTS'] }));
  const s = summarize(results); assert.equal(s.length, 2); assert.equal(s[0].moves, 1); assert.equal(s[0].meanRating, 4);
  assert.equal(s[1].moves, 2); assert.equal(s[1].meanRating, 4); assert.equal(s[1].categoriesFlipped, 2);
});

test('flips: TO gain lowers turnovers, taken moves are undone, rounded percentages ignored', () => {
  const zero = { '3PM': 0, PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0, 'FG%': { makes: 0, attempts: 0 }, 'FT%': { makes: 0, attempts: 0 }, TO: 0 };
  const side = (to, fg) => ({ '3PM': 10, PTS: 100, REB: 50, AST: 20, STL: 5, BLK: 5, 'FG%': fg, 'FT%': 0.8, TO: to });
  const totals = { mine: side(12, 0.5), opponent: side(11, 0.5) };
  const volume = { mine: { fgm: 50, fga: 100, ftm: 8, fta: 10 }, opponent: { fgm: 499, fga: 1000, ftm: 8, fta: 10 } };
  assert.deepEqual(flips({ ...zero, TO: 2 }, totals, volume), ['TO']);
  assert.deepEqual(flips({ ...zero, TO: -2 }, totals, volume), []);
  assert.deepEqual(flips({ ...zero, TO: -2 }, totals, volume, { taken: true }), ['TO']);
  assert.deepEqual(flips(zero, totals, volume), []);
});
