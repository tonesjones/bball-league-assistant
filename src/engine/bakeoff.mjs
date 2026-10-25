import { replayLineups } from './lineup-replay.mjs';
import { CATEGORIES } from '../sources/yahoo-pages/common.mjs';

const REJECT_REASONS = ['wrong-role', 'core-player', 'bad-data', 'injury', 'timing', 'other'];
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
  if (!['tool', 'chatbot', 'none'].includes(e.source)) bad.push('source must be tool, chatbot or none');
  if (e.source === 'none' && e.decision !== 'hold') bad.push('none source must hold');
  if (e.invalidReason !== undefined && (typeof e.invalidReason !== 'string' || !e.invalidReason || e.decision !== 'hold')) bad.push('invalidReason needs a nonempty reason and hold');
  if (e.source === 'chatbot' && (typeof e.chatbot !== 'string' || !e.chatbot)) bad.push('chatbot source needs chatbot name');
  if (e.source === 'chatbot') {
    if (e.promptVersion == null && allowLegacyPromptVersion) e = { ...e, promptVersion: null };
    else if (!Number.isInteger(e.promptVersion) || e.promptVersion < 1) bad.push('chatbot promptVersion must be a positive integer');
  } else if (e.promptVersion !== undefined) bad.push(`${e.source} promptVersion must be omitted`);
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

export function scorecard(results, { lastN = 10, minScored = 10 } = {}) {
  const decisions = new Map();
  for (const row of results) {
    const { decisionId } = row.entry;
    (decisions.get(decisionId) ?? decisions.set(decisionId, []).get(decisionId)).push(row);
  }
  const groups = new Map();
  for (const [decisionId, rows] of decisions) {
    const tool = rows.find((r) => r.entry.source === 'tool');
    const bot = rows.find((r) => r.entry.source === 'chatbot');
    const baseline = rows.find((r) => r.entry.source === 'none');
    const modelVersion = rows.find((r) => r.modelVersion != null)?.modelVersion ?? null;
    const promptVersion = bot?.entry.promptVersion ?? null;
    const key = `${modelVersion ?? 'rehearsal'}/${promptVersion ?? 'rehearsal'}`;
    const group = groups.get(key) ?? { modelVersion, promptVersion, rehearsal: modelVersion == null, decisions: new Map() };
    group.decisions.set(decisionId, { decisionId, createdAt: rows[0].createdAt, rows, paired: Boolean(tool && bot && baseline && [tool, bot, baseline].every((r) => r.status !== 'unscored' && r.gain)) });
    groups.set(key, group);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => (a.modelVersion ?? -1) - (b.modelVersion ?? -1) || (a.promptVersion ?? -1) - (b.promptVersion ?? -1));
  return sortedGroups.map((group) => {
    const rows = [...group.decisions.values()].flatMap((d) => d.rows);
    const paired = [...group.decisions.values()].filter((d) => d.paired).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.decisionId.localeCompare(b.decisionId));
    const pairedRows = (source, selected = paired) => selected.flatMap((d) => d.rows.filter((r) => r.entry.source === source));
    const summaries = ['tool', 'chatbot', 'none'].flatMap((source) => summarize(rows.filter((r) => r.entry.source === source)));
    const rollings = ['tool', 'chatbot', 'none'].map((source) => ({ source, ...summarize(pairedRows(source, paired.slice(-lastN)))[0] })).filter((r) => r.scored !== undefined);
    const total = Object.fromEntries(['tool', 'chatbot', 'none'].map((source) => [source, summarize(pairedRows(source))[0]]));
    const { tool, chatbot, none } = total;
    const beats = (other) => tool.net > other.net && tool.meanRating != null && other.meanRating != null && tool.meanRating > other.meanRating;
    const gate = group.rehearsal ? 'rehearsal' : paired.length < minScored ? 'too few' : beats(chatbot) && beats(none) ? 'met' : 'not met';
    return { modelVersion: group.modelVersion, promptVersion: group.promptVersion, rehearsal: group.rehearsal, paired: paired.length, summaries,
      rolling: rollings, gate, comparison: Object.fromEntries(['tool', 'chatbot', 'none'].map((source) => [source, { net: total[source]?.net ?? 0, meanRating: total[source]?.meanRating ?? null }])) };
  });
}
