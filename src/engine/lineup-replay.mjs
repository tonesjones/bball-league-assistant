export const STATS = ['fgm', 'fga', 'ftm', 'fta', 'fg3m', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'];
export const zeroLine = () => Object.fromEntries(STATS.map((k) => [k, 0]));
export const categoryTotals = (line) => ({ PTS: line.pts, REB: line.reb, AST: line.ast,
  STL: line.stl, BLK: line.blk, '3PM': line.fg3m, TO: line.to,
  'FG%': line.fga ? line.fgm / line.fga : 0, 'FT%': line.fta ? line.ftm / line.fta : 0 });

// A missing player row is not a DNP. Only an explicit DNP supplies known zero production.
export function replayLineups(entry, lines, { to }) {
  const plan = entry.lineups, reasons = [];
  const unscored = () => ({ status: 'unscored', reasons: [...new Set(reasons)], gain: null, gamesPlayed: null });
  if (!plan || !['baseline', 'proposed', 'opponent'].every((k) => Array.isArray(plan[k]))) {
    reasons.push('No saved source-specific lineups; historical rehearsal cannot be reconstructed as a scored decision.');
    return unscored();
  }
  if (!to || to < plan.through) reasons.push('The full decision window has not been supplied.');
  const index = new Map();
  for (const row of lines) {
    const key = `${row.date}/${row.espnId}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  const sum = (starts, from) => {
    const result = { line: zeroLine(), games: [] }, seen = new Set();
    for (const start of starts) {
      if (start.date < from || start.date > plan.through) continue;
      const key = `${start.date}/${start.espnId}`;
      if (seen.has(key)) { reasons.push(`Duplicate saved start: ${start.name} on ${start.date}`); continue; }
      seen.add(key);
      const rows = start.espnId == null ? [] : index.get(key) ?? [];
      if (rows.length !== 1) { reasons.push(`${rows.length ? 'Ambiguous' : 'Missing'} result: ${start.name} on ${start.date}`); continue; }
      const row = rows[0];
      if (row.didNotPlay === true) continue;
      if (row.didNotPlay !== false || !STATS.every((k) => Number.isFinite(row[k]) && row[k] >= 0)) {
        reasons.push(`Incomplete production/shooting: ${start.name} on ${start.date}`); continue;
      }
      result.games.push(String(start.espnId));
      for (const k of STATS) result.line[k] += row[k];
    }
    return result;
  };
  const baseline = sum(plan.baseline, plan.from), opponent = sum(plan.opponent, plan.from);
  const proposed = sum(entry.decision === 'hold' ? plan.baseline : plan.proposed, plan.from);
  const before = sum(plan.baseline, entry.start), after = sum(entry.decision === 'hold' ? plan.baseline : plan.proposed, entry.start);
  const full = (side, projected) => {
    const banked = plan.banked?.[side];
    if (!banked || !STATS.every((k) => Number.isFinite(banked[k]) && banked[k] >= 0)) {
      reasons.push(`Missing banked production/shooting: ${side}`);
      return null;
    }
    return Object.fromEntries(STATS.map((k) => [k, banked[k] + projected.line[k]]));
  };
  const baseLine = full('mine', baseline), opponentLine = full('opponent', opponent);
  if (reasons.length) return unscored();
  const delta = (k) => after.line[k] - before.line[k];
  const gain = { ...Object.fromEntries(Object.entries({ PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', '3PM': 'fg3m' }).map(([c, k]) => [c, delta(k)])),
    TO: -delta('to'), 'FG%': { makes: delta('fgm'), attempts: delta('fga') }, 'FT%': { makes: delta('ftm'), attempts: delta('fta') } };
  return { status: 'scored', reasons: [], gain,
    gamesPlayed: { add: after.games.filter((id) => id === String(entry.add?.espnId)).length,
      drop: before.games.filter((id) => id === String(entry.drop?.espnId)).length },
    replayed: { baseline: baseline.line, proposed: proposed.line, opponent: opponent.line },
    finalTotals: { mine: categoryTotals(baseLine), opponent: categoryTotals(opponentLine) },
    finalVolume: { mine: baseLine, opponent: opponentLine } };
}
