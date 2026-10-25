import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { realizedGain, flips, validateEntry, summarize, scorecard } from '../src/engine/bakeoff.mjs';

const entries = (await readFile(new URL('./fixtures/bakeoff/log.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
const logs = JSON.parse(await readFile(new URL('./fixtures/bakeoff/gamelogs.json', import.meta.url)));
test('flips detects change and leaves distant result alone', () => {
  const gain = { '3PM': 2, PTS: 12, REB: 0, AST: 2, STL: 0, BLK: 1, TO: 2, 'FG%': { makes: 5, attempts: 0 }, 'FT%': { makes: 0, attempts: 0 } };
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

test('chatbot prompt versions are required for records but legacy scoring fills null', () => {
  const bot = { ...entries[1] };
  assert.equal(validateEntry(bot).promptVersion, null);
  assert.throws(() => validateEntry(bot, { allowLegacyPromptVersion: false }), /promptVersion/);
  assert.equal(validateEntry({ ...bot, promptVersion: 1 }, { allowLegacyPromptVersion: false }).promptVersion, 1);
  assert.throws(() => validateEntry({ ...entries[0], promptVersion: 1 }), /promptVersion/);
  assert.throws(() => validateEntry({ ...entries[2], source: 'none', chatbot: null, promptVersion: 1 }), /promptVersion/);
  assert.throws(() => validateEntry({ ...bot, promptVersion: 0 }), /promptVersion/);
});

test('scorecard groups model and prompt versions, pairs scored decisions, gates and rolls deterministically', () => {
  const paired = (version, prompt, id, createdAt, rating, helped, status = 'scored') => ['tool', 'chatbot', 'none'].map((source) => ({
    entry: { ...entries[source === 'chatbot' ? 1 : 0], decisionId: id, source, chatbot: source === 'chatbot' ? 'Example' : null,
      promptVersion: source === 'chatbot' ? prompt : undefined, rating: source === 'tool' ? rating : 3 },
    status, gain: status === 'scored' ? zero : null, flips: status === 'scored' ? { helped: source === 'tool' ? Array(helped).fill('PTS') : [], hurt: [] } : null,
    modelVersion: version, createdAt,
  }));
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push(...paired(2, 1, `new-${i}`, `2026-10-${String(i).padStart(2, '0')}T00:00:00Z`, 5, 2));
  rows.push(...paired(1, 1, 'old', '2026-10-01T00:00:00Z', 1, 0));
  rows.push(...paired(2, 2, 'prompt-2', '2026-10-11T00:00:00Z', 4, 1));
  rows.push(...paired(2, 1, 'unscored', '2026-10-12T00:00:00Z', 5, 0, 'unscored'));
  const cards = scorecard(rows, { lastN: 3 });
  assert.deepEqual(cards.map((c) => [c.modelVersion, c.promptVersion]), [[1, 1], [2, 1], [2, 2]]);
  const v1 = cards[0], v2 = cards[1], p2 = cards[2];
  assert.equal(v1.gate, 'too few');
  assert.equal(v2.paired, 10); assert.equal(v2.gate, 'met');
  assert.equal(v2.rolling[0].scored, 3);
  assert.equal(v2.summaries.find((s) => s.source === 'tool').unscored, 1);
  assert.equal(p2.paired, 1); assert.equal(p2.gate, 'too few');
  assert.deepEqual(scorecard(rows, { lastN: 3 }), cards);
  const tied = rows.map((r) => r.entry.decisionId.startsWith('new-') && r.entry.source === 'chatbot'
    ? { ...r, flips: { helped: ['PTS', 'PTS'], hurt: [] } } : r);
  assert.equal(scorecard(tied).find((c) => c.modelVersion === 2 && c.promptVersion === 1).gate, 'not met');
  const unrated = rows.map((r) => r.entry.source === 'none' ? { ...r, entry: { ...r.entry, rating: null } } : r);
  assert.equal(scorecard(unrated).find((c) => c.modelVersion === 2 && c.promptVersion === 1).gate, 'not met');
  const nine = rows.filter((r) => r.entry.decisionId !== 'new-10');
  assert.equal(scorecard(nine).find((c) => c.modelVersion === 2 && c.promptVersion === 1).paired, 9);
  assert.equal(scorecard(nine).find((c) => c.modelVersion === 2 && c.promptVersion === 1).gate, 'too few');
  assert.deepEqual(scorecard(rows.filter((r) => r.entry.decisionId !== 'old'), { lastN: 3 }), cards.slice(1));
});

test('unversioned records are isolated as rehearsal data', () => {
  const rows = entries.slice(0, 2).map((entry) => ({ entry: { ...entry, promptVersion: undefined }, status: 'scored', gain: zero,
    flips: { helped: [], hurt: [] }, modelVersion: null, createdAt: '2026-10-20T12:00:00Z' }));
  const [card] = scorecard(rows);
  assert.equal(card.gate, 'rehearsal'); assert.equal(card.rehearsal, true);
});

test('summary counts holds, rejection reasons and averages each category including holds', () => {
  const move = { entry: { ...entries[0], rejectReason: 'core-player' }, gain: { ...zero, PTS: 12, TO: -2, 'FG%': { makes: 2, attempts: 4 }, 'FT%': { makes: -1, attempts: -2 } }, flips: { helped: ['PTS'], hurt: ['TO', 'FG%'] } };
  const hold = { entry: { ...entries[0], decision: 'hold', add: null, drop: null, rating: null, rejectReason: 'timing' }, gain: zero, flips: { helped: [], hurt: [] } };
  const baseline = { ...hold, entry: { ...hold.entry, source: 'none', rejectReason: undefined } };
  const [tool, none] = summarize([move, hold, baseline]);
  assert.deepEqual(tool, { source: 'tool', scored: 2, unscored: 0, invalid: 0, moves: 1, holds: 1, helped: 1, hurt: 2, net: -1,
    meanGain: { ...zero, PTS: 6, TO: -1, 'FG%': { makes: 1, attempts: 2 }, 'FT%': { makes: -0.5, attempts: -1 } }, meanRating: 4,
    rejectReasons: { 'wrong-role': 0, 'core-player': 1, 'bad-data': 0, injury: 0, timing: 1, other: 0 } });
  assert.equal(none.source, 'none'); assert.equal(none.moves, 0); assert.equal(none.holds, 1);
  assert.deepEqual(none.meanGain, zero); assert.equal(none.meanRating, null);
  assert.deepEqual(summarize([]), []);
});
