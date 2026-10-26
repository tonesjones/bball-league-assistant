import { projectPlayers } from './projections.mjs';
import { addDays } from './weeks.mjs';

const stats = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks',
  to: 'turnovers', fg3m: 'threePointFieldGoalsMade', fgm: 'fieldGoalsMade', fga: 'fieldGoalsAttempted',
  ftm: 'freeThrowsMade', fta: 'freeThrowsAttempted' };
const categories = { PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', '3PM': 'fg3m', TO: 'to', 'FG%': null, 'FT%': null };

export function evaluateWeights(players, starts, grid, fixedScales = null) {
  const models = ['season-average', 'prior-only', ...grid];
  const sums = Object.fromEntries(models.map((m) => [m, Object.fromEntries(Object.keys(categories).map((c) => [c, 0]))]));
  const counts = Object.fromEntries(Object.keys(categories).map((c) => [c, 0]));
  const byWeek = [], sampleCounts = [];
  for (const start of starts) {
    const weekly = Object.fromEntries(models.map((m) => [m, Object.fromEntries(Object.keys(categories).map((c) => [c, 0]))]));
    const weekCounts = { ...counts }; for (const k of Object.keys(weekCounts)) weekCounts[k] = 0;
    let samples = 0;
    for (const { prior, logs } of players) {
      const history = logs.filter((g) => g.date < start), future = logs.filter((g) => g.date >= start && g.date <= addDays(start, 6));
      if (!history.length || !future.length) continue;
      samples++;
      const total = (rows) => Object.fromEntries(Object.keys(stats).map((k) => [k, rows.reduce((n, g) => n + g[k], 0)]));
      const actual = total(future), historySum = total(history);
      const predictions = { 'season-average': Object.fromEntries(Object.keys(stats).map((k) => [k, historySum[k] / history.length])), 'prior-only': prior.perGame };
      for (const k of grid) predictions[k] = projectPlayers([prior], { players: [{ espnId: prior.id, priorName: prior.name }] }, history, { k }).players[0].perGame;
      for (const [category, stat] of Object.entries(categories)) {
        const shooting = category === 'FG%' ? ['fgm', 'fga'] : category === 'FT%' ? ['ftm', 'fta'] : null;
        if (shooting && (!actual[shooting[1]] || models.some((m) => !predictions[m][shooting[1]]))) continue;
        counts[category]++; weekCounts[category]++;
        for (const model of models) {
          const p = predictions[model];
          const error = shooting ? Math.abs(p[shooting[0]] / p[shooting[1]] - actual[shooting[0]] / actual[shooting[1]])
            : Math.abs(p[stat] * future.length - actual[stat]);
          sums[model][category] += error; weekly[model][category] += error;
        }
      }
    }
    sampleCounts.push({ start, samples }); byWeek.push({ start, sums: weekly, counts: weekCounts });
  }
  if (Object.values(counts).some((n) => !n)) throw new Error('Empty evaluation category');
  const mae = Object.fromEntries(models.map((m) => [m, Object.fromEntries(Object.keys(categories).map((c) => [c, sums[m][c] / counts[c]]))]));
  const scales = fixedScales ?? mae['season-average'];
  if (Object.keys(categories).some((c) => !Number.isFinite(scales[c]) || scales[c] <= 0)) throw new Error('Invalid calibration scale');
  const macro = Object.fromEntries(models.map((m) => [m, Object.keys(categories).reduce((n, c) => n + mae[m][c] / scales[c], 0) / Object.keys(categories).length]));
  if (Object.values(macro).some((v) => !Number.isFinite(v))) throw new Error('Invalid calibration score');
  return { counts, sampleCounts, mae, macro, scales, byWeek };
}
