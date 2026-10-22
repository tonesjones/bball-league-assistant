import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { advise, normalizeRoles } from '../src/engine/v0-advice.mjs';
import { estimateVolume } from '../src/engine/shooting-volume.mjs';
import { findPlayer } from '../src/engine/names.mjs';
import { addDays, tomorrow } from '../src/engine/weeks.mjs';
import { loadGameLogs } from '../src/sources/gamelogs.mjs';

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
  const lines = [d.action === 'move' ? `Move: pick up ${d.pair.pickup.name}, drop ${d.pair.drop.name} [${d.pair.dropRole}]` : `Hold: ${d.reason}`,
    `Unknown games: mine ${report.unknownGames.mine} | opponent ${report.unknownGames.opponent}`, '',
    `Snapshot: ${report.asOf}`, `Week ${report.week}: ${report.window.start} to ${report.window.end}`,
    `From: ${report.fromDate} | Adds from: ${report.addsFrom} | Adds left: ${report.addsLeft}`,
    `Shooting volume: ${Object.entries(report.volumeStatus).map(([side, v]) => `${side}: ${v.status}${v.reason ? ` (${v.reason})` : ''}${v.unmatched?.length ? `; unmatched: ${v.unmatched.join(', ')}` : ''}`).join(' | ')}`, '',
    'Category     Mine       Opponent   P(win)   Need'];
  if (report.freshness?.stale) lines.unshift(`STALE: snapshot is ${report.freshness.ageHours.toFixed(2)} hours old (maximum ${report.freshness.maxAgeHours}).`, '');
  for (const [c, v] of Object.entries(report.baseline.categories)) {
    lines.push(`${c.padEnd(8)} ${number(v.mine).padStart(10)} ${number(v.opponent).padStart(10)} ${number(v.pWin).padStart(8)}   ${v.label}`);
  }
  lines.push('', ...report.notes, '', 'Decision details:');
  const pairLines = (pair, i) => {
    lines.push(`${i + 1}. Pick up ${pair.pickup.name} (${pair.pickup.nbaTeam}, ${pair.pickup.status ?? 'healthy'}, ${pair.pickup.games} games from ${pair.pickupStart})`,
      `   Drop ${pair.drop.name} [${pair.dropRole}] (${pair.drop.games} games left) | Score: ${signed(pair.score)} categories`);
    lines.push(`   Unknown games (mine after move): ${pair.unknownGames}`);
    if (pair.lineup.mode === 'start-pickup') {
      const times = pair.lineup.pickupStarts === 1 ? 'once' : `${pair.lineup.pickupStarts} times`;
      const displaced = pair.lineup.displaced.map((g) => `${g.name} on ${g.date}`).join(', ');
      lines.push(displaced
        ? `   Lineup: deliberately start ${pair.pickup.name} ${times}; displaces ${displaced}.`
        : `   Lineup: deliberately start ${pair.pickup.name} ${times}; no other projected starter is displaced.`);
    }
    const season = (p) => p.seasonValue == null ? 'unknown' : `${signed(p.seasonValue)} (#${p.seasonRank})`;
    lines.push(`   Season value: pickup ${season(pair.pickup)} vs drop ${season(pair.drop)}`);
    lines.push(`   ${Object.entries(pair.changes).map(([c, v]) => `${c}: total ${signed(v.total)}, P(win) ${signed(v.pWin)}`).join(' | ')}`);
  };
  if (d.action === 'move') pairLines(d.pair, 0);
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
    else if (arg === '--max-age-hours' || arg === '--hold-below') {
      const value = args[++i];
      if (!value?.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${arg} must be a nonnegative finite number`);
      if (arg === '--max-age-hours') freshnessOptions.maxAgeHours = Number(value);
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
  const fromDate = options.fromDate ?? tomorrow(snapshot.asOf);
  const from = snapshot.matchup.start, to = [addDays(fromDate, -1), snapshot.matchup.end].sort()[0];
  const missingVolume = (side) => !['fgm', 'fga', 'ftm', 'fta'].every((k) => Number.isFinite(snapshot.matchup.volume?.[side]?.[k]));
  if (to >= from && ['mine', 'opponent'].some(missingVolume)) {
    const logs = await loadGameLogs(schedule.season ?? '2026-27', from, to);
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
  const report = { ...advise(snapshot, { ...options, ids, priors, schedule, roles }), freshness };
  const text = formatAdvice(report);
  const output = path.join('local/advice', path.basename(snapshotPath));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(text);
  console.log(`JSON: ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
