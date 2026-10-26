import { normalizeName } from './names.mjs';
import { fits } from './needs.mjs';

const IL_STATUS = ['O', 'INJ', 'NA'];
const INJURED = ['IL', 'IL+'];
const names = (list, key) => {
  if (!Array.isArray(list) || !list.every((n) => typeof n === 'string' && n)) throw new Error(`preferences.${key} must be an array of names`);
  return list;
};

// Tony's standing preferences from local/preferences.json. Every name must be on his roster.
export function applyPreferences(snapshot, preferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) throw new Error('preferences must be an object');
  const { ilCandidates = [], notIlCandidates = [], lineupLocks = [] } = preferences;
  const roster = snapshot.team.roster.map((p) => ({ ...p }));
  const find = (name, key) => {
    const player = roster.find((p) => normalizeName(p.name) === normalizeName(name));
    if (!player) throw new Error(`preferences.${key}: ${name} is not on the roster`);
    return player;
  };
  const notIl = new Set(names(notIlCandidates, 'notIlCandidates').map((n) => normalizeName(find(n, 'notIlCandidates').name)));
  const candidates = names(ilCandidates, 'ilCandidates').map((n) => find(n, 'ilCandidates'));
  for (const p of candidates) if (notIl.has(normalizeName(p.name))) throw new Error(`preferences: ${p.name} is in both ilCandidates and notIlCandidates`);

  if (!Array.isArray(lineupLocks)) throw new Error('preferences.lineupLocks must be an array');
  const slotCount = (slot) => snapshot.settings.rosterPositions.find((p) => p.slot === slot)?.count ?? 0;
  for (const lock of lineupLocks) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lock?.date ?? '')) throw new Error('preferences.lineupLocks: date must be YYYY-MM-DD');
    if (['BN', ...INJURED].includes(lock.slot) || !slotCount(lock.slot)) throw new Error(`preferences.lineupLocks: ${lock.slot} is not an active slot`);
    const player = find(lock.player, 'lineupLocks');
    if (!fits(player, lock.slot)) throw new Error(`preferences.lineupLocks: ${player.name} can't play ${lock.slot}`);
    if (player.locks?.some((l) => l.date === lock.date)) throw new Error(`preferences.lineupLocks: ${player.name} is locked twice on ${lock.date}`);
    if (lineupLocks.filter((l) => l.date === lock.date && l.slot === lock.slot).length > slotCount(lock.slot)) throw new Error(`preferences.lineupLocks: more ${lock.slot} locks on ${lock.date} than slots`);
    player.locks = [...(player.locks ?? []), { date: lock.date, slot: lock.slot }];
  }

  // Only listed candidates move to IL; the engine never assumes any other IL move.
  const notes = [];
  const free = (slot) => slotCount(slot) - roster.filter((p) => p.slot === slot).length;
  for (const p of candidates) {
    if (INJURED.includes(p.slot)) continue;
    const slot = INJURED.find((s) => free(s) > 0);
    if (!IL_STATUS.includes(p.status)) notes.push(`IL candidate ${p.name} stays on the roster: status ${p.status ?? 'healthy'} is not IL-eligible.`);
    else if (!slot) notes.push(`IL candidate ${p.name} stays on the roster: no free IL slot.`);
    else {
      p.slot = slot;
      notes.push(`Assumes ${p.name} moves to ${slot}, opening a roster spot.`);
    }
  }
  for (const lock of lineupLocks) notes.push(`Lineup lock: ${lock.player} starts at ${lock.slot} on ${lock.date} if they have a game.`);
  return { snapshot: { ...snapshot, team: { ...snapshot.team, roster } }, notes };
}
