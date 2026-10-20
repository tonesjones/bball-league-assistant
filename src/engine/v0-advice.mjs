import { findPlayer, normalizeName } from './names.mjs';
import { tomorrow } from './weeks.mjs';
import { gamesLeft } from './games-left.mjs';
import { BLOCKED, projectTeam, needs } from './needs.mjs';

export function pickupStart(player, fromDate, window, addsFrom = fromDate) {
  let clears = fromDate;
  if (player.waiverClears) {
    const match = /^([A-Za-z]{3})\s+(\d{1,2})$/.exec(player.waiverClears);
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match?.[1]);
    if (!match || month < 0) throw new Error(`invalid waiverClears: ${player.waiverClears}`);
    const suffix = `${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    const year = Number(window.start.slice(0, 4));
    clears = `${year}-${suffix}`;
    if (clears < window.start) clears = `${year + 1}-${suffix}`;
  }
  return [fromDate, clears, addsFrom].sort().at(-1);
}

export function advise(snapshot, { ids, priors, schedule, protectedNames = [],
  fromDate = tomorrow(snapshot.asOf), addsFrom = fromDate, top = 10, phi } = {}) {
  const window = { start: snapshot.matchup.start, end: snapshot.matchup.end };
  const unscored = [], priorByName = new Map(priors.map((p) => [p.name, p]));
  const match = (players, where) => players.map((p) => {
    const { player, reason } = findPlayer(ids.players, p.name, p.nbaTeam);
    const prior = priorByName.get(player?.priorName);
    if (!prior?.perGame) unscored.push({ ...p, where, reason: reason ?? 'no prior' });
    return { ...p, espnId: player?.espnId ?? null, prior: prior?.perGame ? prior : null };
  });
  const roster = match(snapshot.team.roster, 'roster');
  const opponentRoster = match(snapshot.matchup.opponentRoster, 'opponent');
  const freeAgents = match(snapshot.freeAgents, 'freeAgent');
  const project = (players, side, swap) => projectTeam(players, snapshot.matchup.totals?.[side],
    snapshot.matchup.volume?.[side], snapshot.settings, schedule, fromDate, window.end, swap);
  const mine = project(roster, 'mine'), opponent = project(opponentRoster, 'opponent');
  const baseline = needs(mine, opponent, phi), pairs = [];
  const protectedSet = new Set(protectedNames.map(normalizeName));
  const describe = (p, from) => ({ name: p.name, nbaTeam: p.nbaTeam, status: p.status ?? null,
    espnId: p.espnId, games: gamesLeft(p, schedule, from, window.end) });
  for (const pickup of freeAgents.filter((p) => p.prior && !BLOCKED.includes(p.status))) {
    const start = pickupStart(pickup, fromDate, window, addsFrom);
    for (const drop of roster.filter((p) => p.prior && !protectedSet.has(normalizeName(p.name)))) {
      const after = project(roster, 'mine', { pickup, drop, start });
      const result = needs(after, opponent, phi);
      const changes = Object.fromEntries(Object.keys(baseline.categories).map((c) => [c, {
        total: after.totals[c] - mine.totals[c], pWin: result.categories[c].pWin - baseline.categories[c].pWin,
      }]));
      pairs.push({ pickup: describe(pickup, start), drop: describe(drop, fromDate), pickupStart: start,
        changes, score: result.expectedCategories - baseline.expectedCategories });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const addsLeft = Math.max(0, (snapshot.settings.maxAddsPerWeek ?? 4) - snapshot.team.addsUsedThisWeek);
  const suggestions = [], pickups = new Set(), drops = new Set();
  for (const pair of pairs) {
    if (suggestions.length >= addsLeft) break;
    const pickup = normalizeName(pair.pickup.name), drop = normalizeName(pair.drop.name);
    if (pair.score <= 0 || pickups.has(pickup) || drops.has(drop)) continue;
    suggestions.push(pair);
    pickups.add(pickup); drops.add(drop);
  }
  return { asOf: snapshot.asOf, week: snapshot.matchup.week, window, fromDate, addsFrom, addsLeft,
    notes: ['v0 ignores positional eligibility; games already played toward the cap are unknown.',
      'Pairs are scored independently against the current roster.',
      'Expected categories are an approximation for H2H most categories; matchup/title win probabilities are unavailable.'],
    baseline, suggestions, topPairs: pairs.slice(0, top), unscored };
}
