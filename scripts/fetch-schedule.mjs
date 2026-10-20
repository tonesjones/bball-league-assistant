import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE, getJson, standardCode } from '../src/sources/espn.mjs';
import { parseTeams, parseSchedule } from '../src/sources/espn-parse.mjs';
import { checkPlayoffWeeks } from '../src/engine/schedule-check.mjs';

const cache = (name) => join('local', 'cache', 'espn', name);
const teams = parseTeams(await getJson(`${BASE}/teams`, { cacheFile: cache('teams.json') }));
const games = new Map();
const skipped = [];
for (const team of teams) {
  const result = parseSchedule(await getJson(`${BASE}/teams/${team.espnId}/schedule?season=2027&seasontype=2`, { cacheFile: cache(`schedule-${team.espnId}-2027.json`) }));
  result.games.forEach((game) => games.set(game.espnEventId, game));
  skipped.push(...result.skipped);
}
const sorted = [...games.values()].sort((a, b) => a.date.localeCompare(b.date) || a.espnEventId.localeCompare(b.espnEventId));
await mkdir('data', { recursive: true });
await writeFile('data/schedule-2026-27.json', JSON.stringify({ season: '2026-27', fetchedAt: new Date().toISOString(), games: sorted }, null, 2));
if (skipped.length) console.log('Skipped events:', skipped);
const priorWeeks = JSON.parse(await readFile('data/priors/playoff-weeks.json', 'utf8'));
priorWeeks.teams = Object.fromEntries(Object.entries(priorWeeks.teams).map(([team, counts]) => [standardCode(team), counts]));
const mismatches = checkPlayoffWeeks(sorted, priorWeeks);
console.log('Playoff week mismatches:', mismatches);
