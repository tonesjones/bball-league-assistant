import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getJson } from '../src/sources/espn.mjs';
import { evaluateWeights } from '../src/engine/projection-calibration.mjs';
import { parseHistoricalLogs } from '../src/sources/espn-history.mjs';
import { addDays } from '../src/engine/weeks.mjs';

const root = 'local/calibration';
const base = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';
const protocol = {
  priorSeason: 2025, evaluationSeason: 2026, minimumPriorGames: 10, minimumPriorMpg: 10,
  grid: [0.25, 0.5, 1, 2, 4, 8, 15, 30],
  tuning: ['2025-10-27', '2025-12-22'], validation: ['2026-01-05', '2026-04-06'],
  objective: 'Equal-category mean MAE relative to season-average baseline on tuning windows; freeze winner before validation.',
  target: 'Next seven calendar days, conditional on observed appearances; no injury/availability forecast or lineup/transaction evaluation.',
  adoption: 'Winner must beat current k=2 on validation macro relative MAE and beat season-average baseline in at least 7/9 categories. Otherwise preserve k=2.',
};
const stats = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks',
  to: 'turnovers', fg3m: 'threePointFieldGoalsMade', fgm: 'fieldGoalsMade', fga: 'fieldGoalsAttempted',
  ftm: 'freeThrowsMade', fta: 'freeThrowsAttempted' };
