import { seasonValues } from './season-value.mjs';
import { findPlayer, normalizeName } from './names.mjs';
import { addDays, easternDate } from './weeks.mjs';

const DEFAULTS = { minJump: 8, minMinutes: 24, minPriorGames: 3, minMissed: 5, maxGamesBack: 3, nights: 3, limit: 15 };
const COUNTING = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'to', 'fgm', 'fga', 'ftm', 'fta'];
const RECENT = 3;

const complete = (row) => Number.isFinite(row.min) && COUNTING.every((k) => Number.isFinite(row[k]));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const byDate = (a, b) => a.date.localeCompare(b.date) || String(a.espnEventId).localeCompare(String(b.espnEventId));
const average = (rows) => ({ g: rows.length, ...Object.fromEntries(COUNTING.map((k) => [k, mean(rows.map((r) => r[k]))])) });

// Per player, through `date`, against his current team's logged games: games missed (no box-score
// row, or a DNP for a reason other than a coach's decision), the length of his latest absence and
// the team games since it. A player new to his team counts the team's earlier games as missed.
export function absences(logs, date) {
  const events = new Map();
  const seen = new Map();
  for (const r of logs) {
    if (r.date > date || !r.team) continue;
    if (!events.has(r.team)) events.set(r.team, new Map());
    events.get(r.team).set(String(r.espnEventId), r.date);
    const id = String(r.espnId);
    if (!seen.has(id)) seen.set(id, []);
    seen.get(id).push(r);
  }
  const out = new Map();
  for (const [id, rows] of seen) {
    rows.sort(byDate);
    const team = rows.at(-1).team;
    const mine = new Map(rows.filter((r) => r.team === team).map((r) => [String(r.espnEventId), r]));
    const games = [...events.get(team)].sort(([ea, da], [eb, db]) => da.localeCompare(db) || ea.localeCompare(eb));
    let missed = 0, latest = 0, back = 0;
    for (const [event] of games) {
      const r = mine.get(event);
      if (!r || (r.didNotPlay && r.reason !== "COACH'S DECISION")) {
        missed++;
        if (back) { latest = 0; back = 0; }
        latest++;
      } else back++;
    }
    out.set(id, { team, teamGames: games.length, missed, latestAbsence: latest, gamesBack: back });
  }
  return out;
}

// Players whose role grew in the `nights` nights through `date`: a minutes jump or a new starting
// spot in their latest game, or a return from an absence of `minMissed` or more team games.
// Information only: the result pairs no drop. Rows after `date` are ignored, so a past night gives
// the answer it gave on the night.
export function roleChanges({ logs, date, exclude = new Set(), excludeNames = new Set(), available = new Set(), options = {} }) {
  const { minJump, minMinutes, minPriorGames, minMissed, maxGamesBack, nights, limit } = { ...DEFAULTS, ...options };
  const from = addDays(date, 1 - nights);
  const away = absences(logs, date);
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
    const earlier = rows.filter((r) => r.date < last.date);
    if (last.date < from || exclude.has(id) || excludeNames.has(normalizeName(last.name))) continue;
    const recent = rows.slice(-RECENT);
    const earlierMpg = earlier.length ? mean(earlier.map((r) => r.min)) : null;
    const jump = earlierMpg == null ? null : last.min - earlierMpg;
    const recentStarts = recent.filter((r) => r.starter === true).length;
    const earlierStarts = earlier.filter((r) => !recent.includes(r) && r.starter === true).length;
    const absence = away.get(id);
    const flags = [];
    if (earlier.length >= minPriorGames) {
      if (jump >= minJump && last.min >= minMinutes) flags.push('minutes');
      if (recentStarts >= 2 && earlierStarts <= 1) flags.push('starter');
    }
    if (absence && absence.latestAbsence >= minMissed && absence.gamesBack <= maxGamesBack) flags.push('returning');
    if (!flags.length) continue;
    candidates.push({ id, last, flags, earlierMpg, jump, recentStarts, recentGames: recent.length, earlierStarts, absence });
  }
  if (!candidates.length) return [];

  const games = candidates.map((c) => ({ name: `game:${c.id}`, perGame: average([c.last]) }));
  const values = seasonValues([...pool, ...games], { poolSize: pool.length, poolFilter: (p) => p.name.startsWith('season:') });
  return candidates.map((c) => ({
    espnId: c.id, name: c.last.name, team: c.last.team, flags: c.flags,
    lastDate: c.last.date, earlierMpg: c.earlierMpg, minutes: c.last.min, jump: c.jump,
    recentStarts: c.recentStarts, recentGames: c.recentGames, earlierStarts: c.earlierStarts,
    latestAbsence: c.absence?.latestAbsence ?? 0, gamesBack: c.absence?.gamesBack ?? null,
    box: Object.fromEntries(['min', ...COUNTING].map((k) => [k, c.last[k]])),
    gameZ: values.get(`game:${c.id}`).perGameZ, seasonZ: values.get(`season:${c.id}`).perGameZ,
    availability: available.has(c.id) ? 'confirmed' : 'unconfirmed',
  })).sort((a, b) => b.gameZ - a.gameZ || (b.jump ?? -Infinity) - (a.jump ?? -Infinity) || Number(a.espnId) - Number(b.espnId)).slice(0, limit);
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
  // A rostered player with no ID match cannot be excluded by ID, so a listed player whose name
  // equals his is excluded by name, and the caller prints the unmatched players.
  const excludeNames = new Set(unmatched.map((m) => normalizeName(m.p.name)));
  const today = easternDate(snapshot.asOf);
  const date = logs.filter((r) => !r.didNotPlay && r.date <= today).map((r) => r.date).sort().pop();
  if (!date) return skipped('no played games in the game logs');
  // With every roster in hand, anyone not on one is available (possibly on waivers).
  const exclude = new Set(matched.filter((m) => m.id).map((m) => m.id));
  const available = new Set(logs.map((r) => String(r.espnId)).filter((id) => !exclude.has(id)));
  const players = roleChanges({ logs, date, exclude, excludeNames, available, options });
  return { status: 'ok', date, players, unmatched: unmatched.map((m) => ({ name: m.p.name, nbaTeam: m.p.nbaTeam })) };
}
