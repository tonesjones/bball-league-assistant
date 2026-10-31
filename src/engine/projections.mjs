const STATS = ['fgm', 'fga', 'ftm', 'fta', 'fg3m', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'];

function scale(prior, minutes) {
  return { ...prior.perGame, ...Object.fromEntries(STATS.map((stat) => [stat, (prior.perGame[stat] ?? 0) * minutes / prior.mpg])) };
}

const isUsable = (prior) => prior?.perGame?.g > 0 && Number.isFinite(prior.mpg) && prior.mpg > 0
  && STATS.every((stat) => Number.isFinite(prior.perGame[stat]));

export function projectPlayers(priors, ids, logs, { k = 2, asOf = null, minGames = 5, minMinutes = 100 } = {}) {
  if (!Number.isFinite(k) || k <= 0) throw new Error('minutes k must be positive and finite');
  const byPrior = new Map(ids.players.filter((p) => p.priorName).map((p) => [p.priorName, String(p.espnId)]));
  const byId = new Map();
  const seen = new Set();
  for (const row of logs) {
    const key = `${row.espnId}/${row.espnEventId}/${row.date}`;
    if (seen.has(key)) throw new Error(`duplicate game log: ${key}`);
    seen.add(key);
    if (row.didNotPlay && row.reason !== "COACH'S DECISION") continue;
    const min = row.didNotPlay ? 0 : row.min;
    if (!Number.isFinite(min) || min < 0) throw new Error(`invalid minutes in game log: ${key}`);
    const id = String(row.espnId);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ ...row, min });
  }
  const players = priors.map((prior) => {
    const rows = byId.get(byPrior.get(prior.name)) ?? [];
    const games = rows.length, total = rows.reduce((sum, row) => sum + row.min, 0);
    const usable = isUsable(prior);
    const mpg = usable ? (k * prior.mpg + total) / (k + games) : null;
    const minutes = { games, starts: rows.filter((row) => row.starter && !row.didNotPlay).length,
      prior: prior.mpg ?? null, season: games ? total / games : null, projected: mpg, asOf };
    const played = rows.filter((row) => !row.didNotPlay);
    const playedMinutes = played.reduce((sum, row) => sum + row.min, 0);
    const complete = playedMinutes > 0 && played.every((row) => STATS.every((stat) => Number.isFinite(row[stat]) && row[stat] >= 0));
    const observedSum = complete ? Object.fromEntries(STATS.map((stat) => [stat,
      played.reduce((sum, row) => sum + row[stat], 0)])) : null;
    const priorMinutes = usable ? k * prior.mpg : null;
    const rates = { status: !played.length ? 'no-games' : complete ? 'observed' : 'unavailable',
      games: played.length, minutes: playedMinutes, asOf, priorMinutes,
      observedPerMinute: complete ? Object.fromEntries(STATS.map((stat) => [stat,
        observedSum[stat] / playedMinutes])) : null,
      perMinute: usable && complete ? Object.fromEntries(STATS.map((stat) => [stat,
        (k * prior.perGame[stat] + observedSum[stat]) / (priorMinutes + playedMinutes)])) : null };
    const perGame = !usable ? null : rates.perMinute
      ? { ...prior.perGame, ...Object.fromEntries(STATS.map((stat) => [stat, rates.perMinute[stat] * mpg])) }
      : scale(prior, mpg);
    return { ...prior, source: 'prior', original: prior, mpg, minutes, rates, perGame };
  });
  const priorByName = new Map(priors.map((prior) => [prior.name, prior]));
  const seasonOnly = ids.players.filter((p) => p.espnId != null && !isUsable(priorByName.get(p.priorName)))
    .map((p) => String(p.espnId)).filter((id, i, all) => all.indexOf(id) === i).sort()
    .flatMap((id) => {
      const rows = byId.get(id) ?? [];
      const games = rows.length, total = rows.reduce((sum, row) => sum + row.min, 0);
      if (games < minGames && total < minMinutes) return [];
      const stat = (row, key) => row.didNotPlay ? 0 : row[key];
      if (!rows.every((row) => STATS.every((key) => Number.isFinite(stat(row, key)) && stat(row, key) >= 0))) return [];
      const mpg = total / games;
      const perGame = { ...Object.fromEntries(STATS.map((key) => [key, rows.reduce((sum, row) => sum + stat(row, key), 0) / games])), g: games };
      return [{ name: `espn:${id}`, espnId: id, source: 'season-only', perGame, mpg,
        minutes: { games, starts: rows.filter((row) => row.starter && !row.didNotPlay).length,
          prior: null, season: mpg, projected: mpg, asOf }, original: null, rates: null }];
    });
  return { players: [...players, ...seasonOnly], k, asOf, version: 'current-season-rates-v4' };
}

// These endpoints deliberately stay fixed; more games update the blend, not the prior endpoint.
export function minutesCase(player, mode, rateMode = 'prior') {
  if (!player?.original || !player.perGame) return player;
  const mpg = mode === 'prior' ? player.minutes.prior : player.minutes.season ?? player.minutes.prior;
  const perGame = rateMode === 'season' && player.rates?.perMinute
    ? { ...player.perGame, ...Object.fromEntries(STATS.map((stat) => [stat, player.rates.perMinute[stat] * mpg])) }
    : scale(player.original, mpg);
  return { ...player, mpg, perGame };
}
