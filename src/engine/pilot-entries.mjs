import { findPlayer } from './names.mjs';
import { addDays, tomorrow } from './weeks.mjs';

// The two reply formats fixed by the pilot prompt in docs/bakeoff-prompt.md.
const MOVE = /^ADD:\s*(.+?)\s*\|\s*DROP:\s*(.+?)\s*\|\s*START:\s*(\S+)\s*\|\s*HELPS:.*\|\s*HURTS:.*\|\s*WHY:.*$/i;
const HOLD = /^HOLD\s*\|\s*WHY:.*$/i;
const NO_DROP = /^(none|-|n\/a|nobody)$/i;

export function parseReply(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim().replace(/^[`*>\s]+|[`*\s]+$/g, '')).filter(Boolean);
  const answers = [...new Set(lines.filter((l) => MOVE.test(l) || HOLD.test(l)))];
  if (!answers.length) return { invalidReason: 'reply matches neither the ADD nor the HOLD format' };
  if (answers.length > 1) return { invalidReason: 'reply has more than one answer line' };
  const move = MOVE.exec(answers[0]);
  if (!move) return { decision: 'hold' };
  const [, add, drop, start] = move;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { invalidReason: `START is not a YYYY-MM-DD date: ${start}` };
  return { decision: 'move', add, drop: NO_DROP.test(drop) ? null : drop, start };
}

// Resolves a name against one pool (free agents or Tony's roster), then to its ESPN id the way
// attachLineups does, so the recorded entry passes its name and id check.
function identify(pool, name, ids) {
  const found = findPlayer(pool.map((p) => ({ ...p, team: p.nbaTeam })), name);
  if (!found.player) return { reason: `${name}: ${found.reason}` };
  const espnId = findPlayer(ids.players, found.player.name, found.player.nbaTeam).player?.espnId;
  return espnId == null ? { reason: `${found.player.name}: no ESPN id` } : { player: { name: found.player.name, espnId } };
}

// Builds the tool, do-nothing and chatbot entries for one saved decision. Ratings stay null:
// Tony rates each arm with `bakeoff rate`.
export function pilotEntries({ record, snapshot, ids, manifest, reply }) {
  const r = record.report;
  const base = { decisionId: record.id, week: r.week, date: addDays(tomorrow(r.asOf), -1), asOf: r.asOf, rating: null, chatbot: null };
  const hold = { decision: 'hold', add: null, drop: null };
  const toolId = (p) => {
    const espnId = findPlayer(ids.players, p.name, p.nbaTeam).player?.espnId;
    if (espnId == null) throw new Error(`Tool move names ${p.name}, who has no ESPN id`);
    return { name: p.name, espnId };
  };
  const pair = r.decision.action === 'move' ? r.decision.pair : null;
  const tool = { ...base, source: 'tool', ...(pair
    ? { decision: 'move', start: pair.pickupStart, add: toolId(pair.pickup), drop: pair.drop ? toolId(pair.drop) : null }
    : hold) };

  const parsed = parseReply(reply);
  let answer = parsed.invalidReason ? { ...hold, invalidReason: parsed.invalidReason } : hold;
  if (parsed.decision === 'move') {
    const add = identify(snapshot.freeAgents, parsed.add, ids);
    const drop = parsed.drop === null ? { player: null } : identify(snapshot.team.roster, parsed.drop, ids);
    const reasons = [add.reason && `ADD ${add.reason}`, drop.reason && `DROP ${drop.reason}`].filter(Boolean);
    answer = reasons.length ? { ...hold, invalidReason: reasons.join('; ') }
      : { decision: 'move', start: parsed.start, add: add.player, drop: drop.player };
  }
  const chatbot = { ...base, source: 'chatbot', chatbot: manifest.chatbotModel, promptVersion: manifest.promptVersion,
    ...answer, note: String(reply ?? '').trim() };
  return [tool, { ...base, source: 'none', ...hold }, chatbot];
}
