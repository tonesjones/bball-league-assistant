import { replayLineups } from './lineup-replay.mjs';
import { CATEGORIES } from '../sources/yahoo-pages/common.mjs';

export const TONY_TAGS = ['changed-decision', 'caught-mistake', 'no-effect', 'wasted-time'];
const REJECT_REASONS = ['wrong-role', 'core-player', 'bad-data', 'injury', 'timing', 'other'];
const isDecisionId = (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(v);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

export function validateEntry(e, { allowLegacyPromptVersion = true } = {}) {
  const bad = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('invalid entry:\n- not an object');
  if (typeof e.decisionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(e.decisionId)) bad.push('decisionId must name a saved decision record');
  e = { ...e, decision: e.decision === undefined ? 'move' : e.decision, start: e.start === undefined ? e.date : e.start };
  if (!Number.isInteger(e.week) || e.week < 1) bad.push('week must be a positive integer');
  if (!isDate(e.date)) bad.push('date must be YYYY-MM-DD');
  if (!['move', 'hold'].includes(e.decision)) bad.push('decision must be move or hold');
  if (e.decision === 'move' && !isDate(e.start)) bad.push('start must be YYYY-MM-DD');
  if (!['tool', 'chatbot', 'none', 'tony'].includes(e.source)) bad.push('source must be tool, chatbot, none or tony');
  if (e.source === 'none' && e.decision !== 'hold') bad.push('none source must hold');
  if (e.invalidReason !== undefined && (typeof e.invalidReason !== 'string' || !e.invalidReason || e.decision !== 'hold')) bad.push('invalidReason needs a nonempty reason and hold');
  if (e.source === 'chatbot' && (typeof e.chatbot !== 'string' || !e.chatbot)) bad.push('chatbot source needs chatbot name');
  if (e.source === 'chatbot') {
    if (e.promptVersion == null && allowLegacyPromptVersion) e = { ...e, promptVersion: null };
    else if (!Number.isInteger(e.promptVersion) || e.promptVersion < 1) bad.push('chatbot promptVersion must be a positive integer');
  } else if (e.promptVersion !== undefined) bad.push(`${e.source} promptVersion must be omitted`);
  if (['tool', 'none', 'tony'].includes(e.source) && e.chatbot !== null) bad.push(`${e.source} chatbot must be null`);
  for (const key of ['add', 'drop']) {
    if (e.decision === 'hold') { if (e[key] !== null) bad.push(`${key} must be null for hold`); }
    // A move with drop null adds the pickup to an open roster spot.
    else if (key === 'drop' && e[key] === null) continue;
    else if (!e[key] || typeof e[key].name !== 'string' || !e[key].name || (typeof e[key].espnId !== 'string' && typeof e[key].espnId !== 'number')) bad.push(`${key} needs name and espnId`);
  }
  if (e.source === 'tony') {
    if (e.rating !== null) bad.push('tony rating must be null');
    if (!TONY_TAGS.includes(e.tag)) bad.push(`tag must be one of ${TONY_TAGS.join(', ')}`);
    if (e.minutes !== undefined && !(typeof e.minutes === 'number' && Number.isFinite(e.minutes) && e.minutes >= 0)) bad.push('minutes must be a number');
    if (e.rescue !== undefined && typeof e.rescue !== 'boolean') bad.push('rescue must be boolean');
  } else for (const key of ['tag', 'minutes', 'rescue']) if (e[key] !== undefined) bad.push(`${e.source} ${key} must be omitted`);
  if (e.replaces !== undefined && e.replaces !== true) bad.push('replaces must be true');
  if (!(e.rating === null || (Number.isInteger(e.rating) && e.rating >= 1 && e.rating <= 5))) bad.push('rating must be 1..5 or null');
  if (typeof e.asOf !== 'string' || Number.isNaN(Date.parse(e.asOf))) bad.push('asOf must be a timestamp');
  if (e.taken !== undefined && typeof e.taken !== 'boolean') bad.push('taken must be boolean');
  if (e.rejectReason !== undefined && !REJECT_REASONS.includes(e.rejectReason)) bad.push(`rejectReason must be one of ${REJECT_REASONS.join(', ')}`);
  if (e.note !== undefined && typeof e.note !== 'string') bad.push('note must be a string');
  if (bad.length) throw new Error(`invalid entry:\n- ${bad.join('\n- ')}`);
  return e;
}

export function validateReview(r) {
  const bad = [];
  if (!isDecisionId(r.decisionId)) bad.push('decisionId must name a saved decision record');
  if (!['tool', 'chatbot', 'none', 'tony'].includes(r.source)) bad.push('source must be tool, chatbot, none or tony');
  if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) bad.push('rating must be 1..5');
  if (r.rejectReason !== undefined && !REJECT_REASONS.includes(r.rejectReason)) bad.push(`rejectReason must be one of ${REJECT_REASONS.join(', ')}`);
  if (r.note !== undefined && typeof r.note !== 'string') bad.push('note must be a string');
  if (typeof r.recordedAt !== 'string' || Number.isNaN(Date.parse(r.recordedAt))) bad.push('recordedAt must be a timestamp');
  if (bad.length) throw new Error(`invalid review:\n- ${bad.join('\n- ')}`);
  return r;
}

