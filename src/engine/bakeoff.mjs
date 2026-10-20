import { CATEGORIES } from '../sources/yahoo-pages/common.mjs';

export function validateEntry(e) {
  const bad = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('invalid entry:\n- not an object');
  if (!Number.isInteger(e.week) || e.week < 1) bad.push('week must be a positive integer');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '') || Number.isNaN(Date.parse(e.date))) bad.push('date must be YYYY-MM-DD');
  if (!['tool', 'chatbot'].includes(e.source)) bad.push('source must be tool or chatbot');
  if (e.source === 'chatbot' && (typeof e.chatbot !== 'string' || !e.chatbot)) bad.push('chatbot source needs chatbot name');
  if (e.source === 'tool' && e.chatbot !== null) bad.push('tool chatbot must be null');
  for (const key of ['add', 'drop']) if (!e[key] || typeof e[key].name !== 'string' || !e[key].name || (typeof e[key].espnId !== 'string' && typeof e[key].espnId !== 'number')) bad.push(`${key} needs name and espnId`);
  if (!(e.rating === null || (Number.isInteger(e.rating) && e.rating >= 1 && e.rating <= 5))) bad.push('rating must be 1..5 or null');
  if (typeof e.asOf !== 'string' || Number.isNaN(Date.parse(e.asOf))) bad.push('asOf must be a timestamp');
  if (e.taken !== undefined && typeof e.taken !== 'boolean') bad.push('taken must be boolean');
  if (bad.length) throw new Error(`invalid entry:\n- ${bad.join('\n- ')}`);
  return e;
}

const STAT = { '3PM': 'fg3m', PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk' };

export function realizedGain(entry, lines, { from, to }) {
  const sums = (id) => {
    const a = lines.filter((x) => String(x.espnId) === String(id) && x.date >= from && x.date <= to);
    const keys = ['fgm','fga','ftm','fta','fg3m','pts','reb','ast','stl','blk','to'];
    return { gp: new Set(a.map((x) => `${x.date}/${x.espnEventId}`)).size, ...Object.fromEntries(keys.map((k) => [k, a.reduce((s, x) => s + (x[k] ?? 0), 0)])) };
  };
  const add = sums(entry.add.espnId); const drop = sums(entry.drop.espnId); const gain = {};
  for (const c of CATEGORIES) {
    if (c === 'FG%') gain[c] = { makes: add.fgm - drop.fgm, attempts: add.fga - drop.fga };
    else if (c === 'FT%') gain[c] = { makes: add.ftm - drop.ftm, attempts: add.fta - drop.fta };
    else gain[c] = c === 'TO' ? drop.to - add.to : add[STAT[c]] - drop[STAT[c]];
  }
  return { gain, gamesPlayed: { add: add.gp, drop: drop.gp } };
}

const outcome = (a, b, c) => c === 'TO' ? (a < b ? 'win' : a > b ? 'loss' : 'tie') : (a > b ? 'win' : a < b ? 'loss' : 'tie');
const pct = (v, k) => (v?.[`${k}a`] ? v[`${k}m`] / v[`${k}a`] : 0);

// Undo a move that was taken, or apply one that wasn't. Percentages come from makes and attempts,
// not Yahoo's rounded totals; gain.TO is positive when the move cut turnovers.
export function flips(gain, finalTotals, finalVolume, entry = {}) {
  const sign = entry.taken ? -1 : 1;
  const changed = [];
  for (const c of CATEGORIES) {
    let mine = finalTotals.mine[c], opp = finalTotals.opponent[c], adjusted;
    if (mine == null || opp == null) continue;
    if (c === 'FG%' || c === 'FT%') {
      const k = c === 'FG%' ? 'fg' : 'ft';
      mine = pct(finalVolume.mine, k); opp = pct(finalVolume.opponent, k);
      const makes = (finalVolume.mine?.[`${k}m`] ?? 0) + sign * gain[c].makes;
      const attempts = (finalVolume.mine?.[`${k}a`] ?? 0) + sign * gain[c].attempts;
      adjusted = attempts ? makes / attempts : 0;
    } else adjusted = mine + (c === 'TO' ? -1 : 1) * sign * gain[c];
    if (outcome(mine, opp, c) !== outcome(adjusted, opp, c)) changed.push(c);
  }
  return changed;
}

export function summarize(results) {
  const groups = new Map();
  for (const r of results) { const name = r.entry.source === 'tool' ? 'tool' : r.entry.chatbot; (groups.get(name) ?? groups.set(name, []).get(name)).push(r); }
  const cats = Object.keys(STAT);
  return [...groups].map(([source, rows]) => {
    const vals = rows.flatMap((r) => cats.map((c) => r.gain[c]));
    const rated = rows.filter((r) => r.entry.rating != null);
    return { source, moves: rows.length, meanCountingCategoryGain: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
      categoriesFlipped: rows.reduce((n, r) => n + (r.flips?.length ?? 0), 0),
      meanRating: rated.length ? rated.reduce((n, r) => n + r.entry.rating, 0) / rated.length : null };
  });
}
