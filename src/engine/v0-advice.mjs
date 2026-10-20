import { findPlayer, normalizeName } from './names.mjs';
import { tomorrow } from './weeks.mjs';
import { gamesLeft } from './games-left.mjs';
import { BLOCKED, projectTeam, needs } from './needs.mjs';
import { seasonValues } from './season-value.mjs';

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
  fromDate = tomorrow(snapshot.asOf), addsFrom = fromDate, top = 10, phi,
  seasonMargin = 0, protectRank = 120, poolSize = 150, volumeStatus = {}, holdBelow = 0.15 } = {}) {
  if (!Number.isFinite(holdBelow) || holdBelow < 0) throw new Error('holdBelow must be a nonnegative finite number');
  const window = { start: snapshot.matchup.start, end: snapshot.matchup.end };
  const banked = fromDate > window.start;
  const shootingVolume = Object.fromEntries(['mine', 'opponent'].map((side) => [side,
    !banked ? { status: 'matched', reason: 'no banked days' }
      : !['fgm', 'fga', 'ftm', 'fta'].every((k) => Number.isFinite(snapshot.matchup.volume?.[side]?.[k]))
        ? { ...volumeStatus[side], status: 'unknown', reason: volumeStatus[side]?.reason ?? 'banked makes and attempts unavailable' }
        : volumeStatus[side] ?? { status: 'reported' }]));
  const unknownVolume = Object.entries(shootingVolume).filter(([, v]) => v.status === 'unknown');
  const scoring = { shootingKnown: !unknownVolume.length };
  const shootingNotes = unknownVolume.length
    ? [`FG% and FT% are not scored: ${unknownVolume.map(([side, v]) => `${side}: ${v.reason}`).join('; ')}.`]
    : banked && Object.values(shootingVolume).some((v) => v.status === 'matched')
      ? ['Banked shooting volume was rebuilt from game logs and matched Yahoo totals.'] : [];
  if (banked && Object.values(shootingVolume).some((v) => v.status === 'matched')) {
    shootingNotes.push('Shooting volume assumes every open lineup slot was filled.');
  }
  const unscored = [], priorByName = new Map(priors.map((p) => [p.name, p]));
  const values = seasonValues(priors, { poolSize });
  const match = (players, where) => players.map((p) => {
    const { player, reason } = findPlayer(ids.players, p.name, p.nbaTeam);
    const prior = priorByName.get(player?.priorName);
    const season = values.get(player?.priorName);
    const unscoredReason = reason ?? (prior?.perGame ? 'no games in prior' : 'no prior');
    if (!season) unscored.push({ ...p, where, reason: unscoredReason });
    return { ...p, espnId: player?.espnId ?? null, prior: season ? prior : null,
      season: season ? { value: season.value, rank: season.rank } : null, unscoredReason };
  });
  const roster = match(snapshot.team.roster, 'roster');
  const opponentRoster = match(snapshot.matchup.opponentRoster, 'opponent');
  const freeAgents = match(snapshot.freeAgents, 'freeAgent');
  const project = (players, side, swap) => projectTeam(players, snapshot.matchup.totals?.[side],
    snapshot.matchup.volume?.[side], snapshot.settings, schedule, fromDate, window.end, swap);
  const mine = project(roster, 'mine'), opponent = project(opponentRoster, 'opponent');
  const baseline = needs(mine, opponent, phi, scoring), pairs = [];
  const protectedSet = new Set(protectedNames.map(normalizeName));
  const guardrail = { seasonMargin, protectRank, poolSize, blockedPairs: 0,
    protectedByRank: roster.filter((p) => p.season && p.season.rank <= protectRank)
      .map((p) => ({ name: p.name, ...p.season })).sort((a, b) => a.rank - b.rank),
    protectedNoPrior: roster.filter((p) => !p.season)
      .map((p) => ({ name: p.name, nbaTeam: p.nbaTeam, reason: p.unscoredReason })),
  };
  const describe = (p, from) => ({ name: p.name, nbaTeam: p.nbaTeam, status: p.status ?? null,
    espnId: p.espnId, games: gamesLeft(p, schedule, from, window.end),
    seasonValue: p.season.value, seasonRank: p.season.rank });
  for (const pickup of freeAgents.filter((p) => p.prior && !BLOCKED.includes(p.status))) {
    const start = pickupStart(pickup, fromDate, window, addsFrom);
    for (const drop of roster.filter((p) => !protectedSet.has(normalizeName(p.name)))) {
      if (!drop.season || drop.season.rank <= protectRank
        || pickup.season.value < drop.season.value + seasonMargin) {
        guardrail.blockedPairs++;
        continue;
      }
      const after = project(roster, 'mine', { pickup, drop, start });
      const result = needs(after, opponent, phi, scoring);
      const changes = Object.fromEntries(Object.keys(baseline.categories).filter((c) => baseline.categories[c].label !== 'unknown').map((c) => [c, {
        total: after.totals[c] - mine.totals[c], pWin: result.categories[c].pWin - baseline.categories[c].pWin,
      }]));
      pairs.push({ pickup: describe(pickup, start), drop: describe(drop, fromDate), pickupStart: start,
        unknownGames: after.unknownGames, changes, score: result.expectedCategories - baseline.expectedCategories });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const addsLeft = Math.max(0, (snapshot.settings.maxAddsPerWeek ?? 4) - snapshot.team.addsUsedThisWeek);
  const best = pairs[0] ?? null;
  const decision = !addsLeft ? { action: 'hold', reason: 'No adds left this week.', best }
    : !best ? { action: 'hold', reason: 'No eligible add/drop pairs.', best }
      : best.score <= 0 || best.score < holdBelow
        ? { action: 'hold', reason: `Best move gains ${best.score.toFixed(3)} expected categories; requires a positive gain of at least ${holdBelow}.`, best }
        : { action: 'move', pair: best };
  return { asOf: snapshot.asOf, week: snapshot.matchup.week, window, fromDate, addsFrom, addsLeft,
    volumeStatus: shootingVolume,
    unknownGames: { mine: mine.unknownGames, opponent: opponent.unknownGames }, holdBelow,
    notes: [...shootingNotes, ...(snapshot.settings.maxGamesPerWeek != null ? ['The games cap ignores games already used this week; those are unknown.'] : []),
      'After making the move, refresh the league and rerun; the other pairs were scored against the current roster.',
      'Season guardrail: never drops a player with no prior or ranked within the protect rank, and a pickup needs season value at least the drop value plus the margin.',
      'Expected categories are an approximation for H2H most categories; matchup/title win probabilities are unavailable.'],
    baseline, decision, topPairs: pairs.slice(0, top), unscored, guardrail };
}
