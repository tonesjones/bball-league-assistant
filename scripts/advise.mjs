import { readFile, readdir, stat, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { planWeek } from '../src/engine/week-plan.mjs';
import { normalizeRoles, MODEL_VERSION } from '../src/engine/advice-common.mjs';
import { roleChanges } from '../src/engine/role-change.mjs';
import { estimateVolume } from '../src/engine/shooting-volume.mjs';
import { findPlayer } from '../src/engine/names.mjs';
import { addDays, tomorrow } from '../src/engine/weeks.mjs';
import { loadProjectionLogs, easternDate } from '../src/sources/gamelogs.mjs';
import { projectPlayers } from '../src/engine/projections.mjs';
import { saveDecision } from '../src/sources/decisions.mjs';
import { appendEntries, readEntries } from '../src/sources/bakeoff-log.mjs';
import { attachLineups } from '../src/sources/bakeoff-records.mjs';
import { validateEntry } from '../src/engine/bakeoff.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const PROTECTED_FILE = 'local/protected.json';
const ROLES_FILE = 'local/roles.json';
const PREFERENCES_FILE = 'local/preferences.json';

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
// Lineup locks and IL candidates, private like roles. No file means none.
export async function readPreferences(file = PREFERENCES_FILE) {
  try {
    return await readJson(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`${file}: ${err.message}`);
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

// did's add command is stored as a move. Legacy entries without timestamps cannot be checked.
export function snapshotRosterChanges(asOf, entries, { allowRosterChange = false } = {}) {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) throw new Error('invalid snapshot asOf');
  if (allowRosterChange) return;
  const move = entries.find((e) => e.source === 'tony' && e.decision === 'move'
    && Date.parse(e.recordedAt) > timestamp);
  if (move) throw new Error(`Snapshot as of ${asOf} predates Tony's roster move recorded at ${move.recordedAt}; capture again or pass --allow-roster-change.`);
}

const WIDTH = 72;

// Wraps text to at most WIDTH characters per line: the first line starts with lead, the rest with indent.
function wrap(text, indent = '  ', lead = '') {
  const lines = [];
  let line = '';
  const prefix = () => (lines.length ? indent : lead);
  const limit = () => WIDTH - prefix().length;
  const push = () => { lines.push(prefix() + line); line = ''; };
  for (let word of text.split(' ')) {
    if (line && line.length + 1 + word.length <= limit()) { line += ` ${word}`; continue; }
    if (line) push();
    while (word.length > limit()) { line = word.slice(0, limit()); word = word.slice(limit()); push(); }
    line = word;
  }
  if (line) push();
  return lines;
}

const stepText = (step) => `ADD ${step.pickup.name} (${step.pickup.nbaTeam}), ${step.drop ? `DROP ${step.drop.name}` : 'into open spot'}, starts ${step.start}`;

// Report section 1: the action line.
export function actionLines(report) {
  if (report.action === 'add') return wrap(stepText(report.step));
  if (report.action === 'wait') return wrap(`WAIT: add ${report.waitFor.pickup.name} to start ${report.waitFor.start}`);
  if (report.ilLock?.length) return ['HOLD: roster moves locked', ...report.ilLock.flatMap((p) =>
    wrap(`${p.name} is in an IL slot with status ${p.status ?? 'healthy'}. Move him out of IL, or wait until he is O again.`))];
  return ['HOLD'];
}

// Report section 2: players whose line decides the call.
export function dependsOnLines(report) {
  return report.dependsOn.flatMap((d) => wrap(`Depends on ${d.player.name}: ${d.games} games, season mpg ${mpg(d.seasonMpg)}, prior mpg ${mpg(d.priorMpg)}; cautious action ${d.cautiousAction}`));
}
const mpg = (n) => (n == null ? 'unknown' : n.toFixed(1));

// Report section 8: when the data was read, and which model scored it.
export function asOfLines(report) {
  return [`Snapshot as of: ${report.asOf}`, `Projections as of: ${report.projection?.asOf ?? 'unknown'}`, `MODEL_VERSION: ${MODEL_VERSION}`];
}

const roleSkipped = (rc) => `Role changes: skipped (${rc.reason})`;

// Report section: the watch list of role changes, or why it was skipped.
export function roleChangeLines(report) {
  const rc = report.roleChanges;
  if (rc.status === 'skipped') return wrap(roleSkipped(rc), '    ', '  ');
  if (!rc.players.length) return ['  none'];
  return rc.players.flatMap((p) => {
    const b = p.box, n = (v) => Math.round(v);
    const z = (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}`;
    return wrap(`${p.name} (${p.team}) ${n(p.minutes)} min vs ${n(p.earlierMpg)} earlier (${n(p.minutes) >= n(p.earlierMpg) ? '+' : '-'}${Math.abs(n(p.minutes) - n(p.earlierMpg))}), started ${p.recentStarts} of last ${p.recentGames}; ${n(b.pts)}p ${n(b.reb)}r ${n(b.ast)}a ${n(b.stl)}s ${n(b.blk)}b ${n(b.fg3m)}x3 ${n(b.fgm)}/${n(b.fga)} ${n(b.ftm)}/${n(b.fta)} ${n(b.to)}to; game z ${z(p.gameZ)}, season z ${z(p.seasonZ)}; availability ${p.availability}`, '    ', '  ');
  });
}
const roleSummary = (report) => {
  const rc = report.roleChanges;
  if (!rc) return [];
  return rc.status === 'skipped' ? wrap(roleSkipped(rc)) : [`Role changes: ${rc.players.length} (see full advice)`];
};

// What analyze-refresh prints: sections 1 and 2, the role-change count, and section 8.
export const planSummary = (report) => [...actionLines(report), ...dependsOnLines(report), ...roleSummary(report), ...asOfLines(report)];

// The watch list needs every league roster, or an owned player could be listed as available.
export function roleChangeReport({ snapshot, ids, logs }) {
  const skipped = (reason) => ({ status: 'skipped', reason });
  const teams = snapshot.league?.teams;
  if (!Array.isArray(teams)) return skipped('no league rosters in this capture');
  const size = Number(snapshot.settings?.raw?.['Max Teams']);
  if (!Number.isInteger(size) || size < 2) return skipped('league size unknown (no Max Teams setting)');
  if (teams.length !== size - 1) return skipped(`${size - 1} team rosters expected, ${teams.length} found`);
  const seen = new Set();
  for (const t of teams) {
    if (!Number.isInteger(t.teamNumber) || t.teamNumber < 1 || t.teamNumber > size) return skipped(`team number ${t.teamNumber} is outside 1 to ${size}`);
    if (seen.has(t.teamNumber)) return skipped(`team ${t.teamNumber} appears twice`);
    seen.add(t.teamNumber);
  }
  const empty = teams.find((t) => !t.roster?.length);
  if (empty) return skipped(`team ${empty.teamNumber} roster is empty`);
  const idOf = (p) => {
    const id = findPlayer(ids.players, p.name, p.nbaTeam).player?.espnId;
    return id == null ? null : String(id);
  };
  const owned = [...snapshot.team.roster, ...(snapshot.matchup.opponentRoster ?? []), ...teams.flatMap((t) => t.roster)];
  const matched = owned.map((p) => ({ p, id: idOf(p) }));
  const unmatched = matched.filter((m) => !m.id);
  if (unmatched.length) return skipped(`unmatched rostered players: ${unmatched.map((m) => `${m.p.name} (${m.p.nbaTeam})`).join(', ')}`);
  const today = easternDate(snapshot.asOf);
  const date = logs.filter((r) => !r.didNotPlay && r.date <= today).map((r) => r.date).sort().pop();
  if (!date) return skipped('no played games in the game logs');
  // With every roster in hand, anyone not on one is available (possibly on waivers).
  const exclude = new Set(matched.map((m) => m.id));
  const available = new Set(logs.map((r) => String(r.espnId)).filter((id) => !exclude.has(id)));
  const players = roleChanges({ logs, date, exclude, available });
  return { status: 'ok', date, players };
}

export function formatPlan(report) {
  const lines = [];
  if (report.freshness?.stale) lines.push(...wrap(`STALE: snapshot is ${report.freshness.ageHours.toFixed(2)} hours old (maximum ${report.freshness.maxAgeHours}).`), '');
  lines.push(...actionLines(report));
  const depends = dependsOnLines(report);
  if (depends.length) lines.push('', ...depends);
  lines.push('', 'Category changes');
  const changes = Object.entries(report.categories);
  if (!changes.length) lines.push('  none (no move)');
  for (const [c, v] of changes) lines.push(`  ${c.padEnd(5)} P(win) ${signed(v.change)}  total ${signed(v.total)}`);
  lines.push('', 'Starts by day');
  for (const d of report.startsByDay) {
    lines.push(...wrap(`${d.date}  open slots ${d.openSlots}  pickup starts ${d.pickupStarts ? 'yes' : 'no'}${d.displaced.length ? `  displaces ${d.displaced.join(', ')}` : ''}`, '    ', '  '));
  }
  if (!report.startsByDay.length) lines.push('  none');
  lines.push('', 'Adds and spots', `  Adds left ${report.addsLeft}, open roster spots ${report.openSpots}`);
  lines.push('', 'Runners-up');
  for (const r of report.runnersUp) lines.push(...wrap(`${stepText(r.step).replace(/^ADD /, '')}: gain ${signed(r.gain)}, ${r.whyLost}`, '    ', '  '));
  if (!report.runnersUp.length) lines.push('  none');
  if (report.roleChanges) lines.push('', 'Role changes (watch list)', ...roleChangeLines(report));
  lines.push('', 'Unknowns');
  for (const u of report.unknowns) {
    const who = u.category ?? `${u.player}${u.side ? ` (${u.side}${u.starts ? `, ${u.starts} starts` : ''})` : ''}`;
    lines.push(...wrap(`${who}: ${u.reason}`, '    ', '  '));
  }
  if (!report.unknowns.length) lines.push('  none');
  lines.push('', 'As of', ...asOfLines(report).map((l) => `  ${l}`));
  return lines.join('\n');
}

// The shadow log: the engine's call and the do-nothing baseline. A wait counts as a hold.
// A logging failure must not lose the advice, so it is reported and the run goes on.
async function logShadowEntries(decisionId, report) {
  try {
    const { pair } = report.decision, ref = (p) => ({ name: p.name, espnId: p.espnId });
    const common = { decisionId, week: report.week, date: new Date().toISOString().slice(0, 10), asOf: report.asOf, chatbot: null, rating: null };
    const hold = { decision: 'hold', add: null, drop: null };
    const tool = pair ? { decision: 'move', start: pair.pickupStart, add: ref(pair.pickup), drop: pair.drop ? ref(pair.drop) : null } : hold;
    const entries = [{ ...common, source: 'tool', ...tool }, { ...common, source: 'none', ...hold }].map((e) => validateEntry(e));
    await appendEntries(await Promise.all(entries.map(attachLineups)));
  } catch (err) {
    console.error(`Shadow log not written: ${err.message}`);
  }
}

function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('dates must be YYYY-MM-DD');
  return value;
}

const INTEGER_FLAGS = {
  '--protect-rank': ['protectRank', 0], '--candidates': ['candidates', 1], '--beam': ['beam', 1],
  '--drops-per-pickup': ['dropsPerPickup', 1], '--max-steps': ['maxSteps', 0], '--pool-size': ['poolSize', 1],
};

async function main(args) {
  let snapshotPath;
  const options = {}, freshnessOptions = {}, rosterOptions = {};
  let minutesK;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--from') options.fromDate = date(args[++i]);
    else if (arg === '--adds-from') options.fromDate = date(args[++i]);
    else if (arg === '--allow-stale') freshnessOptions.allowStale = true;
    else if (arg === '--allow-roster-change') rosterOptions.allowRosterChange = true;
    else if (arg === '--max-age-hours' || arg === '--drop-bar' || arg === '--add-bar' || arg === '--minutes-k') {
      const value = args[++i];
      if (!value?.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${arg} must be a nonnegative finite number`);
      if (arg === '--max-age-hours') freshnessOptions.maxAgeHours = Number(value);
      else if (arg === '--minutes-k') {
        if (Number(value) <= 0) throw new Error('--minutes-k must be positive');
        minutesK = Number(value);
      }
      else if (arg === '--add-bar') options.addBar = Number(value);
      else options.dropBar = Number(value);
    }
    else if (arg === '--margin') {
      const value = args[++i];
      if (!value?.trim() || !Number.isFinite(Number(value))) throw new Error('--margin must be a finite number');
      options.seasonMargin = Number(value);
    } else if (INTEGER_FLAGS[arg]) {
      const [key, min] = INTEGER_FLAGS[arg];
      const value = args[++i];
      if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(Number(value)) || Number(value) < min) throw new Error(`${arg} must be an integer of at least ${min}`);
      options[key] = Number(value);
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
  snapshotRosterChanges(snapshot.asOf, await readEntries(), rosterOptions);
  const [ids, priors, schedule] = await Promise.all([
    'data/ids.json', 'data/priors/players.json', 'data/schedule-2026-27.json',
  ].map(readJson));
  const roles = await readRoles(), preferences = await readPreferences();
  const season = schedule.season ?? '2026-27';
  const seasonStart = schedule.games.map((g) => g.date).sort()[0];
  const { logs, coverage } = await loadProjectionLogs(season, { asOf: snapshot.asOf, from: seasonStart });
  const projections = projectPlayers(priors, ids, logs, { k: minutesK ?? 2, asOf: coverage.checkedAt });
  const fromDate = options.fromDate ?? tomorrow(snapshot.asOf);
  const from = snapshot.matchup.start, to = [addDays(fromDate, -1), snapshot.matchup.end].sort()[0];
  let volumeStatus;
  const missingVolume = (side) => !['fgm', 'fga', 'ftm', 'fta'].every((k) => Number.isFinite(snapshot.matchup.volume?.[side]?.[k]));
  if (to >= from && ['mine', 'opponent'].some(missingVolume)) {
    const slots = snapshot.settings.rosterPositions.filter((p) => !['BN', 'IL', 'IL+'].includes(p.slot))
      .reduce((sum, p) => sum + p.count, 0);
    volumeStatus = {};
    snapshot.matchup.volume ??= {};
    for (const [side, players] of [['mine', snapshot.team.roster], ['opponent', snapshot.matchup.opponentRoster]]) {
      if (!missingVolume(side)) { volumeStatus[side] = { status: 'reported' }; continue; }
      const roster = players.map((p) => ({ ...p, espnId: findPlayer(ids.players, p.name, p.nbaTeam).player?.espnId }));
      const result = estimateVolume({ roster, totals: snapshot.matchup.totals?.[side], logs, from, to, slots });
      volumeStatus[side] = result;
      if (result.status === 'matched') {
        snapshot.matchup.volume[side] = Object.fromEntries(['fgm', 'fga', 'ftm', 'fta'].map((k) => [k, result[k]]));
      }
    }
  }
  const report = { ...planWeek({ snapshot, schedule, projections, ids, roles, preferences, volumeStatus, options }), freshness,
    roleChanges: roleChangeReport({ snapshot, ids, logs }) };
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
  report.decisionId = randomUUID();
  const text = formatPlan(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const output = path.join('local/advice', path.basename(snapshotPath));
  await mkdir(path.dirname(output), { recursive: true });
  const saved = await saveDecision({ id: report.decisionId, report,
    options: { ...report.options, ...freshnessOptions, maxAgeHours: freshness.maxAgeHours,
      allowStale: freshnessOptions.allowStale ?? false, allowRosterChange: rosterOptions.allowRosterChange ?? false }, provenance, projections });
  try {
    await writeFile(output, json);
  } catch (err) {
    await unlink(saved.path);
    throw err;
  }
  await logShadowEntries(saved.id, report);
  console.log(text);
  console.log(`JSON: ${output}`);
  console.log(`Decision: ${saved.id}\nRecord: ${saved.path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
