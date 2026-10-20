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
test('box score makes and attempts, skips DNP, and follows labels', () => {
  const rows = parseBoxScore(summary, { date:'2026-01-15', standardCode:map });
  assert.equal(rows.length, 8); assert.deepEqual([rows[0].fgm, rows[0].fga, rows[0].ftm, rows[0].fta], [12,22,3,3]);
  assert.equal(rows.some((r) => r.name === 'Brandon Clarke'), false);
  const copy = structuredClone(summary); const group = copy.boxscore.players[0].statistics[0];
  const order = [3,1,0,4,2,5,6,7,8,9,10,11,12,13]; group.labels = order.map((i) => group.labels[i]); group.athletes[0].stats = order.map((i) => group.athletes[0].stats[i]);
  assert.equal(parseBoxScore(copy, { date:'2026-01-15', standardCode:map })[0].fgm, 12);
  const broken = structuredClone(summary); broken.boxscore.players[0].statistics[0].labels = ['MIN'];
  assert.throws(() => parseBoxScore(broken, { date:'x', standardCode:map }), /401810433.*missing label PTS/);
});
