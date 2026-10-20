import { STAT } from './needs.mjs';

const VOLUME = ['fgm', 'fga', 'ftm', 'fta'];
const KEYS = [...Object.values(STAT), ...VOLUME];
const LIMIT = 200000;
const empty = () => Object.fromEntries(KEYS.map((k) => [k, 0]));
const volume = (line) => Object.fromEntries(VOLUME.map((k) => [k, line[k]]));
const add = (a, b) => Object.fromEntries(KEYS.map((k) => [k, a[k] + b[k]]));
const percentageMatches = (made, attempts, shown) => shown == null ? attempts === 0
  : Math.round((attempts ? made / attempts : 0) * 1000) === Math.round(shown * 1000);

export function estimateVolume({ roster, totals, logs, from, to, slots }) {
  const players = roster.filter((p) => !['IL', 'IL+'].includes(p.slot));
  const hasId = (p) => p.espnId != null && p.espnId !== '';
  const unmatched = players.filter((p) => !hasId(p)).map((p) => p.name);
  const unknown = (reason) => ({ status: 'unknown', reason, unmatched });
  if (to < from || (Object.keys(STAT).every((c) => totals?.[c] === null || totals?.[c] === 0)
    && totals?.['FG%'] === null && totals?.['FT%'] === null)) {
    return { status: 'matched', ...volume(empty()), unmatched };
  }
  if (!Number.isInteger(slots) || slots < 0) return unknown('invalid slots');
  const ids = new Set(players.filter(hasId).map((p) => String(p.espnId))), days = new Map();
  for (const row of logs) {
    if (row.date < from || row.date > to || !ids.has(String(row.espnId))) continue;
    if (!days.has(row.date)) days.set(row.date, []);
    days.get(row.date).push(row);
  }
  if (!days.size) return unknown('no logs');
  let combinations = 1;
  for (const rows of days.values()) {
    const take = Math.min(slots, rows.length);
    let count = 1;
    for (let i = 1; i <= Math.min(take, rows.length - take); i++) {
      count = count * (rows.length - i + 1) / i;
      if (count * combinations > LIMIT) return unknown('search too large');
    }
    combinations *= Math.round(count);
  }
  const choices = [];
  for (const rows of days.values()) {
    const take = Math.min(slots, rows.length);
    const options = [];
    const choose = (start, left, sum) => {
      if (!left) { options.push(sum); return; }
      for (let i = start; i <= rows.length - left; i++) choose(i + 1, left - 1, add(sum, rows[i]));
    };
    choose(0, take, empty());
    choices.push(options);
  }
  let matched = null, ambiguous = false;
  const search = (day, sum) => {
    if (ambiguous) return;
    if (day < choices.length) {
      for (const option of choices[day]) search(day + 1, add(sum, option));
      return;
    }
    if (!Object.entries(STAT).every(([c, k]) => sum[k] === totals?.[c])
      || !percentageMatches(sum.fgm, sum.fga, totals?.['FG%'])
      || !percentageMatches(sum.ftm, sum.fta, totals?.['FT%'])) return;
    if (matched && VOLUME.some((k) => matched[k] !== sum[k])) ambiguous = true;
    else matched = volume(sum);
  };
  search(0, empty());
  return ambiguous ? unknown('ambiguous') : matched ? { status: 'matched', ...matched, unmatched }
    : unknown('no combination matches');
}
