import { readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DECISIONS_DIR, readDecision } from '../src/sources/decisions.mjs';
import { findPlayer } from '../src/engine/names.mjs';
import { validateEntry } from '../src/engine/bakeoff.mjs';
import { attachLineups } from '../src/sources/bakeoff-records.mjs';
import { appendEntries } from '../src/sources/bakeoff-log.mjs';

const USAGE = `usage:
  npm run did                (asks what you did about the latest decision)
  npm run did -- <decisionId>   (asks about that decision)
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

const TAG_MEANINGS = [['changed-decision', 'the tool changed what you did'], ['caught-mistake', 'it stopped a bad move'],
  ['no-effect', 'you would have done the same without it'], ['wasted-time', 'it cost more than it gave']];

// The moves to offer for a decision: the engine's step (or its wait pick), then the runners-up.
export function choices(report) {
  const add = (step, label) => ({ label: `Added ${step.pickup.name} (${step.pickup.nbaTeam}), ${step.drop ? `dropped ${step.drop.name}` : 'into open spot'}, starts ${step.start}${label}`,
    args: ['add', step.pickup.name, ...(step.drop ? ['--drop', step.drop.name] : []), '--on', step.start] });
  const list = [];
  if (report.action === 'add' && report.step) list.push(add(report.step, " (engine's pick)"));
  if (report.action === 'wait' && report.waitFor) list.push(add(report.waitFor, " (engine's pick: wait for this day)"));
  for (const r of report.runnersUp) list.push(add(r.step, ''));
  list.push({ label: `Held${report.action === 'hold' ? " (engine's pick)" : ''}`, args: ['hold'] });
  return list;
}

export async function latestDecisionId(dir = DECISIONS_DIR) {
  const records = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.json'))
    .map(async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8'))));
  if (!records.length) throw new Error(`No decisions in ${dir}. Run a league check first.`);
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1).id;
}

// Asks numbered questions and records the answer through did(). Lines are read from an async
// iterator so piped input that arrives before a question is asked is not lost.
export async function askDid(decisionId, { input = process.stdin, output = process.stdout, now = new Date() } = {}) {
  const rl = createInterface({ input, terminal: false }), lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => {
    output.write(q);
    const { value, done } = await lines.next();
    if (done) throw new Error('Cancelled: no answer given. Nothing was recorded.');
    return value.trim();
  };
  const pick = async (q, n) => {
    for (;;) {
      const a = await ask(q);
      if (/^\d+$/.test(a) && Number(a) >= 1 && Number(a) <= n) return Number(a) - 1;
      output.write(`Type a number from 1 to ${n}.\n`);
    }
  };
  const menu = (items) => items.forEach((l, i) => output.write(`  ${i + 1}  ${l}\n`));
  try {
    const id = decisionId ?? await latestDecisionId();
    const { report } = await readDecision(id);
    const list = choices(report);
    output.write(`Decision ${id} (data as of ${report.asOf})\n\nWhat did you do?\n`);
    menu([...list.map((c) => c.label), 'Added someone else (type a name)']);
    const which = await pick('> ', list.length + 1);
    let args;
    if (which < list.length) args = list[which].args;
    else {
      const name = await ask('Player you added: ');
      const drop = await ask('Player you dropped (Enter for none): ');
      const fallback = list.find((c) => c.args[0] === 'add')?.args.at(-1) ?? report.fromDate;
      const on = await ask(`First day the player can start for you, YYYY-MM-DD (Enter for ${fallback}): `);
      args = ['add', name, ...(drop ? ['--drop', drop] : []), '--on', on || fallback];
    }
    output.write('\nHow much did the tool matter?\n');
    menu(TAG_MEANINGS.map(([tag, meaning]) => `${tag}: ${meaning}`));
    args.push('--tag', TAG_MEANINGS[await pick('> ', TAG_MEANINGS.length)][0]);
    const minutes = await ask('\nMinutes spent on this decision (Enter to skip): ');
    if (minutes) args.push('--minutes', minutes);
    if (/^y/i.test(await ask('Did Claude or you have to finish the run by hand? (y/N): '))) args.push('--rescue');
    try {
      return await did([id, ...args], now);
    } catch (err) {
      if (!/already recorded/.test(err.message)) throw err;
      if (!/^y/i.test(await ask('You already recorded this decision. Replace it? (y/N): '))) throw new Error('Kept the earlier entry. Nothing was recorded.');
      return await did([id, ...args, '--replace'], now);
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  (args.length <= 1 && !args.some((a) => a.startsWith('--')) ? askDid(args[0]) : did(args)).then((e) => console.log(`Recorded ${e.decision === 'hold' ? 'hold' : `add ${e.add.name}`} for decision ${e.decisionId}.`))
    .catch((err) => { console.error(err.message); process.exitCode = 1; });
}
