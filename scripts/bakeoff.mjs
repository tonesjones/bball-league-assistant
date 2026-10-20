import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateEntry, realizedGain, flips, summarize } from '../src/engine/bakeoff.mjs';
import { loadGameLogs } from '../src/sources/gamelogs.mjs';

const [command, ...args] = process.argv.slice(2); const get = (k) => args[args.indexOf(k) + 1];
if (command === 'record') {
  const entries = JSON.parse(await readFile(args[0], 'utf8')); if (!Array.isArray(entries)) throw new Error('entries file must be an array');
  entries.forEach(validateEntry); const path = 'local/bakeoff.jsonl'; await mkdir(dirname(path), { recursive: true });
  await appendFile(path, entries.map((e) => JSON.stringify({ taken: false, ...e })).join('\n') + '\n');
} else if (command === 'score') {
  const week = Number(get('--week')); const from = get('--from'); const to = get('--to');
  const entries = (await readFile('local/bakeoff.jsonl', 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).filter((e) => e.week === week);
  const logs = await loadGameLogs('2026-27', from, to); const final = get('--final') ? JSON.parse(await readFile(get('--final'), 'utf8')) : null;
  const results = entries.map((entry) => { const { gain, gamesPlayed } = realizedGain(entry, logs, { from, to }); const flipped = final ? flips(gain, final.matchup.totals, final.matchup.volume, entry) : null; return { entry, gain, gamesPlayed, flips: flipped }; });
  for (const r of results) console.log(`${r.entry.source}\t${r.entry.chatbot ?? '-'}\t${r.entry.add.name} for ${r.entry.drop.name}\tGP ${r.gamesPlayed.add}/${r.gamesPlayed.drop}\t${JSON.stringify(r.gain)}\t${r.flips?.join(',') ?? '-'}`);
  console.log('source\tmoves\tmean counting gain\tflips\tmean rating');
  for (const s of summarize(results)) console.log(`${s.source}\t${s.moves}\t${s.meanCountingCategoryGain.toFixed(2)}\t${s.categoriesFlipped}\t${s.meanRating ?? '-'}`);
} else throw new Error('usage: bakeoff record <entries.json> | bakeoff score --week N --from YYYY-MM-DD --to YYYY-MM-DD [--final snapshot.json]');
