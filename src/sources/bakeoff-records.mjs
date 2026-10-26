import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readDecision } from './decisions.mjs';
import { findPlayer, normalizeName } from '../engine/names.mjs';
import { projectTeam, BLOCKED, openRosterSpots } from '../engine/needs.mjs';
import { pickupStart } from '../engine/v0-advice.mjs';
import { tomorrow } from '../engine/weeks.mjs';
import { applyPreferences } from '../engine/preferences.mjs';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
const read = async (file) => JSON.parse(await readFile(file, 'utf8'));

export async function decisionInputs(record) {
  const text = await readFile(record.provenance.snapshotPath);
  if (hash(text) !== record.provenance.snapshotHash) throw new Error('Saved snapshot hash changed');
  const [ids, schedule] = await Promise.all(['data/ids.json', 'data/schedule-2026-27.json'].map(read));
  for (const [name, value] of Object.entries({ ids, schedule })) {
    if (hash(JSON.stringify(value)) !== record.provenance[`${name}Hash`]) throw new Error(`Saved ${name} hash changed`);
  }
  if (!record.projections?.players || !record.report.banked) throw new Error('Decision predates replay evidence; rerun as rehearsal, not as a retrospective pilot entry');
  return { snapshot: JSON.parse(text), ids, schedule };
}

export async function attachLineups(entry) {
  const record = await readDecision(entry.decisionId), r = record.report;
  if (entry.week !== r.week || Date.parse(entry.asOf) !== Date.parse(r.asOf)) throw new Error(`entry does not match decision ${entry.decisionId}: week/asOf must match`);
  // Old rehearsal records remain readable, but cannot become scored decisions by reconstruction.
  if (!r.banked || !record.projections?.players) return { ...entry, lineups: null };
  const inputs = await decisionInputs(record), { ids, schedule } = inputs;
  const snapshot = r.options.preferences ? applyPreferences(inputs.snapshot, r.options.preferences).snapshot : inputs.snapshot;
  if (entry.source === 'none' && entry.decision !== 'hold') throw new Error('Do-nothing baseline must hold');
  if (entry.source === 'tool') {
    const actual = r.decision;
    if ((actual.action === 'move') !== (entry.decision === 'move') || actual.action === 'move' &&
      (actual.pair.pickup.name !== entry.add.name || (actual.pair.drop?.name ?? null) !== (entry.drop?.name ?? null) || actual.pair.pickupStart !== entry.start)) throw new Error('Tool entry must match saved recommendation');
  }
  const priors = new Map(record.projections.players.map((p) => [p.name, p]));
  const match = (p) => {
    const found = findPlayer(ids.players, p.name, p.nbaTeam).player;
    const prior = priors.get(found?.priorName);
    return { ...p, espnId: found?.espnId ?? null, prior: prior?.perGame ? prior : null };
  };
  const roster = snapshot.team.roster.map(match);
  const identify = (g) => ({ ...g, espnId: g.espnId ?? match([...snapshot.team.roster, ...snapshot.matchup.opponentRoster, ...snapshot.freeAgents].find((p) => p.name === g.name) ?? { name: g.name }).espnId });
  const baseline = r.baselineLineups.mine.map(identify), opponent = r.baselineLineups.opponent.map(identify);
  let proposed = baseline;
  if (entry.decision === 'move') {
    const pickup = snapshot.freeAgents.map(match).find((p) => p.name === entry.add.name && String(p.espnId) === String(entry.add.espnId));
    const drop = entry.drop && roster.find((p) => p.name === entry.drop.name && String(p.espnId) === String(entry.drop.espnId));
    if (!pickup || (entry.drop && !drop) || BLOCKED.includes(pickup.status)) throw new Error('Move must name an available eligible pickup and a rostered drop');
    if (!entry.drop && (r.openSpots ?? openRosterSpots(snapshot.settings, snapshot.team.roster)) < 1) throw new Error('A move without a drop needs an open roster spot');
    if (drop && r.options.roles.core.some((name) => normalizeName(name) === normalizeName(drop.name))) throw new Error('Cannot drop a core player');
    if (!r.addsLeft || entry.start < pickupStart(pickup, r.fromDate, r.window, r.addsFrom) || entry.start > r.window.end) throw new Error('Move has no legal effective date/add remaining');
    const project = (force) => projectTeam(roster, {}, {}, snapshot.settings, schedule, r.fromDate, r.window.end,
      { pickup, drop, start: entry.start, startPickup: force }).started;
    const automatic = project(false), deliberate = project(true);
    const count = (starts) => starts.filter((g) => g.name === pickup.name).length;
    proposed = count(deliberate) > count(automatic) ? deliberate : automatic;
  }
  return { ...entry, toolAction: entry.source === 'tool' ? r.decision.action : undefined,
    lineups: { baseline, proposed, opponent, banked: r.fromDate === tomorrow(snapshot.asOf) ? r.banked : null,
      from: r.fromDate, through: r.window.end } };
}
