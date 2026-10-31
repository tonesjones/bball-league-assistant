import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDecision } from '../src/sources/decisions.mjs';
import { findPlayer } from '../src/engine/names.mjs';
import { validateEntry } from '../src/engine/bakeoff.mjs';
import { attachLineups } from '../src/sources/bakeoff-records.mjs';
import { appendEntries } from '../src/sources/bakeoff-log.mjs';

const USAGE = `usage:
  npm run did -- <decisionId> hold --tag T [--minutes N] [--rescue] [--reason "..."] [--replace]
  npm run did -- <decisionId> add "<player>" [--drop "<player>"] --on YYYY-MM-DD --tag T [same flags]`;
const VALUE_FLAGS = ['--tag', '--minutes', '--reason', '--drop', '--on'], BOOLEAN_FLAGS = ['--rescue', '--replace'];

export function parseArgs(args) {
  const positional = [], flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (VALUE_FLAGS.includes(arg)) {
      if (i + 1 >= args.length) throw new Error(`${arg} needs a value\n${USAGE}`);
      flags[arg] = args[++i];
    } else if (BOOLEAN_FLAGS.includes(arg)) flags[arg] = true;
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  return { positional, flags };
}

// A snapshot player by name, then the ESPN ID by the snapshot player's own name and team.
function resolve(list, name, ids, where) {
  const found = findPlayer(list.map((p) => ({ ...p, team: p.nbaTeam })), name);
  if (!found.player) return { error: `${found.reason === 'ambiguous' ? 'Ambiguous' : 'Unknown'} player "${name}" in ${where}` };
  const { name: full, nbaTeam } = found.player;
  const espn = findPlayer(ids.players, full, nbaTeam).player;
  if (!espn?.espnId) throw new Error(`No ESPN ID for ${full} in data/ids.json`);
  return { player: { name: full, espnId: String(espn.espnId) } };
}

export async function did(args, now = new Date()) {
  const { positional: [decisionId, verb, name, ...extra], flags } = parseArgs(args);
  if (!decisionId || !['hold', 'add'].includes(verb) || extra.length || (verb === 'hold') !== (name === undefined)) throw new Error(USAGE);
  if (!flags['--tag']) throw new Error(`--tag is required\n${USAGE}`);
  if (verb === 'hold' && (flags['--drop'] || flags['--on'])) throw new Error('hold takes no --drop or --on');
  if (verb === 'add' && !/^\d{4}-\d{2}-\d{2}$/.test(flags['--on'] ?? '')) throw new Error('add needs --on YYYY-MM-DD');
  if (verb === 'add' && flags['--drop'] === '') throw new Error('--drop needs a name');
  const record = await readDecision(decisionId);
  const entry = { decisionId, week: record.report.week, asOf: record.report.asOf, date: now.toISOString().slice(0, 10),
    source: 'tony', chatbot: null, rating: null, tag: flags['--tag'], decision: 'hold', add: null, drop: null };
  if (flags['--minutes'] !== undefined) {
    if (!flags['--minutes'].trim() || !Number.isFinite(Number(flags['--minutes']))) throw new Error('--minutes must be a number');
    entry.minutes = Number(flags['--minutes']);
  }
  if (flags['--rescue']) entry.rescue = true;
  if (flags['--replace']) entry.replaces = true;
  if (flags['--reason'] !== undefined) entry.note = flags['--reason'];
  if (verb === 'add') {
    const snapshot = JSON.parse(await readFile(record.provenance.snapshotPath, 'utf8'));
    const ids = JSON.parse(await readFile('data/ids.json', 'utf8'));
    let add = resolve(snapshot.freeAgents, name, ids, 'the free agents');
    if (add.error?.startsWith('Unknown')) add = resolve(snapshot.matchup.opponentRoster ?? [], name, ids, 'the free agents or the opponent roster');
    const drop = flags['--drop'] ? resolve(snapshot.team.roster, flags['--drop'], ids, 'your roster') : { player: null };
    if (add.error || drop.error) throw new Error(add.error ?? drop.error);
    Object.assign(entry, { decision: 'move', start: flags['--on'], add: add.player, drop: drop.player });
  }
  await appendEntries([await attachLineups(validateEntry(entry))]);
  return entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  did(process.argv.slice(2)).then((e) => console.log(`Recorded ${e.decision === 'hold' ? 'hold' : `add ${e.add.name}`} for decision ${e.decisionId}.`))
    .catch((err) => { console.error(err.message); process.exitCode = 1; });
}
