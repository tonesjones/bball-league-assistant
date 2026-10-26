import { easternDate } from './gamelogs.mjs';

const stats = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks',
  to: 'turnovers', fg3m: 'threePointFieldGoalsMade', fgm: 'fieldGoalsMade', fga: 'fieldGoalsAttempted',
  ftm: 'freeThrowsMade', fta: 'freeThrowsAttempted' };

export function parseHistoricalLogs(json, player, season = 2026) {
  // ESPN returns only the league filter for players with no game-log data. This is
  // unavailable history, not evidence of zero production or a verified injury absence.
  if (Object.keys(json).length === 1 && Array.isArray(json.filters)
    && json.filters.length === 1 && json.filters[0].name === 'league' && json.filters[0].value === 'nba') return null;
  if (json.filters?.find((f) => f.name === 'season')?.value !== String(season)) throw new Error('Game-log season mismatch');
  const regular = json.seasonTypes?.filter((s) => s.displayName === `${season - 1}-${String(season).slice(-2)} Regular Season`) ?? [];
  if (!regular.length) return [];
  const positions = Object.fromEntries(json.names.map((n, i) => [n, i]));
  const seen = new Set(), out = [];
  for (const season of regular) for (const group of season.categories ?? []) for (const e of group.events ?? []) {
    if (seen.has(e.eventId)) throw new Error(`Duplicate event ${e.eventId}`);
    seen.add(e.eventId);
    const event = json.events[e.eventId];
    if (!event?.gameDate) throw new Error('Missing game date');
    const date = easternDate(event.gameDate);
    if (date < '2025-10-21' || date > '2026-04-13') throw new Error('Out-of-season regular game');
    const val = (name) => e.stats[positions[name]];
    const min = Number(val('minutes'));
    if (!/^\d+(?:\.\d+)?$/.test(val('minutes') ?? '') || !Number.isFinite(min)) throw new Error('Invalid historical minutes');
    const line = { espnId: player.id, espnEventId: String(e.eventId), date, min, didNotPlay: false, starter: null };
    for (const [key, name] of Object.entries(stats)) {
      if (['fgm', 'fga', 'ftm', 'fta', 'fg3m'].includes(key)) continue;
      line[key] = Number(val(name === 'rebounds' ? 'totalRebounds' : name));
    }
    for (const [label, made, attempted] of [['fieldGoalsMade-fieldGoalsAttempted', 'fgm', 'fga'],
      ['freeThrowsMade-freeThrowsAttempted', 'ftm', 'fta'], ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'fg3m', 'fg3a']]) {
      const pair = /^(\d+)-(\d+)$/.exec(val(label) ?? '');
      if (!pair || +pair[1] > +pair[2]) throw new Error('Invalid historical shooting pair');
      line[made] = +pair[1]; line[attempted] = +pair[2];
    }
    if (!Object.keys(stats).every((k) => Number.isFinite(line[k]) && line[k] >= 0)) throw new Error('Missing historical production');
    out.push(line);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