export const realizedGain = replayLineups;

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
    const scored = rows.filter((r) => r.status !== 'unscored' && r.gain);
    const rated = rows.filter((r) => r.entry.rating != null);
    const mean = (value) => scored.length ? scored.reduce((n, r) => n + value(r), 0) / scored.length : null;
    const helped = rows.reduce((n, r) => n + (r.flips?.helped.length ?? 0), 0);
    const hurt = rows.reduce((n, r) => n + (r.flips?.hurt.length ?? 0), 0);
    const holds = rows.filter((r) => r.entry.decision === 'hold').length;
    const meanGain = !scored.length ? null : Object.fromEntries(CATEGORIES.map((c) => [c, c === 'FG%' || c === 'FT%'
      ? { makes: mean((r) => r.gain[c].makes), attempts: mean((r) => r.gain[c].attempts) } : mean((r) => r.gain[c])]));
    return { source, scored: scored.length, unscored: rows.length - scored.length, invalid: rows.filter((r) => r.entry.invalidReason).length, moves: rows.length - holds, holds, helped, hurt, net: helped - hurt, meanGain,
      meanRating: rated.length ? rated.reduce((n, r) => n + r.entry.rating, 0) / rated.length : null,
      rejectReasons: Object.fromEntries(REJECT_REASONS.map((reason) => [reason, rows.filter((r) => r.entry.rejectReason === reason).length])) };
  });
}

const sameName = (a, b) => (a?.name ?? null) === (b?.name ?? null) && String(a?.espnId ?? '') === String(b?.espnId ?? '');

// Two entries differ when their decision, pickup, drop or start differ. A hold has no start.
export function differs(a, b) {
  if (a.decision !== b.decision) return true;
  if (a.decision === 'hold') return false;
  return !sameName(a.add, b.add) || !sameName(a.drop, b.drop) || a.start !== b.start;
}

// The newest entry for each decision and source counts; the log is append-only.
export function latestEntries(entries) {
  const latest = new Map();
  for (const e of entries) latest.set(`${e.decisionId}/${e.source}`, e);
  return [...latest.values()];
}

const net = (side) => side.flips.helped.length - side.flips.hurt.length;

// rows: one per decision, { decisionId, tool, tony } where each side is { entry, status, flips, reasons }.
export function replaySummary(rows) {
  const out = { decisions: rows.length, differing: 0, toolWon: 0, tonyWon: 0, tied: 0, unscored: 0 };
  for (const row of rows) {
    if (!row.differs) continue;
    out.differing++;
    if (row.tool.status !== 'scored' || row.tony.status !== 'scored') { out.unscored++; continue; }
    const d = net(row.tool) - net(row.tony);
    if (d > 0) out.toolWon++; else if (d < 0) out.tonyWon++; else out.tied++;
  }
  return out;
}
