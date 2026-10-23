const STATS = ['fgm', 'fga', 'ftm', 'fta', 'fg3m', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'];

function scale(prior, minutes) {
  return { ...prior.perGame, ...Object.fromEntries(STATS.map((stat) => [stat, (prior.perGame[stat] ?? 0) * minutes / prior.mpg])) };
}

export function projectPlayers(priors, ids, logs, { k = 2, asOf = null } = {}) {
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
    const usable = prior.perGame?.g > 0 && Number.isFinite(prior.mpg) && prior.mpg > 0
      && STATS.every((stat) => Number.isFinite(prior.perGame[stat]));
    const mpg = usable ? (k * prior.mpg + total) / (k + games) : null;
    const minutes = { games, starts: rows.filter((row) => row.starter && !row.didNotPlay).length,
      prior: prior.mpg ?? null, season: games ? total / games : null, projected: mpg, asOf };
    return { ...prior, original: prior, mpg, minutes, perGame: usable ? scale(prior, mpg) : null };
  });
  return { players, k, asOf, version: 'minutes-pseudogames-v1' };
}

// These endpoints deliberately stay fixed; more games update the blend, not the prior endpoint.
export function minutesCase(player, mode) {
  if (!player?.original || !player.perGame) return player;
  const mpg = mode === 'prior' ? player.minutes.prior : player.minutes.season ?? player.minutes.prior;
  return { ...player, mpg, perGame: scale(player.original, mpg) };
}
