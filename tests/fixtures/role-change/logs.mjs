// Synthetic game logs for the role-change tests. Every name and ID is made up.
export const DATE = '2026-11-10';

const STAT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'to', 'fgm', 'fga', 'ftm', 'fta'];
const AVERAGE = { pts: 10, reb: 4, ast: 2, stl: 1, blk: 0, fg3m: 1, to: 2, fgm: 4, fga: 9, ftm: 1, fta: 2 };
export const BIG = { pts: 30, reb: 12, ast: 8, stl: 3, blk: 2, fg3m: 4, to: 1, fgm: 11, fga: 17, ftm: 4, fta: 4 };
export const POOR = { pts: 2, reb: 1, ast: 0, stl: 0, blk: 0, fg3m: 0, to: 4, fgm: 1, fga: 8, ftm: 0, fta: 2 };

export const day = (n) => `2026-11-${String(n).padStart(2, '0')}`;

export function row(espnId, name, date, min, { starter = false, stats = AVERAGE, didNotPlay = false } = {}) {
  const line = didNotPlay ? Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) : stats;
  return { espnId: String(espnId), name, team: 'TST', date, espnEventId: `${date}-${espnId}`,
    min: didNotPlay ? 0 : min, starter, didNotPlay, reason: didNotPlay ? 'REST' : null, ...line };
}

// Games before the night as [day, minutes, starter] triples, then the night itself.
export function player(id, name, earlier, night, nightOptions = {}) {
  return [...earlier.map(([d, min, starter = false]) => row(id, name, day(d), min, { starter })),
    row(id, name, DATE, night, nightOptions)];
}

const bench = (n, mins) => Array.from({ length: n }, (_, i) => [i + 1, mins[i % mins.length], false]);
// Six bench games near 18 minutes, then two starts.
const risingStarter = [...bench(6, [17, 19]), [7, 30, true], [8, 34, true]];
// Eight bench games at a mean of 16 minutes, so a 24-minute night is a jump of exactly 8.
export const bencher = bench(8, [15, 17]);

export function buildLogs() {
  const logs = [];
  // Filler with spread-out stats gives the reference pool a nonzero standard deviation.
  for (let i = 0; i < 8; i++) {
    const stats = Object.fromEntries(STAT_KEYS.map((k, j) => [k, AVERAGE[k] + ((i * (j + 3)) % 7) - 3 + i]));
    for (let d = 1; d <= 5; d++) logs.push(row(900 + i, `Filler${i} Test`, day(d), 30, { stats }));
    logs.push(row(900 + i, `Filler${i} Test`, DATE, 30, { stats }));
  }
  logs.push(
    // A: bench, then starts, ending at 38 minutes. Both flags.
    ...player(101, 'Avery Alpha', risingStarter, 38, { starter: true }),
    // B: minutes flag only.
    ...player(102, 'Blake Bravo', bencher, 24),
    // C: steady 30-minute starter with a big night. Not flagged.
    ...player(103, 'Casey Charlie', Array.from({ length: 8 }, (_, i) => [i + 1, 30, true]), 31, { starter: true, stats: BIG }),
    // D: same shape as A, excluded by the caller.
    ...player(104, 'Drew Delta', risingStarter, 38, { starter: true }),
    // E: two games before the night.
    ...player(105, 'Emery Echo', [[1, 15], [2, 15]], 36, { starter: true }),
    // F: same shape as B, available.
    ...player(106, 'Finley Foxtrot', bencher, 24),
  );
  return logs;
}
