import { dayLineup } from './needs.mjs';
import { addDays } from './weeks.mjs';

const KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'to', 'fgm', 'fga', 'ftm', 'fta'];

// Who sits on each day of the window, and why, using the same daily lineup as projectTeam.
// `lines` maps a player name to the per-game line the advice used (null or missing = unknown).
export function rosterCrunch({ snapshot, schedule, lines, fromDate, endDate }) {
  const teamsByDate = new Map();
  for (const g of schedule.games) {
    if (!teamsByDate.has(g.date)) teamsByDate.set(g.date, new Set());
    teamsByDate.get(g.date).add(g.home).add(g.away);
  }
  const cap = snapshot.settings.maxGamesPerWeek ?? Infinity;
  const roster = snapshot.team.roster;
  const byPlayer = new Map();
  const entry = (name) => {
    if (!byPlayer.has(name)) byPlayer.set(name, { name, games: 0, starts: 0, sat: 0, satDates: [] });
    return byPlayer.get(name);
  };
  const days = [];
  let started = 0;
  for (let date = fromDate; date <= endDate; date = addDays(date, 1)) {
    const { eligible, starters } = dayLineup(roster, snapshot.settings, teamsByDate.get(date), date);
    if (!eligible.length) continue;
    const day = { date, playing: eligible.map((p) => p.name), starts: [], sits: [] };
    const capped = new Set();
    for (const { player, slot } of starters) {
      if (started >= cap) capped.add(player);
      else { started++; day.starts.push({ name: player.name, slot }); }
    }
    const placed = new Set(starters.map((s) => s.player));
    // A slot nobody could fill is free: a sitter then lacks the position, not the room.
    const filled = new Map();
    for (const s of starters) filled.set(s.slot, (filled.get(s.slot) ?? 0) + 1);
    const total = new Map(snapshot.settings.rosterPositions.map((p) => [p.slot, p.count]));
    const freeSlot = [...total].some(([slot, n]) => !['BN', 'IL', 'IL+'].includes(slot) && (filled.get(slot) ?? 0) < n);
    for (const p of eligible) {
      const e = entry(p.name);
      e.games++;
      if (placed.has(p) && !capped.has(p)) { e.starts++; continue; }
      const reason = capped.has(p) ? 'games cap' : freeSlot ? 'no eligible position' : 'no open slot';
      day.sits.push({ name: p.name, reason });
      e.sat++;
      e.satDates.push(date);
    }
    days.push(day);
  }
  const byPlayerList = [...byPlayer.values()].map((e) => {
    const line = lines?.[e.name];
    const lost = Object.fromEntries(KEYS.map((k) => [k, !e.sat ? 0 : Number.isFinite(line?.[k]) ? e.sat * line[k] : 'unknown']));
    return { ...e, lost };
  }).sort((a, b) => b.sat - a.sat || a.name.localeCompare(b.name));
  return { fromDate, endDate, days, byPlayer: byPlayerList, chronicSitters: byPlayerList.filter((e) => e.sat >= 2).map((e) => e.name),
    crunchDays: days.filter((d) => d.sits.length).length };
}

const fixed = (v) => v === 'unknown' ? 'unknown' : Number(v.toFixed(2));
export function crunchText(c, label) {
  const out = [`${label}: ${c.fromDate} to ${c.endDate}, ${c.crunchDays} day${c.crunchDays === 1 ? '' : 's'} with a sitter.`];
  for (const d of c.days.filter((x) => x.sits.length)) out.push(`  ${d.date}: sits ${d.sits.map((s) => `${s.name} (${s.reason})`).join(', ')}`);
  for (const e of c.byPlayer.filter((x) => x.sat >= 2)) {
    const lost = ['pts', 'reb', 'ast', 'fg3m'].map((k) => `${k} ${fixed(e.lost[k])}`).join(', ');
    out.push(`  Chronic: ${e.name} sat ${e.sat} of ${e.games} games; lost ${lost}.`);
  }
  return out;
}
