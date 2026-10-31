import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBoxScore, parseScoreboard } from '../src/sources/espn-boxscore.mjs';

const summary = JSON.parse(await readFile(new URL('./fixtures/espn/summary-401810433.json', import.meta.url)));
const map = (x) => ({ GS:'GSW', SA:'SAS', NY:'NYK', NO:'NOP', UTAH:'UTA', WSH:'WAS' }[x] ?? x);
test('scoreboard parses final events', async () => {
  const b = JSON.parse(await readFile(new URL('./fixtures/espn/scoreboard-20260115.json', import.meta.url)));
  assert.deepEqual(parseScoreboard(b)[0], { espnEventId: '401810433', status: 'STATUS_FINAL' });
});
test('box score makes and attempts, retains DNP, and follows labels', () => {
  const rows = parseBoxScore(summary, { date:'2026-01-15', standardCode:map });
  assert.equal(rows.length, 10); assert.deepEqual([rows[0].fgm, rows[0].fga, rows[0].ftm, rows[0].fta], [12,22,3,3]);
  assert.equal(rows.filter((r) => r.didNotPlay).length, 2);
  assert.ok(rows.every((r) => 'starter' in r && 'reason' in r));
  const copy = structuredClone(summary); const group = copy.boxscore.players[0].statistics[0];
  const order = [3,1,0,4,2,5,6,7,8,9,10,11,12,13]; group.labels = order.map((i) => group.labels[i]);
  for (const athlete of group.athletes) if (!athlete.didNotPlay) athlete.stats = order.map((i) => athlete.stats[i]);
  assert.equal(parseBoxScore(copy, { date:'2026-01-15', standardCode:map })[0].fgm, 12);
  const broken = structuredClone(summary); broken.boxscore.players[0].statistics[0].labels = ['MIN'];
  assert.throws(() => parseBoxScore(broken, { date:'x', standardCode:map }), /401810433.*missing label PTS/);
});

test('DNP reasons and starter flags are preserved without invented production', () => {
  const athlete = (id, reason) => ({ athlete: { id, displayName: `Synthetic ${id}` }, starter: false, didNotPlay: true, reason, stats: [] });
  const copy = structuredClone(summary);
  copy.boxscore.players = [copy.boxscore.players[0]];
  copy.boxscore.players[0].statistics[0].athletes = [athlete('coach', "COACH'S DECISION"), athlete('injury', 'RIGHT CALF'), athlete('rest', 'REST')];
  const rows = parseBoxScore(copy, { date: '2026-01-15', standardCode: map });
  assert.equal(rows[0].min, 0);
  assert.equal(rows[1].min, null);
  assert.equal(rows[2].min, null);
  assert.equal(rows[0].reason, "COACH'S DECISION");
  assert.equal(rows[0].starter, false);
  assert.ok(rows.every((r) => r.pts === undefined));
});

test('usage context requires complete player totals and uses reported team turnovers', () => {
  const copy = structuredClone(summary);
  copy.boxscore.players = [copy.boxscore.players[0]];
  const group = copy.boxscore.players[0].statistics[0];
  group.athletes = [{ athlete: { id: 'example', displayName: 'Sample Starter' }, starter: true, didNotPlay: false,
    stats: group.labels.map((label) => ({ MIN: '48', PTS: '20', FG: '8-15', '3PT': '2-4', FT: '2-3', REB: '5', AST: '4', TO: '2', STL: '1', BLK: '1' })[label] ?? '0') }];
  group.totals = [...group.athletes[0].stats];
  copy.boxscore.teams = [{ team: copy.boxscore.players[0].team, statistics: [{ name: 'totalTurnovers', displayValue: '3' }] }];
  assert.deepEqual(parseBoxScore(copy, { date: '2026-01-15', standardCode: map })[0].teamContext, { minutes: 48, fga: 15, fta: 3, to: 3 });
  group.totals[group.labels.indexOf('FG')] = '9-17';
  assert.equal(parseBoxScore(copy, { date: '2026-01-15', standardCode: map })[0].teamContext, null);
});

for (const placeholder of ['--', '-']) test(`placeholder ${placeholder} minutes with a DNP reason and zero stats normalize inconsistent ESPN flags`, () => {
  const copy = structuredClone(summary);
  copy.boxscore.players = [copy.boxscore.players[0]];
  const group = copy.boxscore.players[0].statistics[0];
  const player = { athlete: { id: 'example', displayName: 'Sample Reserve' }, starter: false,
    didNotPlay: false, reason: "COACH'S DECISION",
    stats: group.labels.map((label) => label === 'MIN' ? placeholder : ['FG', '3PT', 'FT'].includes(label) ? '0-0' : '0') };
  group.athletes.push(player);
  const rows = parseBoxScore(copy, { date: '2026-01-15', standardCode: map });
  assert.equal(rows.at(-1).didNotPlay, true);
  assert.equal(rows.at(-1).min, 0);
  assert.equal(rows.at(-1).pts, undefined);
  assert.deepEqual(rows[0].teamContext, parseBoxScore(summary, { date: '2026-01-15', standardCode: map })[0].teamContext);
  player.reason = 'RIGHT CALF';
  assert.equal(parseBoxScore(copy, { date: '2026-01-15', standardCode: map }).at(-1).min, null);
  player.reason = '';
  assert.throws(() => parseBoxScore(copy, { date: '2026-01-15', standardCode: map }), /invalid minutes/);
  player.reason = "COACH'S DECISION";
  player.stats[group.labels.indexOf('PTS')] = '2';
  assert.throws(() => parseBoxScore(copy, { date: '2026-01-15', standardCode: map }), /invalid minutes/);
});

test('an active coach\'s-decision row with placeholder minutes and stats is a 0-minute appearance', () => {
  const copy = structuredClone(summary);
  copy.boxscore.players = [copy.boxscore.players[0]];
  const group = copy.boxscore.players[0].statistics[0];
  const player = { athlete: { id: 'example', displayName: 'Sample Reserve' }, starter: false, active: true,
    didNotPlay: false, reason: "COACH'S DECISION",
    stats: group.labels.map((label) => ({ MIN: '-', AST: '1', '+/-': '+2' })[label] ?? (['FG', '3PT', 'FT'].includes(label) ? '0-0' : '0')) };
  const starter = { athlete: { id: 'starter', displayName: 'Sample Starter' }, starter: true, didNotPlay: false,
    stats: group.labels.map((label) => ({ MIN: '48', PTS: '20', FG: '8-15', '3PT': '2-4', FT: '2-3', REB: '5', AST: '4', TO: '2', STL: '1', BLK: '1' })[label] ?? '0') };
  group.athletes = [starter, player];
  group.totals = [...starter.stats];
  const parse = () => parseBoxScore(copy, { date: '2026-01-15', standardCode: map });
  const row = parse().at(-1);
  assert.equal(row.didNotPlay, false);
  assert.equal(row.min, 0);
  assert.equal(row.ast, 1);
  assert.equal(row.teamContext.minutes, 48);
  player.reason = 'RIGHT CALF';
  assert.throws(parse, /invalid minutes/);
  player.reason = "COACH'S DECISION";
  player.active = false;
  assert.throws(parse, /invalid minutes/);
  player.active = true;
  player.stats[group.labels.indexOf('MIN')] = '';
  assert.throws(parse, /invalid minutes/);
});
