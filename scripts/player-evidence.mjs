import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { playerEvidence } from '../src/engine/player-evidence.mjs';
import { loadProjectionLogs } from '../src/sources/gamelogs.mjs';
import { trackTransactions } from '../src/sources/transaction-history.mjs';
import { snapshotFreshness } from './advise.mjs';

const snapshotPath = process.argv[2];
if (!snapshotPath || process.argv.length > 3) throw new Error('usage: npm run evidence -- local/snapshots/<timestamp>.json');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [snapshot, ids, schedule] = await Promise.all([snapshotPath, 'data/ids.json', 'data/schedule-2026-27.json'].map(json));
snapshotFreshness(snapshot.asOf);
const season = schedule.season ?? '2026-27';
const from = schedule.games.map((g) => g.date).sort()[0];
const { logs, coverage } = await loadProjectionLogs(season, { asOf: snapshot.asOf, from });
const evidence = playerEvidence(snapshot, ids, logs);
const snapshots = [];
const seasonStart = `${season.slice(0, 4)}-07-01`;
for (const name of (await readdir('local/snapshots')).filter((f) => /^\d{4}-\d\d-\d\d-\d{4}\.json$/.test(f))) {
  const file = path.join('local/snapshots', name), old = await json(file);
  if (old.asOf >= seasonStart && old.asOf <= snapshot.asOf) snapshots.push({ snapshot: old, snapshotPath: file });
}
if (!snapshots.some((s) => path.resolve(s.snapshotPath) === path.resolve(snapshotPath))) snapshots.push({ snapshot, snapshotPath });
const transactions = await trackTransactions(snapshots, { season });
const report = { ...evidence, gameLogsCheckedAt: coverage.checkedAt,
  snapshotPath: path.resolve(snapshotPath), gameLogCoverage: coverage,
  source: 'ESPN completed-game box scores; Yahoo supplies roster, availability and transactions only',
  usage: { label: 'estimated USG%', formula: '100 * sum(FGA + 0.44*FTA + TO) / sum(MIN/(teamMIN/5) * (teamFGA + 0.44*teamFTA + teamTO))',
    reference: 'https://www.basketball-reference.com/about/glossary.html',
    note: 'Box-score estimate using rounded recorded minutes, not official NBA on-court possession USG%. Missing context remains unknown; not used in recommendation scoring.' },
  matchup: { score: snapshot.matchup.score, totals: snapshot.matchup.totals },
  transactions: { latestPage: snapshot.transactions, history: transactions.history,
    mine: transactions.history.filter((r) => r.event.team === snapshot.team.name), newlyArchived: transactions.added.length,
    note: 'Only events observed in saved Yahoo snapshots are tracked; earlier or rolled-off unseen events cannot be reconstructed.' } };
const number = (n) => n == null ? 'unknown' : n.toFixed(1);
const safe = (s) => String(s ?? '').replace(/[\r\n|]/g, ' ');
const pct = (n) => n == null ? 'unknown' : `${(n * 100).toFixed(1)}%`;
const table = (players, recent = false) => [
  '| Player | Team | Status/waiver | GP | Starts | MPG | PTS | REB | AST | STL | BLK | 3PM | TO | FGA | FTA | Est. USG% | TS% |',
  '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...players.map((p) => { const s = recent ? p.last7Days : p.season;
    return `| ${[p.name, p.nbaTeam, [p.status, p.waiverClears ? `waivers ${p.waiverClears}` : null].filter(Boolean).join('; ') || 'no status flag',
      s.games, s.starts ?? 'unknown', number(s.mpg), ...['pts','reb','ast','stl','blk','fg3m','to','fga','fta'].map((k) => number(s.perGame[k])),
      s.estimatedUsgPct == null ? 'unknown' : `${number(s.estimatedUsgPct)}%`, pct(s.trueShootingPct)].map(safe).join(' | ')} |`; }),
].join('\n');
const lines = ['# League and player evidence', '', `Yahoo snapshot: ${snapshot.asOf}`, `ESPN logs checked: ${coverage.checkedAt}`, '',
  'Descriptive evidence only. Games observed are shown explicitly; this report does not recommend a transaction.',
  'Counting statistics and shot attempts below are per played game. DNPs are retained in JSON and excluded from these averages.',
  'Estimated USG% uses ESPN team/player box scores and rounded player minutes, with possession-exposure weighting across games. It is not official NBA USG%.',
  'Last season does not enter these descriptive tables. Current-season evidence does not yet update per-minute rates in the separate recommender.', '',
  '## Your roster: season so far', '', table(report.roster), '',
  `## Your roster: last seven days (${report.recentFrom} to ${report.through}, Eastern game dates)`, '', table(report.roster, true), '',
  '## Available players: season so far', '', 'Only the first 100 players from Yahoo’s available-player list were captured; order follows Yahoo, not a new model ranking.', '', table(report.available), '',
  '## Available players: last seven days', '', table(report.available, true), '',
  '## Observed league transactions', '', report.transactions.note, '',
  '| First observed | Team | Yahoo time | Moves |', '|---|---|---|---|',
  ...report.transactions.history.map((r) => `| ${[r.firstSeen, r.event.team, r.event.time, r.event.moves.map((m) => `${m.type} ${m.player}${m.faab != null ? ` ($${m.faab})` : ''}`).join('; ')].map(safe).join(' | ')} |`), '',
  '[Usage formula reference](https://www.basketball-reference.com/about/glossary.html)', ''];
const base = path.join('local/evidence', path.basename(snapshotPath, '.json'));
await mkdir(path.dirname(base), { recursive: true });
await writeFile(`${base}.json`, JSON.stringify(report, null, 2) + '\n');
await writeFile(`${base}.md`, lines.join('\n'));
console.log(`Evidence: ${base}.md\nJSON: ${base}.json\nAvailable players: ${report.available.length}\nObserved transaction groups: ${report.transactions.history.length} (${report.transactions.mine.length} on your team)\nNewly archived: ${report.transactions.newlyArchived}`);
