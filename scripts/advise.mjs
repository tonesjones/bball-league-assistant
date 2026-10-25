import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { advise, normalizeRoles, MODEL_VERSION } from '../src/engine/v0-advice.mjs';
import { estimateVolume } from '../src/engine/shooting-volume.mjs';
import { findPlayer } from '../src/engine/names.mjs';
import { addDays, tomorrow } from '../src/engine/weeks.mjs';
import { loadProjectionLogs } from '../src/sources/gamelogs.mjs';
import { projectPlayers } from '../src/engine/projections.mjs';
import { saveDecision } from '../src/sources/decisions.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const PROTECTED_FILE = 'local/protected.json';
const ROLES_FILE = 'local/roles.json';

// Tony's protected names are private, so they live in git-ignored local/. No file means none.
async function readProtected(file) {
  let protection;
  try {
    protection = await readJson(file);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`${file}: ${err.message}`);
  }
  const names = protection?.protected;
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) {
    throw new Error(`${file} must be {"protected": ["Player Name", ...]}`);
  }
  return names;
}

export async function readRoles(rolesFile = ROLES_FILE, protectedFile = PROTECTED_FILE) {
  let roles = {};
  try {
    roles = await readJson(rolesFile);
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`${rolesFile}: ${err.message}`);
  }
  const protectedNames = await readProtected(protectedFile);
  try {
    return normalizeRoles(roles, protectedNames);
  } catch (err) {
    throw new Error(`${rolesFile}: ${err.message}`);
  }
}
const number = (n) => n == null ? 'unknown' : n.toFixed(3);
const signed = (n) => `${n >= 0 ? '+' : ''}${number(n)}`;

export function snapshotFreshness(asOf, { maxAgeHours = 12, allowStale = false, now = Date.now() } = {}) {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) throw new Error('invalid snapshot asOf');
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 0) throw new Error('--max-age-hours must be a nonnegative finite number');
  const ageHours = Math.max(0, (now - timestamp) / 3_600_000);
  const stale = ageHours > maxAgeHours;
  if (stale && !allowStale) throw new Error(`Snapshot is ${ageHours.toFixed(2)} hours old (maximum ${maxAgeHours}); refresh it or pass --allow-stale.`);
  return { ageHours, maxAgeHours, stale };
}

