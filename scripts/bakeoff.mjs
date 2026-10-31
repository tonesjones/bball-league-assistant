import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateEntry, validateReview, applyReviews, realizedGain, flips, summarize, scorecard } from '../src/engine/bakeoff.mjs';
import { loadGameLogs } from '../src/sources/gamelogs.mjs';
import { readDecision } from '../src/sources/decisions.mjs';
import { attachLineups } from '../src/sources/bakeoff-records.mjs';

async function linkedEntries(entries, { requirePromptVersion = false } = {}) {
  const validated = entries.map((entry) => validateEntry(entry, { allowLegacyPromptVersion: !requirePromptVersion }));
  for (const entry of validated) {
    const record = await readDecision(entry.decisionId);
    if (entry.week !== record.report.week || Date.parse(entry.asOf) !== Date.parse(record.report.asOf)) {
      throw new Error(`entry does not match decision ${entry.decisionId}: week/asOf must match`);
    }
  }
  return validated;
}

const REVIEWS = 'local/pilot-reviews.jsonl';
async function appendEntries(entries) {
  const path = 'local/bakeoff.jsonl'; await mkdir(dirname(path), { recursive: true });
  let previous = [];
  try { previous = (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const keys = new Set(previous.map((e) => `${e.decisionId}/${e.source}`));
  for (const entry of entries) {
    const key = `${entry.decisionId}/${entry.source}`;
    if (keys.has(key)) throw new Error(`Decision/source already recorded: ${key}`);
    keys.add(key);
  }
  await appendFile(path, entries.map((e) => JSON.stringify({ taken: false, ...e, recordedAt: new Date().toISOString() })).join('\n') + '\n');
}

async function readReviews() {
  try { return (await readFile(REVIEWS, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

const [command, ...args] = process.argv.slice(2); const get = (k) => args.includes(k) ? args[args.indexOf(k) + 1] : undefined;
if (command === 'rate') {
  const [decisionId, source, rating] = args;
  const review = validateReview({ recordedAt: new Date().toISOString(), decisionId, source, rating: Number(rating),
    ...(get('--reason') !== undefined && { rejectReason: get('--reason') }), ...(get('--note') !== undefined && { note: get('--note') }) });
  await readDecision(decisionId);
  await mkdir(dirname(REVIEWS), { recursive: true });
  await appendFile(REVIEWS, JSON.stringify(review) + '\n');
  console.log(`Rated ${source} ${review.rating} for decision ${decisionId}.`);
} else if (command === 'record') {
  const entries = JSON.parse(await readFile(args[0], 'utf8')); if (!Array.isArray(entries)) throw new Error('entries file must be an array');
  const linked = await linkedEntries(entries, { requirePromptVersion: true });
  await appendEntries(await Promise.all(linked.map(attachLineups)));
} else if (command === 'score') {
  const week = Number(get('--week')); const from = get('--from'); const to = get('--to');
  const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!Number.isInteger(week) || week < 1 || !date(from) || !date(to) || from > to) throw new Error('Score requires a positive week and valid --from/--to dates');
  if (args.includes('--final')) throw new Error('--final is no longer used; category changes require the saved-lineup counterfactual');
  const entries = await linkedEntries((await readFile('local/bakeoff.jsonl', 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).filter((e) => e.week === week));
  const logs = await loadGameLogs('2026-27', from, to);
  const { results, late } = applyReviews(entries.map((entry) => {
    const replay = realizedGain(entry, logs, { to });
    return { entry, ...replay, flips: replay.status === 'scored' ? flips(replay.gain, replay.finalTotals, replay.finalVolume, { taken: false }) : null, windowEnd: to };
  }), await readReviews());
  if (late) console.log(`${late} review(s) recorded after the decision window were ignored.`);
  console.log('Each row is an independent saved-lineup counterfactual against no move. Overlapping decisions are not a weekly plan. Category outcomes use replayed baseline/opponent lineups, not later Yahoo lineup choices.');
  console.log('source\tchatbot\tdecision\tstatus\tgain\thelped\thurt\treasons');
  for (const r of results) console.log([r.entry.source, r.entry.chatbot ?? '-', r.entry.decision, r.status,
    JSON.stringify(r.gain), r.flips?.helped.join(',') ?? '-', r.flips?.hurt.join(',') ?? '-', r.reasons.join('; ')].join('\t'));

  const summaries = summarize(results);
  const cats = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO']; const reasons = Object.keys(summaries[0]?.rejectReasons ?? {});
  console.log(['source', 'moves', 'holds', 'scored', 'unscored', 'invalid', 'helped', 'hurt', 'net', ...cats.map((c) => `mean ${c}`), 'mean rating', ...reasons].join('\t'));
  for (const s of summaries) console.log([s.source, s.moves, s.holds, s.scored, s.unscored, s.invalid, s.helped, s.hurt, s.net, ...cats.map((c) => s.meanGain ? JSON.stringify(s.meanGain[c]) : '-'), s.meanRating ?? '-', ...reasons.map((reason) => s.rejectReasons[reason])].join('\t'));
} else if (command === 'scorecard') {
  const to = get('--to'), last = get('--last');
  const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!date(to) || (last !== undefined && (!/^\d+$/.test(last) || Number(last) < 1))) throw new Error('Scorecard requires --to YYYY-MM-DD and optional positive --last N');
  const entries = await linkedEntries((await readFile('local/bakeoff.jsonl', 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).filter((e) => e.date <= to));
  const replayed = [];
  for (const entry of entries) {
    const record = await readDecision(entry.decisionId);
    const end = [record.report.window.end, to].sort()[0];
    const replay = realizedGain(entry, await loadGameLogs('2026-27', record.report.window.start, end), { to: end });
    replayed.push({ entry, ...replay, flips: replay.status === 'scored' ? flips(replay.gain, replay.finalTotals, replay.finalVolume, { taken: false }) : null,
      modelVersion: record.provenance.modelVersion ?? null, createdAt: record.createdAt ?? record.report.asOf, windowEnd: record.report.window.end });
  }
  const { results, late } = applyReviews(replayed, await readReviews());
  if (late) console.log(`${late} review(s) recorded after the decision window were ignored.`);
  const cards = scorecard(results, { lastN: last === undefined ? 10 : Number(last) });
  console.log('modelVersion\tpromptVersion\tsource\tmoves\tholds\tscored\tunscored\tinvalid\thelped\thurt\tnet\tmean rating\treject reasons');
  for (const card of cards) for (const row of card.summaries) console.log([card.modelVersion ?? 'rehearsal', card.promptVersion ?? 'rehearsal', row.source, row.moves, row.holds, row.scored, row.unscored, row.invalid, row.helped, row.hurt, row.net, row.meanRating ?? '-', JSON.stringify(row.rejectReasons)].join('\t'));
  console.log('rolling\tmodelVersion\tpromptVersion\tsource\tpaired scored\thelped\thurt\tnet\tmean rating');
  for (const card of cards) for (const row of card.rolling) console.log(['rolling', card.modelVersion ?? 'rehearsal', card.promptVersion ?? 'rehearsal', row.source, row.scored, row.helped, row.hurt, row.net, row.meanRating ?? '-'].join('\t'));
  console.log('gate\tmodelVersion\tpromptVersion\tpaired decisions\tstatus\ttool net\tchatbot net\tnone net\ttool rating\tchatbot rating\tnone rating');
  for (const card of cards) console.log(['gate', card.modelVersion ?? 'rehearsal', card.promptVersion ?? 'rehearsal', card.paired, card.gate, card.comparison.tool.net, card.comparison.chatbot.net, card.comparison.none.net, card.comparison.tool.meanRating ?? '-', card.comparison.chatbot.meanRating ?? '-', card.comparison.none.meanRating ?? '-'].join('\t'));
} else throw new Error('usage: bakeoff rate <decisionId> <tool|chatbot|none> <1-5> [--reason R] [--note N] | bakeoff record <entries.json> | bakeoff score --week N --from YYYY-MM-DD --to YYYY-MM-DD | bakeoff scorecard --to YYYY-MM-DD [--last N]');
