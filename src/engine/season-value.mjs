const STATS = { PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', '3PM': 'fg3m', TO: 'to' };
const CATEGORIES = [...Object.keys(STATS), 'FG%', 'FT%'];

// Recompute attempt-weighted shooting impact for each reference pool.
function score(players, pool) {
  const sum = (key) => pool.reduce((total, p) => total + (p.perGame[key] ?? 0), 0);
  const fgPct = sum('fga') ? sum('fgm') / sum('fga') : 0;
  const ftPct = sum('fta') ? sum('ftm') / sum('fta') : 0;
  const line = (p) => ({
    ...Object.fromEntries(Object.entries(STATS).map(([c, key]) => [c, (p.perGame[key] ?? 0) * (c === 'TO' ? -1 : 1)])),
    'FG%': (p.perGame.fgm ?? 0) - (p.perGame.fga ?? 0) * fgPct,
    'FT%': (p.perGame.ftm ?? 0) - (p.perGame.fta ?? 0) * ftPct,
  });
  const reference = pool.map(line);
  const moments = Object.fromEntries(CATEGORIES.map((c) => {
    const mean = reference.reduce((total, p) => total + p[c], 0) / pool.length;
    const sd = Math.sqrt(reference.reduce((total, p) => total + (p[c] - mean) ** 2, 0) / pool.length);
    return [c, { mean, sd }];
  }));
  return players.map((p) => {
    const raw = line(p);
    const z = Object.fromEntries(CATEGORIES.map((c) => [c, moments[c].sd ? (raw[c] - moments[c].mean) / moments[c].sd : 0]));
    return { name: p.name, games: p.perGame.g, z, perGameZ: Object.values(z).reduce((a, b) => a + b, 0) };
  });
}

export function seasonValues(priors, { poolSize = 150, fullSeasonGames = 70 } = {}) {
  const players = priors.filter((p) => p.perGame && p.perGame.g > 0);
  if (!players.length) return new Map();
  const first = score(players, players).sort((a, b) => b.perGameZ - a.perGameZ || a.name.localeCompare(b.name));
  const byName = new Map(players.map((p) => [p.name, p]));
  const pool = first.slice(0, Math.min(poolSize, players.length)).map((p) => byName.get(p.name));
  const values = score(players, pool).map((p) => ({ ...p,
    value: p.perGameZ > 0 ? p.perGameZ * Math.min(1, p.games / fullSeasonGames) : p.perGameZ,
  })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return new Map(values.map(({ name, ...p }, i) => [name, { ...p, rank: i + 1 }]));
}
