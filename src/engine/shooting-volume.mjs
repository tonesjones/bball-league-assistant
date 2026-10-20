import { STAT } from './needs.mjs';

const VOLUME = ['fgm', 'fga', 'ftm', 'fta'];
const KEYS = [...Object.values(STAT), ...VOLUME];
const LIMIT = 2000000;
const empty = () => Object.fromEntries(KEYS.map((k) => [k, 0]));
const volume = (line) => Object.fromEntries(VOLUME.map((k) => [k, line[k]]));
const add = (a, b) => {
  const sum = { ...a };
  for (const k of KEYS) sum[k] += b[k];
  return sum;
};
const percentageMatches = (made, attempts, shown) => shown == null ? attempts === 0
  : Math.round((attempts ? made / attempts : 0) * 1000) === Math.round(shown * 1000);

export function estimateVolume({ roster, totals, logs, from, to, slots }) {
  const players = roster.filter((p) => !['IL', 'IL+'].includes(p.slot));
  const hasId = (p) => p.espnId != null && p.espnId !== '';
  const unmatched = players.filter((p) => !hasId(p)).map((p) => p.name);
  const assumption = 'every open slot filled';
  const unknown = (reason) => ({ status: 'unknown', reason, unmatched, assumption });
  if (to < from || (Object.keys(STAT).every((c) => totals?.[c] === null || totals?.[c] === 0)
    && totals?.['FG%'] === null && totals?.['FT%'] === null)) {
    return { status: 'matched', ...volume(empty()), unmatched, assumption };
  }
  if (!Number.isInteger(slots) || slots < 0) return unknown('invalid slots');
  const ids = new Set(players.filter(hasId).map((p) => String(p.espnId))), days = new Map();
  for (const row of logs) {
    if (row.date < from || row.date > to || !ids.has(String(row.espnId))) continue;
    if (!days.has(row.date)) days.set(row.date, []);
    days.get(row.date).push(row);
  }
  if (!days.size) return unknown('no logs');
  const candidates = [...days.values()], counts = Object.entries(STAT);
  let matched = null, ambiguous = false, tooLarge = false, visited = 0;
  const search = (day, sum) => {
    if (ambiguous || tooLarge) return;
    if (++visited > LIMIT) { tooLarge = true; return; }
    if (counts.some(([c, k]) => sum[k] > (totals?.[c] ?? 0))) return;
    if (day < candidates.length) {
      const rows = candidates[day];
      const choose = (start, left, line) => {
        if (ambiguous || tooLarge) return;
        if (!left) { search(day + 1, line); return; }
        for (let i = start; i <= rows.length - left && !ambiguous && !tooLarge; i++) {
          choose(i + 1, left - 1, add(line, rows[i]));
        }
      };
      choose(0, Math.min(slots, rows.length), sum);
      return;
    }
    if (!counts.every(([c, k]) => sum[k] === totals?.[c])
      || !percentageMatches(sum.fgm, sum.fga, totals?.['FG%'])
      || !percentageMatches(sum.ftm, sum.fta, totals?.['FT%'])) return;
    if (matched && VOLUME.some((k) => matched[k] !== sum[k])) ambiguous = true;
    else matched = volume(sum);
  };
  search(0, empty());
  return tooLarge ? unknown('search too large') : ambiguous ? unknown('ambiguous')
    : matched ? { status: 'matched', ...matched, unmatched, assumption }
    : unknown('no combination matches');
}