export function formatAdvice(report) {
  const d = report.decision;
  const lines = [d.action === 'move' ? `Move: pick up ${d.pair.pickup.name}, ${d.pair.drop ? `drop ${d.pair.drop.name} [${d.pair.dropRole}]` : 'no drop (open roster spot)'}`
    : `${d.action === 'insufficient' ? 'Insufficient evidence' : 'Hold'}: ${d.reason}`,
    ...(d.missing ?? []).map((p) => `Missing: ${p.name} (${p.nbaTeam}, ${p.side}): ${p.starts} starts, ${p.reason}`),
    `Unknown games: mine ${report.unknownGames.mine} | opponent ${report.unknownGames.opponent}`,
    `Bars: drop ${report.holdBelow} | add-only ${report.addOnlyBelow}${d.bar ? ` | applied: ${d.bar.kind}` : ''}`, '',
    `Snapshot: ${report.asOf}`, `Week ${report.week}: ${report.window.start} to ${report.window.end}`,
    `From: ${report.fromDate} | Adds from: ${report.addsFrom} | Adds left: ${report.addsLeft}`,
    ...(report.pending?.waivers ?? []).map((w) => `Pending claim ${w.order} (${w.date}): add ${w.add}${w.bid == null ? '' : ` for $${w.bid}`}${w.drop ? `, drop ${w.drop}` : ''}`),
    ...(report.pending?.warning ? [`Warning: ${report.pending.warning}`] : []),
    `Shooting volume: ${Object.entries(report.volumeStatus).map(([side, v]) => `${side}: ${v.status}${v.reason ? ` (${v.reason})` : ''}${v.unmatched?.length ? `; unmatched: ${v.unmatched.join(', ')}` : ''}`).join(' | ')}`, '',
    'Category     Mine       Opponent   P(win)   Need'];
  if (report.projection) lines.splice(lines.length - 1, 0,
    `Game logs checked: ${report.projection.asOf} | Minutes pseudo-games k=${report.projection.k} (starting value, not calibrated)`, '');
  if (report.freshness?.stale) lines.unshift(`STALE: snapshot is ${report.freshness.ageHours.toFixed(2)} hours old (maximum ${report.freshness.maxAgeHours}).`, '');
  for (const [c, v] of Object.entries(report.baseline.categories)) {
    const incomplete = v.pWinRange && !v.complete;
    const probability = incomplete ? v.pWinRange.map((p) => p.toFixed(2)).join('-') : number(v.pWin);
    lines.push(`${c.padEnd(8)} ${number(v.mine).padStart(10)} ${number(v.opponent).padStart(10)} ${probability.padStart(8)}   ${incomplete ? 'incomplete' : v.label}`);
  }
  lines.push('', ...report.notes, '', 'Decision details:');
  const pairLines = (pair, i) => {
    lines.push(`${i + 1}. Pick up ${pair.pickup.name} (${pair.pickup.nbaTeam}, ${pair.pickup.status ?? 'healthy'}, ${pair.pickup.games} games from ${pair.pickupStart})`,
      `   ${pair.drop ? `Drop ${pair.drop.name} [${pair.dropRole}] (${pair.drop.games} games left)` : 'No drop: open roster spot'} | Score: ${signed(pair.score)} categories`);
    if (pair.nextWeek) lines.push(`   Next week (${pair.nextWeek.start} to ${pair.nextWeek.end}, context only): ${pair.nextWeek.games} games, ${pair.nextWeek.starts} legal starts`);
    lines.push(`   Unknown games (mine after move): ${pair.unknownGames}`);
    if (pair.scoreRange[0] !== pair.scoreRange[1]) lines.push(`   Score range: ${number(pair.scoreRange[0])} to ${number(pair.scoreRange[1])}`);
    if (pair.lineup.mode === 'start-pickup') {
      const times = pair.lineup.pickupStarts === 1 ? 'once' : `${pair.lineup.pickupStarts} times`;
      const displaced = pair.lineup.displaced.map((g) => `${g.name} on ${g.date}`).join(', ');
      lines.push(displaced
        ? `   Lineup: deliberately start ${pair.pickup.name} ${times}; displaces ${displaced}.`
        : `   Lineup: deliberately start ${pair.pickup.name} ${times}; no other projected starter is displaced.`);
    }
    const season = (p) => p.seasonValue == null ? 'unknown' : `${signed(p.seasonValue)} (#${p.seasonRank})`;
    const players = [pair.pickup, pair.drop].filter(Boolean);
    for (const p of players) if (p.minutes) {
      const m = p.minutes;
      lines.push(`   ${p.name} minutes: games ${m.games}, starts ${m.starts}, prior ${number(m.prior)}, season ${number(m.season)}, projected ${number(m.projected)}`);
    }
    for (const scenario of pair.minuteScenarios ?? []) lines.push(
      `   Minutes case pickup ${scenario.pickupMode} ${number(scenario.pickupMpg)}${pair.drop ? ` / drop ${scenario.dropMode} ${number(scenario.dropMpg)}` : ''}: ${scenario.scoreRange.map(number).join(' to ')} categories`);
    for (const p of players) if (p.rates) lines.push(
      `   ${p.name} per-minute evidence: ${p.rates.status}, ${p.rates.games} games / ${number(p.rates.minutes)} minutes`);
    if (pair.rateScenarios?.length) lines.push(`   Per-minute sensitivity: ${pair.rateScenarios.length} additional cases, score ${number(Math.min(...pair.rateScenarios.map((s) => s.scoreRange[0])))} to ${number(Math.max(...pair.rateScenarios.map((s) => s.scoreRange[1])))} categories (full cases in JSON).`);
    if (pair.missingRates?.length) lines.push(`   Missing complete per-minute evidence: ${pair.missingRates.join(', ')}`);
    lines.push(`   Season value: pickup ${season(pair.pickup)}${pair.drop ? ` vs drop ${season(pair.drop)}` : ''}`);
    lines.push(`   ${Object.entries(pair.changes).map(([c, v]) => `${c}: total ${signed(v.total)}, P(win) ${signed(v.pWin)}`).join(' | ')}`);
  };
  if (d.action === 'move') pairLines(d.pair, 0);
  else if (d.action === 'insufficient' && d.best) pairLines(d.best, 0);
  else lines.push(d.reason);
  lines.push('', 'Top pairs (alternatives against the current roster):');
  report.topPairs.forEach(pairLines);
  if (!report.topPairs.length) lines.push('None.');
  const g = report.guardrail;
  lines.push('', 'Season guardrail:', `Margin: ${g.seasonMargin} | Protect rank: ${g.protectRank} | Blocked pairs: ${g.blockedPairs}`,
    `Core players: ${g.core.join(', ') || 'None.'}`, `Stream players: ${g.stream.join(', ') || 'None.'}`,
    `Blocked by rule (first match): ${Object.entries(g.blockedByRule).map(([rule, count]) => `${rule} ${count}`).join(' | ')}`,
    'Protected by rank:');
  for (const p of g.protectedByRank) lines.push(`${p.name}: ${signed(p.value)} (#${p.rank})`);
  if (!g.protectedByRank.length) lines.push('None.');
  lines.push('No prior (protected, starts counted as unknown games):');
  for (const p of g.protectedNoPrior) lines.push(`${p.name} (${p.nbaTeam}): ${p.reason}`);
  if (!g.protectedNoPrior.length) lines.push('None.');
  lines.push('', 'Unscored players:');
  for (const p of report.unscored) lines.push(`${p.name} (${p.nbaTeam}, ${p.where}): ${p.reason}`);
  if (!report.unscored.length) lines.push('None.');
  return lines.join('\n');
}

function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('dates must be YYYY-MM-DD');
  return value;
}

