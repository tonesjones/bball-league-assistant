import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateEntry, realizedGain, flips, summarize } from '../src/engine/bakeoff.mjs';
import { loadGameLogs } from '../src/sources/gamelogs.mjs';
import { readDecision } from '../src/sources/decisions.mjs';
import { attachLineups } from '../src/sources/bakeoff-records.mjs';

async function linkedEntries(entries) {
  const validated = entries.map(validateEntry);
  for (const entry of validated) {
    const record = await readDecision(entry.decisionId);
    if (entry.week !== record.report.week || Date.parse(entry.asOf) !== Date.parse(record.report.asOf)) {
      throw new Error(`entry does not match decision ${entry.decisionId}: week/asOf must match`);
    }
  }
  return validated;
}

const [command, ...args] = process.argv.slice(2); const get = (k) => args.includes(k) ? args[args.indexOf(k) + 1] : undefined;
if (command === 'record') {
  const entries = JSON.parse(await readFile(args[0], 'utf8')); if (!Array.isArray(entries)) throw new Error('entries file must be an array');
  const linked = await linkedEntries(entries); const validated = await Promise.all(linked.map(attachLineups)); const path = 'local/bakeoff.jsonl'; await mkdir(dirname(path), { recursive: true });
  let previous = [];
  try { previous = (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const keys = new Set(previous.map((e) => `${e.decisionId}/${e.source}`));
  for (const entry of validated) {
    const key = `${entry.decisionId}/${entry.source}`;
    if (keys.has(key)) throw new Error(`Decision/source already recorded: ${key}`);
    keys.add(key);
  }
  await appendFile(path, validated.map((e) => JSON.stringify({ taken: false, ...e, recordedAt: new Date().toISOString() })).join('\n') + '\n');
} else if (command === 'score') {
  const week = Number(get('--week')); const from = get('--from'); const to = get('--to');
  const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!Number.isInteger(week) || week < 1 || !date(from) || !date(to) || from > to) throw new Error('Score requires a positive week and valid --from/--to dates');
  if (args.includes('--final')) throw new Error('--final is no longer used; category changes require the saved-lineup counterfactual');
  const entries = await linkedEntries((await readFile('local/bakeoff.jsonl', 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).filter((e) => e.week === week));
  const logs = await loadGameLogs('2026-27', from, to);
  const results = entries.map((entry) => {
    const replay = realizedGain(entry, logs, { to });
    return { entry, ...replay, flips: replay.status === 'scored' ? flips(replay.gain, replay.finalTotals, replay.finalVolume, { taken: false }) : null };
  });
  console.log('Each row is an independent saved-lineup counterfactual against no move. Overlapping decisions are not a weekly plan. Category outcomes use replayed baseline/opponent lineups, not later Yahoo lineup choices.');
  console.log('source\tchatbot\tdecision\tstatus\tgain\thelped\thurt\treasons');
  for (const r of results) console.log([r.entry.source, r.entry.chatbot ?? '-', r.entry.decision, r.status,
    JSON.stringify(r.gain), r.flips?.helped.join(',') ?? '-', r.flips?.hurt.join(',') ?? '-', r.reasons.join('; ')].join('\t'));

  const summaries = summarize(results);
  const cats = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO']; const reasons = Object.keys(summaries[0]?.rejectReasons ?? {});
  console.log(['source', 'moves', 'holds', 'scored', 'unscored', 'invalid', 'helped', 'hurt', 'net', ...cats.map((c) => `mean ${c}`), 'mean rating', ...reasons].join('\t'));
  for (const s of summaries) console.log([s.source, s.moves, s.holds, s.scored, s.unscored, s.invalid, s.helped, s.hurt, s.net, ...cats.map((c) => s.meanGain ? JSON.stringify(s.meanGain[c]) : '-'), s.meanRating ?? '-', ...reasons.map((reason) => s.rejectReasons[reason])].join('\t'));
} else throw new Error('usage: bakeoff record <entries.json> | bakeoff score --week N --from YYYY-MM-DD (week start for logs) --to YYYY-MM-DD');
