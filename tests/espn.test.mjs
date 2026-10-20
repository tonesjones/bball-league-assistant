import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import teams from './fixtures/espn/teams.json' with { type: 'json' };
import schedule from './fixtures/espn/schedule-gs.json' with { type: 'json' };
import roster from './fixtures/espn/roster-gs.json' with { type: 'json' };
import { parseTeams, parseSchedule, parseRoster } from '../src/sources/espn-parse.mjs';
import { TEAM_CODES } from '../src/sources/espn.mjs';
import { checkPlayoffWeeks } from '../src/engine/schedule-check.mjs';
import { getJson } from '../src/sources/espn.mjs';

test('parses ESPN team codes and roster fixture', () => {
  const parsed = parseTeams(teams);
  assert.equal(parsed.length, 30);
  assert.equal(parsed.find((t) => t.espnId === '9').code, 'GSW');
  assert.deepEqual(TEAM_CODES, { GS: 'GSW', SA: 'SAS', NY: 'NYK', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' });
  assert.equal(parseRoster(roster)[0].name, 'Charles Bassey');
});

test('converts UTC tip to Eastern date across midnight', () => {
  const parsed = parseSchedule(schedule);
  assert.equal(parsed.games[0].date, '2026-10-21');
  assert.equal(parsed.games[0].away, 'GSW');
});

test('checks playoff counts and reports deliberate mismatch', () => {
  const weeks = { weeks: [{ week: 18, start: '2027-03-01', end: '2027-03-07' }], teams: { GSW: [2], BOS: [0] } };
  const games = [{ date: '2027-03-02', home: 'GSW', away: 'BOS' }];
  assert.deepEqual(checkPlayoffWeeks(games, weeks), [{ team: 'GSW', week: 18, expected: 2, actual: 1 }, { team: 'BOS', week: 18, expected: 0, actual: 1 }]);
});

test('getJson returns a fresh cache without fetching', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'espn-cache-'));
  const path = join(dir, 'cache.json');
  await writeFile(path, JSON.stringify({ cached: true }));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network used'); };
  try { assert.deepEqual(await getJson('https://example.invalid', { cacheFile: path }), { cached: true }); }
  finally { globalThis.fetch = oldFetch; await rm(dir, { recursive: true, force: true }); }
});