async function main(args) {
  let snapshotPath;
  const options = {}, freshnessOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--from') options.fromDate = date(args[++i]);
    else if (arg === '--adds-from') options.addsFrom = date(args[++i]);
    else if (arg === '--allow-stale') freshnessOptions.allowStale = true;
    else if (arg === '--max-age-hours' || arg === '--hold-below' || arg === '--add-only-below' || arg === '--minutes-k') {
      const value = args[++i];
      if (!value?.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${arg} must be a nonnegative finite number`);
      if (arg === '--max-age-hours') freshnessOptions.maxAgeHours = Number(value);
      else if (arg === '--minutes-k') {
        if (Number(value) <= 0) throw new Error('--minutes-k must be positive');
        options.minutesK = Number(value);
      }
      else if (arg === '--add-only-below') options.addOnlyBelow = Number(value);
      else options.holdBelow = Number(value);
    }
    else if (arg === '--margin') {
      const value = args[++i];
      if (!value?.trim() || !Number.isFinite(Number(value))) throw new Error('--margin must be a finite number');
      options.seasonMargin = Number(value);
    } else if (arg === '--protect-rank') {
      const value = args[++i];
      if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) throw new Error('--protect-rank must be a nonnegative integer');
      options.protectRank = Number(value);
    } else if (arg === '--top') {
      const value = args[++i];
      if (!/^\d+$/.test(value ?? '')) throw new Error('--top must be a nonnegative integer');
      options.top = Number(value);
    } else if (arg.startsWith('-') || snapshotPath) throw new Error(`unexpected argument: ${arg}`);
    else snapshotPath = arg;
  }
  if (!snapshotPath) {
    const dir = 'local/snapshots';
    const files = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.json')).map(async (name) => {
      const file = path.join(dir, name);
      return { file, modified: (await stat(file)).mtimeMs };
    }));
    files.sort((a, b) => b.modified - a.modified || a.file.localeCompare(b.file));
    snapshotPath = files[0]?.file;
    if (!snapshotPath) throw new Error('no local/snapshots/*.json snapshots found');
  }
  const snapshot = await readJson(snapshotPath);
  const freshness = snapshotFreshness(snapshot.asOf, freshnessOptions);
  const [ids, priors, schedule] = await Promise.all([
    'data/ids.json', 'data/priors/players.json', 'data/schedule-2026-27.json',
  ].map(readJson));
  const roles = await readRoles();
  const season = schedule.season ?? '2026-27';
  const seasonStart = schedule.games.map((g) => g.date).sort()[0];
  const { logs, coverage } = await loadProjectionLogs(season, { asOf: snapshot.asOf, from: seasonStart });
  const projections = projectPlayers(priors, ids, logs, { k: options.minutesK ?? 2, asOf: coverage.checkedAt });
  const fromDate = options.fromDate ?? tomorrow(snapshot.asOf);
  const from = snapshot.matchup.start, to = [addDays(fromDate, -1), snapshot.matchup.end].sort()[0];
  const missingVolume = (side) => !['fgm', 'fga', 'ftm', 'fta'].every((k) => Number.isFinite(snapshot.matchup.volume?.[side]?.[k]));
  if (to >= from && ['mine', 'opponent'].some(missingVolume)) {
    const slots = snapshot.settings.rosterPositions.filter((p) => !['BN', 'IL', 'IL+'].includes(p.slot))
      .reduce((sum, p) => sum + p.count, 0);
    options.volumeStatus = {};
    snapshot.matchup.volume ??= {};
    for (const [side, players] of [['mine', snapshot.team.roster], ['opponent', snapshot.matchup.opponentRoster]]) {
      if (!missingVolume(side)) { options.volumeStatus[side] = { status: 'reported' }; continue; }
      const roster = players.map((p) => ({ ...p, espnId: findPlayer(ids.players, p.name, p.nbaTeam).player?.espnId }));
      const result = estimateVolume({ roster, totals: snapshot.matchup.totals?.[side], logs, from, to, slots });
      options.volumeStatus[side] = result;
      if (result.status === 'matched') {
        snapshot.matchup.volume[side] = Object.fromEntries(['fgm', 'fga', 'ftm', 'fta'].map((k) => [k, result[k]]));
      }
    }
  }
  const report = { ...advise(snapshot, { ...options, ids, priors, schedule, roles, projections }), freshness };
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const gitOptions = { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), encoding: 'utf8' };
  const provenance = {
    modelVersion: MODEL_VERSION,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], gitOptions).trim()),
    snapshotPath: path.resolve(snapshotPath), snapshotHash: hash(await readFile(snapshotPath)),
    projectionVersion: `${projections.version}:${hash(JSON.stringify({ players: projections.players, k: projections.k }))}`,
    gameLogCoverage: coverage,
    scheduleHash: hash(JSON.stringify(schedule)), idsHash: hash(JSON.stringify(ids)), roles,
  };
  const saved = await saveDecision({ report, options: { ...report.options, ...freshnessOptions, maxAgeHours: freshness.maxAgeHours, allowStale: freshnessOptions.allowStale ?? false }, provenance, projections });
  report.decisionId = saved.id;
  const text = formatAdvice(report);
  const output = path.join('local/advice', path.basename(snapshotPath));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(text);
  console.log(`JSON: ${output}`);
  console.log(`Decision: ${saved.id}\nRecord: ${saved.path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
