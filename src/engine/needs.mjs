import { CATEGORIES } from '../sources/yahoo-pages/common.mjs';
import { addDays } from './weeks.mjs';

export const STAT = { '3PM': 'fg3m', PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', TO: 'to' };
export const DEFAULT_PHI = { PTS: 4, REB: 1.5, AST: 1.5, '3PM': 1.5, STL: 1.2, BLK: 1.5, TO: 1.2 };
export const BLOCKED = ['O', 'D', 'INJ', 'SUSP', 'NA'];
export const UNKNOWN_MPG = 24;
const priority = (p) => p.prior ? p.prior.mpg ?? 0 : UNKNOWN_MPG;
const active = (slot) => !['BN', 'IL', 'IL+'].includes(slot);
const KEYS = ['fgm', 'fga', 'ftm', 'fta', ...Object.values(STAT)];
const empty = () => Object.fromEntries(KEYS.map((k) => [k, 0]));
const categories = (line) => ({
  ...Object.fromEntries(Object.entries(STAT).map(([c, k]) => [c, line[k]])),
  'FG%': line.fga ? line.fgm / line.fga : 0,
  'FT%': line.fta ? line.ftm / line.fta : 0,
});

export function assignLineup(players, slots) {
  const positions = slots.filter((p) => active(p.slot)).flatMap((p) => Array(p.count).fill(p.slot));
  const placed = Array(positions.length).fill(null);
  const fits = (p, slot) => slot === 'Util' || (p.positions ?? []).some((pos) =>
    pos === slot || slot === 'G' && ['PG', 'SG'].includes(pos) || slot === 'F' && ['SF', 'PF'].includes(pos));
  const place = (player, seen) => {
    for (let i = 0; i < positions.length; i++) {
      if (seen.has(i) || !fits(player, positions[i])) continue;
      seen.add(i);
      if (!placed[i] || place(placed[i], seen)) {
        placed[i] = player;
        return true;
      }
    }
    return false;
  };
  const selected = [...players].sort((a, b) => priority(b) - priority(a))
    .filter((p) => place(p, new Set()));
  return selected.map((player) => ({ player, slot: positions[placed.indexOf(player)] }));
}

// Roster entries carry their matched prior. A swap takes effect on its start date.
export function projectTeam(roster, totals, volume, settings, schedule, fromDate, endDate, swap = null) {
  const remaining = empty(), banked = empty(), started = [];
  let unknownGames = 0;
  for (const [c, k] of Object.entries(STAT)) banked[k] = totals?.[c] ?? 0;
  for (const k of ['fgm', 'fga', 'ftm', 'fta']) banked[k] = volume?.[k] ?? 0;
  const cap = settings.maxGamesPerWeek ?? Infinity;
  const teamsByDate = new Map();
  for (const g of schedule.games) {
    if (!teamsByDate.has(g.date)) teamsByDate.set(g.date, new Set());
    teamsByDate.get(g.date).add(g.home).add(g.away);
  }
  for (let date = fromDate; date <= endDate && started.length < cap; date = addDays(date, 1)) {
    const players = swap && date >= swap.start
      ? roster.map((p) => p === swap.drop ? { ...swap.pickup, slot: 'BN' } : p) : roster;
    const eligible = players.filter((p) => !['IL', 'IL+'].includes(p.slot)
      && !BLOCKED.includes(p.status) && teamsByDate.get(date)?.has(p.nbaTeam));
    for (const { player: p, slot } of assignLineup(eligible, settings.rosterPositions)) {
      if (started.length >= cap) break;
      started.push({ name: p.name, date, slot });
      if (!p.prior) { unknownGames++; continue; }
      for (const k of KEYS) remaining[k] += p.prior.perGame[k] ?? 0;
    }
  }
  const line = Object.fromEntries(KEYS.map((k) => [k, banked[k] + remaining[k]]));
  return { totals: categories(line), line, remaining, started, unknownGames };
}

export function normalCdf(z) {
  if (z === 0) return 0.5;
  const x = Math.abs(z), t = 1 / (1 + 0.2316419 * x);
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)
    * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - tail : tail;
}

export function needs(mine, opponent, phi = DEFAULT_PHI, { shootingKnown = true } = {}) {
  const byCategory = {};
  for (const c of CATEGORIES) {
    if (!shootingKnown && (c === 'FG%' || c === 'FT%')) {
      byCategory[c] = { mine: null, opponent: null, margin: null, spread: null, pWin: null, label: 'unknown' };
      continue;
    }
    let variance;
    if (c === 'FG%' || c === 'FT%') {
      const key = c === 'FG%' ? 'fga' : 'fta';
      variance = [mine, opponent].reduce((sum, side) => {
        const p = side.totals[c], attempts = side.line[key];
        return sum + (attempts ? side.remaining[key] * p * (1 - p) / attempts ** 2 : 0);
      }, 0);
    } else variance = (phi[c] ?? DEFAULT_PHI[c]) * (mine.remaining[STAT[c]] + opponent.remaining[STAT[c]]);
    const margin = (mine.totals[c] - opponent.totals[c]) * (c === 'TO' ? -1 : 1);
    const spread = Math.sqrt(variance);
    const pWin = spread ? normalCdf(margin / spread) : margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    const label = pWin >= 0.25 && pWin <= 0.75 ? 'close' : pWin > 0.9 ? 'safe' : pWin < 0.1 ? 'lost' : 'lean';
    byCategory[c] = { mine: mine.totals[c], opponent: opponent.totals[c], margin, spread, pWin, label };
  }
  return { categories: byCategory, expectedCategories: Object.values(byCategory).reduce((sum, c) => sum + (c.pWin ?? 0), 0) };
}
