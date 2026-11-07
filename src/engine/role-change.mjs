import { seasonValues } from './season-value.mjs';

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
