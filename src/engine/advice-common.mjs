import { findPlayer, normalizeName } from './names.mjs';
import { seasonValues } from './season-value.mjs';

export const MODEL_VERSION = 7;

// Yahoo's "Oct 25" as a date on or after the matchup start.
export function monthDay(value, window, what) {
  const match = /^([A-Za-z]{3})\s+(\d{1,2})$/.exec(value);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match?.[1]);
  if (!match || month < 0) throw new Error(`invalid ${what}: ${value}`);
  const suffix = `${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  const year = Number(window.start.slice(0, 4));
  const date = `${year}-${suffix}`;
  return date < window.start ? `${year + 1}-${suffix}` : date;
}

export function pickupStart(player, fromDate, window, addsFrom = fromDate) {
  const clears = player.waiverClears ? monthDay(player.waiverClears, window, 'waiverClears') : fromDate;
  return [fromDate, clears, addsFrom].sort().at(-1);
}

export function normalizeRoles(roles = {}, protectedNames = []) {
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) throw new Error('roles must be an object');
  const { core = [], stream = [] } = roles;
  for (const names of [core, stream, protectedNames]) {
    if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) throw new Error('roles core and stream must be arrays of strings');
  }
  const unique = (names) => [...new Map(names.map((n) => [normalizeName(n), n])).values()];
  const result = { core: unique([...core, ...protectedNames]), stream: unique(stream) };
  const coreSet = new Set(result.core.map(normalizeName));
  for (const name of result.stream) {
    if (coreSet.has(normalizeName(name))) throw new Error(`name in both core and stream: ${name}`);
  }
  return result;
}

export const identity = (p) => p.espnId ?? normalizeName(p.name);

export function matchPlayers({ ids, priors, poolSize }) {
  const unscored = [], priorByName = new Map(priors.map((p) => [p.name, p]));
  const values = seasonValues(priors, { poolSize, poolFilter: (p) => p.source !== 'season-only' });
  const match = (players, where) => players.map((p) => {
    const { player, reason } = findPlayer(ids.players, p.name, p.nbaTeam);
    let prior = priorByName.get(player?.priorName);
    if (player && !prior?.perGame) prior = priorByName.get(`espn:${player.espnId}`) ?? prior;
    const season = values.get(prior?.name);
    const unscoredReason = reason ?? (prior?.minutes && !prior.perGame ? 'no usable prior minutes or rates'
      : prior?.perGame ? 'no games in prior' : 'no prior');
    if (!season) unscored.push({ ...p, where, reason: unscoredReason });
    return { ...p, espnId: player?.espnId ?? null, prior: season ? prior : null,
      minutes: prior?.minutes ?? null,
      rates: prior?.rates ?? null,
      season: season ? { value: season.value, rank: season.rank } : null, unscoredReason };
  });
  return { match, unscored };
}

// The guardrail rule that blocks dropping `drop` for `pickup`, or null. A null drop is an add-only
// move; a drop that an earlier planned pickup brought in counts as a stream player.
export function dropBlock(drop, pickup, start, { coreSet, streamSet, openSpots, protectRank, seasonMargin, planPickups = [] }) {
  if (!drop) return null;
  const name = normalizeName(drop.name);
  return coreSet.has(name) ? 'core'
    : ['IL', 'IL+'].includes(drop.slot) && openSpots <= 0 ? 'ilCapacity'
      : drop.locks?.some((lock) => lock.date >= start) ? 'lineupLock'
        : streamSet.has(name) || planPickups.some((p) => identity(p) === identity(drop)) ? null
          : !drop.season || (drop.prior?.source ?? 'prior') !== 'prior' ? 'noPrior' : drop.season.rank <= protectRank ? 'rank'
            : pickup.season.value < drop.season.value + seasonMargin ? 'seasonValue' : null;
}
