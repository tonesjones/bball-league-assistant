import { seasonValues } from './season-value.mjs';
import { findPlayer } from './names.mjs';
import { easternDate } from './weeks.mjs';

const DEFAULTS = { minJump: 8, minMinutes: 24, minPriorGames: 3, limit: 15 };
const COUNTING = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'to', 'fgm', 'fga', 'ftm', 'fta'];
const RECENT = 3;

const complete = (row) => Number.isFinite(row.min) && COUNTING.every((k) => Number.isFinite(row[k]));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const byDate = (a, b) => a.date.localeCompare(b.date) || String(a.espnEventId).localeCompare(String(b.espnEventId));
const average = (rows) => ({ g: rows.length, ...Object.fromEntries(COUNTING.map((k) => [k, mean(rows.map((r) => r[k]))])) });

// Players whose role grew on `date`: a minutes jump or a new starting spot. Information only: the
// result pairs no drop and feeds nothing into the planner. Rows after `date` are ignored, so a past
// night gives the answer it gave on the night.
export function roleChanges({ logs, date, exclude = new Set(), available = new Set(), options = {} }) {
  const { minJump, minMinutes, minPriorGames, limit } = { ...DEFAULTS, ...options };
  const played = new Map();
  for (const row of logs) {
    if (row.didNotPlay || row.date > date) continue;
    const id = String(row.espnId);
    if (!played.has(id)) played.set(id, []);
    played.get(id).push(row);
  }
  for (const rows of played.values()) rows.sort(byDate);

  const pool = [], candidates = [];
  for (const [id, rows] of [...played].sort(([a], [b]) => a.localeCompare(b))) {
    if (rows.length < 3 || !rows.every(complete)) continue;
    pool.push({ name: `season:${id}`, perGame: average(rows) });
    const last = rows[rows.length - 1];
    const earlier = rows.filter((r) => r.date < date);
    if (last.date !== date || exclude.has(id) || earlier.length < minPriorGames) continue;
    const recent = rows.slice(-RECENT);
    const earlierMpg = mean(earlier.map((r) => r.min));
    const jump = last.min - earlierMpg;
    const recentStarts = recent.filter((r) => r.starter === true).length;
    const earlierStarts = earlier.filter((r) => !recent.includes(r) && r.starter === true).length;
    const flags = [];
    if (jump >= minJump && last.min >= minMinutes) flags.push('minutes');
    if (recentStarts >= 2 && earlierStarts <= 1) flags.push('starter');
    if (!flags.length) continue;
    candidates.push({ id, last, flags, earlierMpg, jump, recentStarts, recentGames: recent.length, earlierStarts });
  }
  if (!candidates.length) return [];

  const games = candidates.map((c) => ({ name: `game:${c.id}`, perGame: average([c.last]) }));
  const values = seasonValues([...pool, ...games], { poolSize: pool.length, poolFilter: (p) => p.name.startsWith('season:') });
  return candidates.map((c) => ({
    espnId: c.id, name: c.last.name, team: c.last.team, flags: c.flags,
    earlierMpg: c.earlierMpg, minutes: c.last.min, jump: c.jump,
    recentStarts: c.recentStarts, recentGames: c.recentGames, earlierStarts: c.earlierStarts,
    box: Object.fromEntries(['min', ...COUNTING].map((k) => [k, c.last[k]])),
    gameZ: values.get(`game:${c.id}`).perGameZ, seasonZ: values.get(`season:${c.id}`).perGameZ,
    availability: available.has(c.id) ? 'confirmed' : 'unconfirmed',
  })).sort((a, b) => b.gameZ - a.gameZ || b.jump - a.jump || Number(a.espnId) - Number(b.espnId)).slice(0, limit);
}

// The watch list needs every league roster, or an owned player could be listed as available.
export function roleChangeReport({ snapshot, ids, logs, options = {} }) {
  const skipped = (reason) => ({ status: 'skipped', reason });
  const teams = snapshot.league?.teams;
  if (!Array.isArray(teams)) return skipped('no league rosters in this capture');
  const size = Number(snapshot.settings?.raw?.['Max Teams']);
  if (!Number.isInteger(size) || size < 2) return skipped('league size unknown (no Max Teams setting)');
  if (teams.length !== size - 1) return skipped(`${size - 1} team rosters expected, ${teams.length} found`);
  const seen = new Set();
  for (const t of teams) {
    if (!Number.isInteger(t.teamNumber) || t.teamNumber < 1 || t.teamNumber > size) return skipped(`team number ${t.teamNumber} is outside 1 to ${size}`);
    if (seen.has(t.teamNumber)) return skipped(`team ${t.teamNumber} appears twice`);
    seen.add(t.teamNumber);
  }
  const empty = teams.find((t) => !t.roster?.length);
  if (empty) return skipped(`team ${empty.teamNumber} roster is empty`);
  const idOf = (p) => {
    const id = findPlayer(ids.players, p.name, p.nbaTeam).player?.espnId;
    return id == null ? null : String(id);
  };
  const owned = [...snapshot.team.roster, ...(snapshot.matchup.opponentRoster ?? []), ...teams.flatMap((t) => t.roster)];
  const matched = owned.map((p) => ({ p, id: idOf(p) }));
  const unmatched = matched.filter((m) => !m.id);
  if (unmatched.length) return skipped(`unmatched rostered players: ${unmatched.map((m) => `${m.p.name} (${m.p.nbaTeam})`).join(', ')}`);
  const today = easternDate(snapshot.asOf);
  const date = logs.filter((r) => !r.didNotPlay && r.date <= today).map((r) => r.date).sort().pop();
  if (!date) return skipped('no played games in the game logs');
  // With every roster in hand, anyone not on one is available (possibly on waivers).
  const exclude = new Set(matched.map((m) => m.id));
  const available = new Set(logs.map((r) => String(r.espnId)).filter((id) => !exclude.has(id)));
  const players = roleChanges({ logs, date, exclude, available, options });
  return { status: 'ok', date, players };
}
