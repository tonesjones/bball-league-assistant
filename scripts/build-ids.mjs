import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE, getJson, standardCode } from '../src/sources/espn.mjs';
import { parseTeams, parseRoster } from '../src/sources/espn-parse.mjs';
import { findPlayer } from '../src/engine/names.mjs';

const teams = parseTeams(await getJson(`${BASE}/teams`, { cacheFile: join('local', 'cache', 'espn', 'teams.json') }));
const priorPlayers = JSON.parse(await readFile('data/priors/players.json', 'utf8'));
const rosters = [];
for (const team of teams) rosters.push(...parseRoster(await getJson(`${BASE}/teams/${team.espnId}/roster`, { cacheFile: join('local', 'cache', 'espn', `roster-${team.espnId}.json`) }), team.code));
const priors = priorPlayers.map((p) => ({ ...p, team: p.team && standardCode(p.team) }));
const players = rosters.map((p) => ({ ...p, priorName: findPlayer(priors, p.name, p.team).player?.name ?? null }));
const unmatched = priors.flatMap((prior) => {
  const { reason } = findPlayer(rosters, prior.name, prior.team);
  return reason ? [{ name: prior.name, team: prior.team, reason }] : [];
});
await mkdir('data', { recursive: true });
await mkdir(join('local', 'reports'), { recursive: true });
await writeFile('data/ids.json', JSON.stringify({ fetchedAt: new Date().toISOString(), players }, null, 2));
await writeFile(join('local', 'reports', 'ids-unmatched.json'), JSON.stringify(unmatched, null, 2));
console.log(`Matched ${priorPlayers.length - unmatched.length}/${priorPlayers.length} priors; ${players.length} rostered ESPN players.`);
