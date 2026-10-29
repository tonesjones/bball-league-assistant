import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, utimes, rm } from 'node:fs/promises';
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


test('getJson retries an empty or truncated successful response and caches only valid JSON', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'espn-json-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cacheFile = join(dir, 'cache.json');
  let calls = 0;
  const pauses = [];
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { pauses.push(ms); queueMicrotask(fn); return 0; });
  t.mock.method(globalThis, 'fetch', async () => new Response(['', '{"events":', '{"events":[]}'][calls++], { status: 200 }));
  assert.deepEqual(await getJson('https://example.invalid/scoreboard?dates=20261026', { cacheFile }), { events: [] });
  assert.equal(calls, 3);
  assert.ok(pauses.some((ms) => ms >= 2000));
  assert.deepEqual(JSON.parse(await readFile(cacheFile, 'utf8')), { events: [] });
});

test('persistent invalid JSON stops after bounded retries, identifies the URL and preserves the previous cache', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'espn-json-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cacheFile = join(dir, 'cache.json'), previous = '{"previous":true}';
  await writeFile(cacheFile, previous);
  await utimes(cacheFile, new Date(0), new Date(0));
  let calls = 0;
  t.mock.method(globalThis, 'setTimeout', (fn) => { queueMicrotask(fn); return 0; });
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 200 }); });
  await assert.rejects(getJson('https://example.invalid/scoreboard?dates=20261026', { cacheFile, maxAgeHours: 0 }),
    /https:\/\/example\.invalid\/scoreboard\?dates=20261026.*HTTP 200.*4 attempts/);
  assert.equal(calls, 4);
  assert.equal(await readFile(cacheFile, 'utf8'), previous);
});
