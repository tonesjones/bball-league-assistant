import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateEntry, realizedGain, flips, summarize } from '../src/engine/bakeoff.mjs';
import { loadGameLogs } from '../src/sources/gamelogs.mjs';
import { readDecision } from '../src/sources/decisions.mjs';

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
  const validated = await linkedEntries(entries); const path = 'local/bakeoff.jsonl'; await mkdir(dirname(path), { recursive: true });
  await appendFile(path, validated.map((e) => JSON.stringify({ taken: false, ...e })).join('\n') + '\n');
} else if (command === 'score') {
  const week = Number(get('--week')); const from = get('--from'); const to = get('--to');
  const entries = await linkedEntries((await readFile('local/bakeoff.jsonl', 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).filter((e) => e.week === week));
  const logs = await loadGameLogs('2026-27', from, to); const final = get('--final') ? JSON.parse(await readFile(get('--final'), 'utf8')) : null;
  const results = entries.map((entry) => { const { gain, gamesPlayed } = realizedGain(entry, logs, { to }); const flipped = final ? flips(gain, final.matchup.totals, final.matchup.volume, entry) : null; return { entry, gain, gamesPlayed, flips: flipped }; });
  console.log('source\tchatbot\tdecision\tstart\tgames add/drop\tgain\thelped\thurt\treject reason\tnote');
  for (const r of results) console.log(`${r.entry.source}\t${r.entry.chatbot ?? '-'}\t${r.entry.decision === 'hold' ? 'hold' : `${r.entry.add.name} for ${r.entry.drop.name}`}\t${r.entry.start}\t${r.gamesPlayed.add}/${r.gamesPlayed.drop}\t${JSON.stringify(r.gain)}\t${r.flips?.helped.join(',') ?? '-'}\t${r.flips?.hurt.join(',') ?? '-'}\t${r.entry.rejectReason ?? '-'}\t${JSON.stringify(r.entry.note ?? '')}`);
  const summaries = summarize(results);
  const cats = Object.keys(summaries[0]?.meanGain ?? {}); const reasons = Object.keys(summaries[0]?.rejectReasons ?? {});
  console.log(['source', 'moves', 'holds', 'helped', 'hurt', 'net', ...cats.map((c) => `mean ${c}`), 'mean rating', ...reasons].join('\t'));
  for (const s of summaries) console.log([s.source, s.moves, s.holds, s.helped, s.hurt, s.net, ...cats.map((c) => JSON.stringify(s.meanGain[c])), s.meanRating ?? '-', ...reasons.map((reason) => s.rejectReasons[reason])].join('\t'));
} else throw new Error('usage: bakeoff record <entries.json> | bakeoff score --week N --from YYYY-MM-DD (week start for logs) --to YYYY-MM-DD [--final snapshot.json]');
