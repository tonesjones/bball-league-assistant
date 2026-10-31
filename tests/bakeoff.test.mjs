import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readEntries, appendEntries } from '../src/sources/bakeoff-log.mjs';
import { realizedGain, flips, validateEntry, summarize, differs, latestEntries } from '../src/engine/bakeoff.mjs';

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
test('a move may omit the drop for an open roster spot but still needs an add', () => {
  const move = entries.find((e) => (e.decision ?? 'move') === 'move');
  assert.equal(validateEntry({ ...move, drop: null }).drop, null);
  assert.throws(() => validateEntry({ ...move, add: null, drop: null }), /add needs name and espnId/);
});

const tony = { ...entries[0], source: 'tony', chatbot: null, rating: null, tag: 'no-effect' };
test('tony entries need a G4 tag and accept the optional fields; chatbot rows stay valid', () => {
  assert.equal(validateEntry({ ...tony, minutes: 3, rescue: true, replaces: true, note: 'why' }).minutes, 3);
  for (const [fields, error] of [[{ tag: undefined }, /tag must be/], [{ tag: 'busy' }, /tag must be/], [{ rating: 4 }, /rating/],
    [{ chatbot: 'Bot A' }, /chatbot/], [{ minutes: '3' }, /minutes/], [{ rescue: 'yes' }, /rescue/], [{ replaces: false }, /replaces/], [{ note: 1 }, /note/]]) {
    assert.throws(() => validateEntry({ ...tony, ...fields }), error);
  }
  assert.throws(() => validateEntry({ ...entries[0], tag: 'no-effect' }), /tag must be omitted/);
  assert.equal(validateEntry(entries[1]).source, 'chatbot');
});

test('differs compares decision, pickup, drop and start; newest entry counts', () => {
  const move = { ...entries[0] };
  assert.equal(differs(move, { ...move }), false);
  assert.equal(differs(move, { ...move, start: '2026-10-22' }), true);
  assert.equal(differs(move, { ...move, drop: null }), true);
  assert.equal(differs(move, { ...move, add: { name: 'Other', espnId: 'Z' } }), true);
  assert.equal(differs(move, { ...move, decision: 'hold', add: null, drop: null }), true);
  assert.equal(differs({ ...move, decision: 'hold', add: null, drop: null }, { ...move, decision: 'hold', add: null, drop: null, start: '2026-10-25' }), false);
  const [kept] = latestEntries([{ decisionId: 'd', source: 'tony', n: 1 }, { decisionId: 'd', source: 'tony', n: 2 }]);
  assert.equal(kept.n, 2);
});

test('the log refuses a second entry for a decision and source unless it replaces', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-log-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'log.jsonl');
  await appendEntries([tony], file);
  await assert.rejects(appendEntries([tony], file), /already recorded/);
  await assert.rejects(appendEntries([tony, { ...tony, source: 'none' }, { ...tony, source: 'none' }], file), /already recorded/);
  assert.equal((await readEntries(file)).length, 1);
  await appendEntries([{ ...tony, replaces: true, tag: 'wasted-time' }], file);
  assert.deepEqual((await readEntries(file)).map((e) => e.tag), ['no-effect', 'wasted-time']);
  assert.equal((await readFile(file, 'utf8')).trim().split(String.fromCharCode(10)).length, 2);
});
