import { CATEGORIES } from '../sources/yahoo-pages/common.mjs';

const REJECT_REASONS = ['wrong-role', 'core-player', 'bad-data', 'injury', 'timing', 'other'];
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

export function validateEntry(e) {
  const bad = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('invalid entry:\n- not an object');
  if (typeof e.decisionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(e.decisionId)) bad.push('decisionId must name a saved decision record');
  e = { ...e, decision: e.decision === undefined ? 'move' : e.decision, start: e.start === undefined ? e.date : e.start };
  if (!Number.isInteger(e.week) || e.week < 1) bad.push('week must be a positive integer');
  if (!isDate(e.date)) bad.push('date must be YYYY-MM-DD');
  if (!['move', 'hold'].includes(e.decision)) bad.push('decision must be move or hold');
  if (e.decision === 'move' && !isDate(e.start)) bad.push('start must be YYYY-MM-DD');
  if (!['tool', 'chatbot', 'none'].includes(e.source)) bad.push('source must be tool, chatbot or none');
  if (e.source === 'chatbot' && (typeof e.chatbot !== 'string' || !e.chatbot)) bad.push('chatbot source needs chatbot name');
  if (['tool', 'none'].includes(e.source) && e.chatbot !== null) bad.push(`${e.source} chatbot must be null`);
  for (const key of ['add', 'drop']) {
    if (e.decision === 'hold') { if (e[key] !== null) bad.push(`${key} must be null for hold`); }
    else if (!e[key] || typeof e[key].name !== 'string' || !e[key].name || (typeof e[key].espnId !== 'string' && typeof e[key].espnId !== 'number')) bad.push(`${key} needs name and espnId`);
  }
  if (!(e.rating === null || (Number.isInteger(e.rating) && e.rating >= 1 && e.rating <= 5))) bad.push('rating must be 1..5 or null');
  if (typeof e.asOf !== 'string' || Number.isNaN(Date.parse(e.asOf))) bad.push('asOf must be a timestamp');
  if (e.taken !== undefined && typeof e.taken !== 'boolean') bad.push('taken must be boolean');
  if (e.rejectReason !== undefined && !REJECT_REASONS.includes(e.rejectReason)) bad.push(`rejectReason must be one of ${REJECT_REASONS.join(', ')}`);
  if (e.note !== undefined && typeof e.note !== 'string') bad.push('note must be a string');
  if (bad.length) throw new Error(`invalid entry:\n- ${bad.join('\n- ')}`);
  return e;
}

const STAT = { '3PM': 'fg3m', PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk' };

export function realizedGain(entry, lines, { to }) {
  const from = entry.start ?? entry.date;
  const hold = entry.decision === 'hold';
  const sums = (id) => {
    const a = hold ? [] : lines.filter((x) => String(x.espnId) === String(id) && x.date >= from && x.date <= to);
    const keys = ['fgm','fga','ftm','fta','fg3m','pts','reb','ast','stl','blk','to'];
    return { gp: new Set(a.map((x) => `${x.date}/${x.espnEventId}`)).size, ...Object.fromEntries(keys.map((k) => [k, a.reduce((s, x) => s + (x[k] ?? 0), 0)])) };
  };
  const add = sums(entry.add?.espnId); const drop = sums(entry.drop?.espnId); const gain = {};
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
  const changed = { helped: [], hurt: [] };
  const rank = { loss: 0, tie: 1, win: 2 };
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
    const delta = sign * (rank[outcome(adjusted, opp, c)] - rank[outcome(mine, opp, c)]);
    if (delta > 0) changed.helped.push(c);
    if (delta < 0) changed.hurt.push(c);
  }
  return changed;
}

export function summarize(results) {
  const groups = new Map();
  for (const r of results) { const name = r.entry.source === 'chatbot' ? r.entry.chatbot : r.entry.source; (groups.get(name) ?? groups.set(name, []).get(name)).push(r); }
  return [...groups].map(([source, rows]) => {
    const rated = rows.filter((r) => r.entry.rating != null);
    const mean = (value) => rows.reduce((n, r) => n + value(r), 0) / rows.length;
    const helped = rows.reduce((n, r) => n + (r.flips?.helped.length ?? 0), 0);
    const hurt = rows.reduce((n, r) => n + (r.flips?.hurt.length ?? 0), 0);
    const holds = rows.filter((r) => r.entry.decision === 'hold').length;
    const meanGain = Object.fromEntries(CATEGORIES.map((c) => [c, c === 'FG%' || c === 'FT%'
      ? { makes: mean((r) => r.gain[c].makes), attempts: mean((r) => r.gain[c].attempts) } : mean((r) => r.gain[c])]));
    return { source, moves: rows.length - holds, holds, helped, hurt, net: helped - hurt, meanGain,
      meanRating: rated.length ? rated.reduce((n, r) => n + r.entry.rating, 0) / rated.length : null,
      rejectReasons: Object.fromEntries(REJECT_REASONS.map((reason) => [reason, rows.filter((r) => r.entry.rejectReason === reason).length])) };
  });
}