const categories = { PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', '3PM': 'fg3m', TO: 'to', 'FG%': null, 'FT%': null };
await mkdir(root, { recursive: true });
const protocolText = JSON.stringify(protocol, null, 2) + '\n';
try {
  if (await readFile(`${root}/protocol.json`, 'utf8') !== protocolText) throw new Error('Protocol changed: use a new calibration directory.');
} catch (e) { if (e.code !== 'ENOENT') throw e; await writeFile(`${root}/protocol.json`, protocolText); }
const priorJson = await getJson(`${base}/statistics/byathlete?season=2025&seasontype=2&limit=1000`,
  { cacheFile: `${root}/prior-season-2025.json`, maxAgeHours: 8760 });
if (priorJson.requestedSeason?.year !== protocol.priorSeason || priorJson.requestedSeason.type?.type !== 2
  || priorJson.pagination?.pages !== 1 || priorJson.athletes?.length !== priorJson.pagination.count) throw new Error('Historical prior season/pagination mismatch');
const priors = priorJson.athletes.map((a) => {
  const values = Object.fromEntries(a.categories.flatMap((c) => {
    const schema = priorJson.categories.find((x) => x.name === c.name);
    if (!schema || schema.names.length !== c.values.length) throw new Error('Prior stat schema mismatch');
    return schema.names.map((key, i) => [key, c.values[i]]);
  }));
  const g = values.gamesPlayed, mpg = values.minutes / g;
  const perGame = { g, ...Object.fromEntries(Object.entries(stats).map(([key, name]) => [key, values[name] / g])) };
  return { id: String(a.athlete.id), name: a.athlete.displayName, mpg, perGame };
}).filter((p) => p.perGame.g >= protocol.minimumPriorGames && p.mpg >= protocol.minimumPriorMpg);
if (priors.some((p) => !Object.values(p.perGame).every(Number.isFinite))) throw new Error('Invalid historical prior stats');


const data = [], errors = [];
for (const [i, prior] of priors.entries()) {
  try {
    const json = await getJson(`${base}/athletes/${prior.id}/gamelog?season=2026`,
      { cacheFile: `${root}/logs-2026/${prior.id}.json`, maxAgeHours: 8760 });
    const logs = parseHistoricalLogs(json, prior);
    data.push({ prior, logs: logs ?? [], unavailable: logs === null });
  } catch (e) { errors.push({ id: prior.id, error: e.message }); }
  if ((i + 1) % 25 === 0) console.log(`Historical players checked ${i + 1}/${priors.length}; failures ${errors.length}`);
}
await writeFile(`${root}/collection.json`, JSON.stringify({ players: priors.length, loaded: data.length,
  empty: data.filter((p) => !p.logs.length).length, unavailable: data.filter((p) => p.unavailable).map((p) => p.prior.id), errors }, null, 2));
if (errors.length) throw new Error(`Calibration incomplete: ${errors.length} collection/parser failures; see collection.json`);
const dataText = JSON.stringify(data);
await writeFile(`${root}/dataset.json`, dataText);
const datasetHash = createHash('sha256').update(dataText).digest('hex');
const weeks = ([first, last]) => { const out = []; for (let d = first; d <= last; d = addDays(d, 7)) out.push(d); return out; };
const evaluate = (starts, scales = null, players = data) => evaluateWeights(players, starts, protocol.grid, scales);

const tuning = evaluate(weeks(protocol.tuning));
const selected = [...protocol.grid].sort((a, b) => tuning.macro[a] - tuning.macro[b] || a - b)[0];
await writeFile(`${root}/selection.json`, JSON.stringify({ selected, tuning: tuning.macro, datasetHash, protocol }, null, 2));
const validation = evaluate(weeks(protocol.validation), tuning.scales);
const categoryWins = Object.keys(categories).filter((c) => validation.mae[selected][c] < validation.mae['season-average'][c]);
const adopt = validation.macro[selected] < validation.macro[2] && categoryWins.length >= 7;
const weeklyDelta = validation.byWeek.map((w) => ({ start: w.start,
  delta: Object.keys(categories).reduce((n, c) => n + (w.sums[selected][c] - w.sums[2][c]) / w.counts[c] / tuning.scales[c], 0) / Object.keys(categories).length }));
const summary = { datasetHash, protocol, players: data.length, emptyPlayers: data.filter((p) => !p.logs.length).length,
  rows: data.reduce((n, p) => n + p.logs.length, 0), failures: errors.length, selected, adopt,
  categoryWins, tuning, validation, weeklyDelta,
  earlyValidation: evaluate(weeks(protocol.validation).slice(0, 4), tuning.scales),
  lowPriorMinutesValidation: evaluate(weeks(protocol.validation), tuning.scales, data.filter((p) => p.prior.mpg < 25)),
  limitations: ['Conditional on actual appearances; cannot validate injury availability, future role changes or full lineup advice.',
    'Game-log endpoint supplies played games, not reliable coach-DNP vs injury-DNP classification; no absent games treated as zero.',
    'Prior-season cohort: >=10 games and >=10 MPG; rookies and players without priors excluded. League-filter-only payloads have unavailable history and contribute no scored observations, never zeros.',
    'One historical season; tuning and validation share players but not prediction windows. No calibrated win probabilities.'] };
await writeFile(`${root}/results.json`, JSON.stringify(summary, null, 2));
const f = (x) => x.toFixed(4);
const models = ['season-average', 'prior-only', ...protocol.grid];
const delta = weeklyDelta.map((w) => w.delta).sort((a, b) => a - b);
const units = (c) => ['FG%', 'FT%'].includes(c) ? 'percentage points' : 'per-player weekly total';
const report = ['# Projection-weight calibration', '',
  `Prior season: 2024-25. Outcome season: 2025-26. Dataset SHA-256: \`${datasetHash}\`.`, '',
  `Collected ${data.length} prior-qualified players; ${summary.emptyPlayers} have no usable regular-season history. `
    + `Scored dataset contains ${summary.rows} appearances. Collection/parser failures: ${errors.length}.`, '',
  '## Protocol', '',
  `Cohort selected using prior information only: >=${protocol.minimumPriorGames} games and >=${protocol.minimumPriorMpg} MPG. `
    + `Grid: ${protocol.grid.join(', ')} prior pseudo-games. One k controls minutes and rates together.`, '',
  `Tuning windows: ${protocol.tuning.join(' through ')}; validation windows: ${protocol.validation.join(' through ')}. `
    + 'Each non-overlapping Monday window predicts the next seven calendar days using only earlier games. '
    + 'The tuning winner is saved before validation is evaluated. No tuning uses the validation results.', '',
  'Objective: mean of nine category MAEs divided by their season-average tuning MAE. '
    + 'Scales are fixed on tuning data; raw units are never averaged across categories. '
    + 'Shooting errors use total makes divided by total attempts; zero-attempt comparisons are excluded on a common model set.', '',
  '## Weight selection', '', '| Prior pseudo-games | Tuning normalized MAE | Validation normalized MAE |', '|---|---:|---:|',
  ...models.map((m) => `| ${m} | ${f(tuning.macro[m])} | ${f(validation.macro[m])} |`), '',
  `Tuning winner: **k=${selected}**. Adoption rule: ${protocol.adoption}`, '',
  `Decision: **${adopt ? `adopt k=${selected}` : 'retain k=2; calibration did not establish a replacement'}**. `
    + `Winner beats the season-average baseline in ${categoryWins.length}/9 validation categories.`, '',
  '## Held-out category errors', '',
  '| Category | Unit | Observations | Season average MAE | Prior only MAE | k=2 MAE | Selected MAE |', '|---|---|---:|---:|---:|---:|---:|',
  ...Object.keys(categories).map((c) => {
    const multiplier = ['FG%', 'FT%'].includes(c) ? 100 : 1;
    return `| ${c} | ${units(c)} | ${validation.counts[c]} | `
      + ['season-average', 'prior-only', 2, selected].map((m) => f(validation.mae[m][c] * multiplier)).join(' | ') + ' |';
  }), '', '## Variation and sensitivity', '',
  `Across ${weeklyDelta.length} validation weeks, the selected weight beats k=2 in ${delta.filter((x) => x < 0).length}. `
    + `Weekly paired normalized-error difference (selected minus k=2): median ${f(delta[Math.floor(delta.length / 2)])}, `
    + `range ${f(delta[0])} to ${f(delta.at(-1))}. These are descriptive weekly differences, not independent-trial confidence intervals.`, '',
  `First four validation windows: selected ${f(summary.earlyValidation.macro[selected])}, k=2 ${f(summary.earlyValidation.macro[2])}. `
    + 'These are January windows, not opening-week validation.', '',
  `Prior MPG below 25: selected ${f(summary.lowPriorMinutesValidation.macro[selected])}, k=2 ${f(summary.lowPriorMinutesValidation.macro[2])}.`, '',
  '## Limits', '', ...summary.limitations.map((s) => `- ${s}`), '',
  '- Later-season validation does not establish that the same weight is best for the first few games. All categories share one k; category-specific weights and recency decay were not searched.',
  '- This calibration measures forecast error, not categories won, player pickup value or title odds. Fixed prior/blended safety gates are unchanged.', '',
  '## Reproduce', '', '`node scripts/calibrate-projections.mjs`', '',
  'Historical inputs are cached under ignored local/calibration/. The protocol, selected weight, '
    + 'dataset and full results are saved there. No Yahoo input is part of this calibration.', ''];
await writeFile('docs/backtest-01.md', report.join('\n'));
console.log(JSON.stringify({ players: summary.players, rows: summary.rows, failures: 0, selected, adopt, categoryWins,
  tuning: tuning.macro, validation: validation.macro, counts: validation.counts }, null, 2));
