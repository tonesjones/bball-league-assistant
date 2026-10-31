import { normalizeName } from './names.mjs';
import { addDays, tomorrow } from './weeks.mjs';
import { gamesLeft } from './games-left.mjs';
import { rosterCrunch } from './crunch.mjs';
import { BLOCKED, STAT, projectTeam, needs, strongLine, openRosterSpots } from './needs.mjs';
import { MODEL_VERSION, monthDay, pickupStart, normalizeRoles, matchPlayers, dropBlock } from './advice-common.mjs';
import { minutesCase } from './projections.mjs';
import { applyPreferences } from './preferences.mjs';

export { MODEL_VERSION, pickupStart, normalizeRoles };

export function advise(snapshot, { ids, priors, schedule, roles = {}, protectedNames = [],
  fromDate = tomorrow(snapshot.asOf), addsFrom = fromDate, top = 10, phi,
  seasonMargin = 0, protectRank = 120, poolSize = 150, volumeStatus = {}, holdBelow = 0.15, addOnlyBelow = 0.05, projections = null, preferences = null } = {}) {
  if (projections) priors = projections.players;
  let preferenceNotes = [];
  if (preferences) ({ snapshot, notes: preferenceNotes } = applyPreferences(snapshot, preferences));
  if (!Number.isFinite(holdBelow) || holdBelow < 0) throw new Error('holdBelow must be a nonnegative finite number');
  if (!Number.isFinite(addOnlyBelow) || addOnlyBelow < 0) throw new Error('addOnlyBelow must be a nonnegative finite number');
  const window = { start: snapshot.matchup.start, end: snapshot.matchup.end };
  const banked = fromDate > window.start;
  const shootingVolume = Object.fromEntries(['mine', 'opponent'].map((side) => [side,
    !banked ? { status: 'matched', reason: 'no banked days' }
      : !['fgm', 'fga', 'ftm', 'fta'].every((k) => Number.isFinite(snapshot.matchup.volume?.[side]?.[k]))
        ? { ...volumeStatus[side], status: 'unknown', reason: volumeStatus[side]?.reason ?? 'banked makes and attempts unavailable' }
        : volumeStatus[side] ?? { status: 'reported' }]));
  const unknownVolume = Object.entries(shootingVolume).filter(([, v]) => v.status === 'unknown');
  const unknownCounting = banked ? Object.keys(STAT).filter((c) =>
    ['mine', 'opponent'].some((side) => snapshot.matchup.totals?.[side]?.[c] === null)) : [];
  const scoring = { shootingKnown: !unknownVolume.length, unknownCategories: unknownCounting };
  const shootingNotes = unknownVolume.length
    ? [`FG% and FT% are not scored: ${unknownVolume.map(([side, v]) => `${side}: ${v.reason}`).join('; ')}.`]
    : banked && Object.values(shootingVolume).some((v) => v.status === 'matched')
      ? ['Banked shooting volume was rebuilt from game logs and matched Yahoo totals.'] : [];
  if (banked && Object.values(shootingVolume).some((v) => v.status === 'matched')) {
    shootingNotes.push('Shooting volume assumes every open lineup slot was filled.');
  }
  const { match, unscored } = matchPlayers({ ids, priors, poolSize });
  const roster = match(snapshot.team.roster, 'roster');
  const opponentRoster = match(snapshot.matchup.opponentRoster, 'opponent');
  const freeAgents = match(snapshot.freeAgents, 'freeAgent');
  const project = (players, side, swap, fill = null) => projectTeam(players, snapshot.matchup.totals?.[side],
    snapshot.matchup.volume?.[side], snapshot.settings, schedule, fromDate, window.end, swap, fill);
  const mine = project(roster, 'mine'), opponent = project(opponentRoster, 'opponent');
  let fill;
  const filled = (players, side, zero, swap) => zero.unknownGames
    ? project(players, side, swap, fill ??= strongLine(priors, { poolSize })) : zero;
  const mineScenarios = [mine, filled(roster, 'mine', mine)];
  const opponentScenarios = [opponent, filled(opponentRoster, 'opponent', opponent)];
  const outlooks = (lineups) => lineups.flatMap((m) => opponentScenarios.map((o) => needs(m, o, phi, scoring)));
  const range = (numbers) => [Math.min(...numbers), Math.max(...numbers)];
  const baselines = outlooks(mineScenarios), baseline = baselines[0], pairs = [], afterByPair = new Map(), swapByPair = new Map();
  // Pending claims are assumed to go through: their adds and open spots are reserved, claimed
  // players aren't offered, and pending drops aren't offered as drops.
  const pendingClaims = (snapshot.team.pending?.waivers ?? []).map((w) => ({ ...w, date: monthDay(w.date, window, 'pending claim date') }));
  const claimed = new Set(pendingClaims.map((w) => normalizeName(w.add)));
  const pendingDrops = new Set(pendingClaims.filter((w) => w.drop).map((w) => normalizeName(w.drop)));
  const reservedAdds = pendingClaims.filter((w) => w.date <= window.end).length;
  const spotsBefore = openRosterSpots(snapshot.settings, snapshot.team.roster), addOnlyClaims = pendingClaims.filter((w) => !w.drop).length;
  const addsBefore = Math.max(0, (snapshot.settings.maxAddsPerWeek ?? 4) - snapshot.team.addsUsedThisWeek);
  const openSpots = Math.max(0, spotsBefore - addOnlyClaims);
  for (const [c, category] of Object.entries(baseline.categories)) {
    category.pWinRange = category.label === 'unknown' ? null : range(baselines.map((b) => b.categories[c].pWin));
    category.complete = category.pWinRange != null && category.pWinRange[1] - category.pWinRange[0] < 1e-12;
  }
  baseline.expectedRange = range(baselines.map((b) => b.expectedCategories));
  const roleNames = normalizeRoles(roles, protectedNames);
  const coreSet = new Set(roleNames.core.map(normalizeName)), streamSet = new Set(roleNames.stream.map(normalizeName));
  const isNormal = (p) => !coreSet.has(normalizeName(p.name)) && !streamSet.has(normalizeName(p.name));
  const guardrail = { seasonMargin, protectRank, poolSize, blockedPairs: 0,
    ...roleNames, blockedByRule: { core: 0, ilCapacity: 0, lineupLock: 0, noPrior: 0, rank: 0, seasonValue: 0 },
    protectedByRank: roster.filter((p) => isNormal(p) && p.season && p.season.rank <= protectRank)
      .map((p) => ({ name: p.name, ...p.season })).sort((a, b) => a.rank - b.rank),
    protectedNoPrior: roster.filter((p) => isNormal(p) && !p.season)
      .map((p) => ({ name: p.name, nbaTeam: p.nbaTeam, reason: p.unscoredReason })),
  };
  const describe = (p, from) => ({ name: p.name, nbaTeam: p.nbaTeam, status: p.status ?? null,
    espnId: p.espnId, games: gamesLeft(p, schedule, from, window.end),
    minutes: p.minutes,
    rates: p.rates,
    seasonValue: p.season?.value ?? null, seasonRank: p.season?.rank ?? null });
  const drops = roster.filter((p) => !pendingDrops.has(normalizeName(p.name)));
  for (const pickup of freeAgents.filter((p) => p.prior && !BLOCKED.includes(p.status) && !claimed.has(normalizeName(p.name)))) {
    const start = pickupStart(pickup, fromDate, window, addsFrom);
    // A null drop is an add-only move into an open roster spot; the drop guardrail doesn't apply.
    for (const drop of [...(openSpots > 0 ? [null] : []), ...drops]) {
      const name = drop && normalizeName(drop.name);
      const dropRole = !drop ? 'open-slot' : streamSet.has(name) ? 'stream' : 'normal';
      const blocked = dropBlock(drop, pickup, start, { coreSet, streamSet, openSpots, protectRank, seasonMargin });
      if (blocked) {
        guardrail.blockedPairs++;
        guardrail.blockedByRule[blocked]++;
        continue;
      }
      const swap = { pickup, drop, start };
      const automatic = project(roster, 'mine', swap);
      const startedPickup = project(roster, 'mine', { ...swap, startPickup: true });
      const pickupStarts = (lineup) => lineup.started.filter((g) => g.name === pickup.name).length;
      const automaticPickupStarts = pickupStarts(automatic);
      const deliberatelyStart = pickupStarts(startedPickup) > automaticPickupStarts;
      const after = deliberatelyStart ? startedPickup : automatic;
      const results = outlooks([after, filled(roster, 'mine', after, { ...swap, startPickup: deliberatelyStart })]);
      const result = results[0];
      const nominalScores = results.map((r, i) => r.expectedCategories - baselines[i].expectedCategories);
      const minuteScenarios = [], rateScenarios = [];
      const pickupRates = pickup.rates?.status === 'observed' ? ['prior', 'season'] : ['prior'];
      const dropRates = !drop ? [null] : drop.rates?.status === 'observed' ? ['prior', 'season'] : ['prior'];
      if (projections) for (const pickupRate of pickupRates) for (const dropRate of dropRates)
      for (const pickupMode of ['prior', 'season']) for (const dropMode of drop ? ['prior', 'season'] : [null]) {
        const casePickup = { ...pickup, prior: minutesCase(pickup.prior, pickupMode, pickupRate) };
        const caseDrop = drop && { ...drop, prior: minutesCase(drop.prior, dropMode, dropRate) };
        const caseRoster = drop ? roster.map((p) => p === drop ? caseDrop : p) : roster;
        const caseSwap = { pickup: casePickup, drop: caseDrop, start };
        const before = project(caseRoster, 'mine');
        const caseBaselines = outlooks([before, filled(caseRoster, 'mine', before)]);
        const auto = project(caseRoster, 'mine', caseSwap);
        const deliberate = project(caseRoster, 'mine', { ...caseSwap, startPickup: true });
        const force = pickupStarts(deliberate) > pickupStarts(auto);
        const proposed = force ? deliberate : auto;
        const caseResults = outlooks([proposed, filled(caseRoster, 'mine', proposed, { ...caseSwap, startPickup: force })]);
        const scenarios = pickupRate === 'prior' && dropRate !== 'season' ? minuteScenarios : rateScenarios;
        scenarios.push({ pickupMode, dropMode, pickupRate, dropRate, pickupMpg: casePickup.prior?.mpg ?? null,
          dropMpg: caseDrop?.prior?.mpg ?? null,
          scoreRange: range(caseResults.map((r, i) => r.expectedCategories - caseBaselines[i].expectedCategories)),
          baselineStarted: before.started, proposedStarted: proposed.started });
      }
      // Starts the move takes from players who stay on the roster, in either lineup mode.
      const startedKeys = new Set(after.started.map((g) => `${g.date}\0${g.name}`));
      const displaced = mine.started.filter((g) => g.name !== drop?.name && !startedKeys.has(`${g.date}\0${g.name}`))
        .map(({ name, date }) => ({ name, date }));
      const changes = Object.fromEntries(Object.keys(baseline.categories).filter((c) => baseline.categories[c].label !== 'unknown').map((c) => [c, {
        total: after.totals[c] - mine.totals[c], pWin: result.categories[c].pWin - baseline.categories[c].pWin,
      }]));
      const pair = { pickup: describe(pickup, start), drop: drop && describe(drop, fromDate), dropRole, pickupStart: start,
        unknownGames: after.unknownGames, lineup: { mode: deliberatelyStart ? 'start-pickup' : 'automatic',
          automaticPickupStarts, pickupStarts: pickupStarts(after),
          displaced, started: after.started },
        changes, score: result.expectedCategories - baseline.expectedCategories,
        minuteScenarios, rateScenarios,
        missingRates: [pickup, drop].filter((p) => p?.rates?.status === 'unavailable').map((p) => p.name),
        scoreRange: range([...nominalScores, ...minuteScenarios.flatMap((s) => s.scoreRange), ...rateScenarios.flatMap((s) => s.scoreRange)]) };
      pairs.push(pair);
      afterByPair.set(pair, after);
      swapByPair.set(pair, swap);
    }
  }
  pairs.sort((a, b) => b.scoreRange[0] - a.scoreRange[0] || b.score - a.score);
  const addsLeft = Math.max(0, addsBefore - reservedAdds);
  const best = [...pairs].sort((a, b) => b.scoreRange[1] - a.scoreRange[1])[0] ?? null;
  const bar = (pair) => pair.drop ? { kind: 'drop', value: holdBelow } : { kind: 'add-only', value: addOnlyBelow };
  const robust = pairs.filter((p) => !p.missingRates.length && p.scoreRange[0] > 0 && p.score >= bar(p).value)
    .sort((a, b) => b.score - a.score)[0];
  const missing = (pair) => ['mine', 'opponent'].flatMap((side) => {
    const players = side === 'mine' ? roster : opponentRoster;
    const lineups = side === 'mine' ? [mine, afterByPair.get(pair)] : [opponent];
    const starts = new Map();
    for (const lineup of lineups) for (const g of lineup.unknownStarts) {
      if (!starts.has(g.name)) starts.set(g.name, new Set());
      starts.get(g.name).add(g.date);
    }
    return players.filter((p) => starts.has(p.name)).map((p) => ({ name: p.name, nbaTeam: p.nbaTeam,
      side, starts: starts.get(p.name).size, reason: p.unscoredReason })).sort((a, b) => a.name.localeCompare(b.name));
  });
  const decision = !addsLeft ? { action: 'hold', reason: reservedAdds ? 'No adds left this week after pending claims.' : 'No adds left this week.', best }
    : !best ? { action: 'hold', reason: 'No eligible moves.', best }
      : robust ? { action: 'move', pair: robust, bar: bar(robust) }
        : best.scoreRange[1] > 0 && best.scoreRange[1] >= bar(best).value && (best.scoreRange[0] <= 0 || best.missingRates.length)
          ? { action: 'insufficient', reason: `${projections ? 'Minutes, current-season per-minute production, or missing evidence' : 'Missing projections'} can make the best move lose (worst case ${best.scoreRange[0].toFixed(3)} expected categories); a move must gain in every case and at least ${bar(best).value} nominally (${bar(best).kind} bar).`, best, bar: bar(best), missing: missing(best) }
          : { action: 'hold', reason: best.scoreRange[0] > 0 && !best.missingRates.length
            ? `Best move gains ${best.score.toFixed(3)} expected categories nominally, positive in every case; requires at least ${bar(best).value} (${bar(best).kind} bar).`
            : `Best move gains at most ${best.scoreRange[1].toFixed(3)} expected categories; requires a positive gain of at least ${bar(best).value} (${bar(best).kind} bar).`, best, bar: bar(best) };
  // Context only: next week's games and legal starts never change the score or the decision.
  const nextWeek = { start: addDays(window.end, 1), end: addDays(window.end, 7) };
  for (const pair of new Set([...pairs.slice(0, top), best, robust])) if (pair) {
    const swap = swapByPair.get(pair), start = [nextWeek.start, pair.pickupStart].sort().at(-1);
    const lineup = projectTeam(roster, {}, {}, snapshot.settings, schedule, nextWeek.start, nextWeek.end,
      { ...swap, start, startPickup: true });
    pair.nextWeek = { ...nextWeek, games: gamesLeft(swap.pickup, schedule, start, nextWeek.end),
      starts: lineup.started.filter((g) => g.name === swap.pickup.name).length };
  }
  const crunchLines = Object.fromEntries(roster.filter((p) => p.prior).map((p) => [p.name, p.prior.perGame]));
  const crunch = { current: rosterCrunch({ snapshot, schedule, lines: crunchLines, fromDate, endDate: window.end }),
    nextWeek: rosterCrunch({ snapshot, schedule, lines: crunchLines, fromDate: nextWeek.start, endDate: nextWeek.end }) };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const pending = { waivers: pendingClaims, reservedAdds, proposedTrades: snapshot.team.pending?.proposedTrades ?? 0,
    unlisted: snapshot.team.pending?.unlisted ?? 0,
    warning: reservedAdds > addsBefore || addOnlyClaims > Math.max(0, spotsBefore)
      ? `Pending claims need ${plural(reservedAdds, 'add')} this week and ${plural(addOnlyClaims, 'open spot')}, but only ${plural(addsBefore, 'add')} and ${plural(Math.max(0, spotsBefore), 'open spot')} are available. Yahoo processes claims in waiver order, so a later claim may fail.`
      : null };
  const others = pending.proposedTrades + pending.unlisted;
  return { asOf: snapshot.asOf, week: snapshot.matchup.week, window, fromDate, addsFrom, addsLeft, openSpots, pending,
    options: { fromDate, addsFrom, top, phi: phi ?? null, seasonMargin, protectRank, poolSize, holdBelow, addOnlyBelow, roles: roleNames,
      minutesK: projections?.k ?? null, preferences },
    projection: projections ? { version: projections.version, k: projections.k, asOf: projections.asOf } : null,
    volumeStatus: shootingVolume,
    unknownGames: { mine: mine.unknownGames, opponent: opponent.unknownGames }, holdBelow, addOnlyBelow,
    notes: [...preferenceNotes, ...shootingNotes,
      ...(unknownCounting.length ? [`${unknownCounting.join(', ')} not scored: banked counting totals are unknown for at least one team.`] : []),
      ...(snapshot.settings.maxGamesPerWeek != null ? ['The games cap ignores games already used this week; those are unknown.'] : []),
      'After making the move, refresh the league and rerun; the other pairs were scored against the current roster.',
      ...(pendingClaims.length ? [`Pending claims are assumed to go through: ${plural(reservedAdds, 'add')} this week and their open spots are reserved, claimed players and pending drops are not offered, and their production is not in the baseline.`] : []),
      ...(others ? [`${plural(others, 'other pending transaction')} (proposed trades or items the team page doesn't list) ${others === 1 ? 'is' : 'are'} not modeled.`] : []),
      ...(openSpots > 0 ? [`${openSpots} open roster spot${openSpots === 1 ? '' : 's'}: add-only moves need no drop and skip the drop guardrail.`] : []),
      'Next week shows the pickup\'s games and legal starts in the 7 days after this matchup, with the move applied and today\'s statuses. It is context only; the score ignores it.',
      'When the default prior-MPG lineup would bench a pickup, the advice evaluates legally starting that pickup instead. Starts the move takes from rostered players are shown as displaced.',
      'Unknown starts are scored at zero and at a strong rotation line (90th percentile of the top 150, 10th percentile TO); a move must win in both.',
      ...(projections ? [
        `Minutes and production blend: k=${projections.k} prior pseudo-games (starting value, not calibrated); equal weights. Nominal per-minute rates blend current-season production with k games of prior minutes; current-season weight grows with observed minutes.`,
        'Fixed prior-MPG and season-MPG cases are crossed for pickup/drop, alongside missing-production cases; a move must gain in every case, and its nominal score must reach the bar. These endpoints do not converge with more games.',
        'Pickup/drop sensitivity checks cross prior and blended current-season rates with minutes and missing-production cases. These checks can withhold a move even when the nominal blend favors it. No games uses the prior; incomplete observed box scores fall back to prior rates and withhold an otherwise supported move. Usage remains descriptive.',
      ] : ['Projections use prior-season production and do not capture current role changes or breakout upside.']),
      'Season guardrail: core players are never dropped; stream players bypass season checks. Other players need a prior, rank outside the protect rank, and pickup season value at least the drop value plus the margin.',
      'Expected categories are an approximation for H2H most categories; matchup/title win probabilities are unavailable.'],
    baseline, baselineLineups: { mine: mine.started, opponent: opponent.started },
    banked: Object.fromEntries(['mine', 'opponent'].map((side) => [side, {
      ...Object.fromEntries(Object.entries({ PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', '3PM': 'fg3m', TO: 'to' })
        .map(([c, k]) => [k, !banked ? 0 : snapshot.matchup.totals?.[side]?.[c] ?? null])),
      ...Object.fromEntries(['fgm', 'fga', 'ftm', 'fta'].map((k) => [k,
        !banked ? 0 : scoring.shootingKnown ? snapshot.matchup.volume?.[side]?.[k] : null])),
    }])),
    crunch, decision, topPairs: pairs.slice(0, top), unscored, guardrail };
}
