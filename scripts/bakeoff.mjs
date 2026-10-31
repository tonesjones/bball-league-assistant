import { readFile } from 'node:fs/promises';
import { validateEntry, realizedGain, flips, summarize, differs, latestEntries, replaySummary } from '../src/engine/bakeoff.mjs';
import { loadGameLogs } from '../src/sources/gamelogs.mjs';
import { readDecision } from '../src/sources/decisions.mjs';
import { attachLineups } from '../src/sources/bakeoff-records.mjs';
import { readEntries, appendEntries } from '../src/sources/bakeoff-log.mjs';

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

const date = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const [command, ...args] = process.argv.slice(2); const get = (k) => args.includes(k) ? args[args.indexOf(k) + 1] : undefined;

function scoreRow(entry, logs, to) {
  if (!entry) return { entry: null, status: 'unscored', reasons: ['no entry recorded'], flips: null };
  const replay = realizedGain(entry, logs, { to });
  const reasons = entry.unscoredReason ? [entry.unscoredReason] : replay.reasons;
  return { entry, ...replay, reasons, flips: replay.status === 'scored' ? flips(replay.gain, replay.finalTotals, replay.finalVolume, { taken: false }) : null };
}

const describe = (side) => side.status === 'scored'
  ? `${side.entry.decision === 'hold' ? 'hold' : `add ${side.entry.add.name}${side.entry.drop ? ` drop ${side.entry.drop.name}` : ''} on ${side.entry.start}`}: helped ${side.flips.helped.join(',') || '-'}; hurt ${side.flips.hurt.join(',') || '-'}`
  : `unscored (${side.reasons.join('; ')})`;

if (command === 'record') {
  const entries = JSON.parse(await readFile(args[0], 'utf8')); if (!Array.isArray(entries)) throw new Error('entries file must be an array');
  const linked = await linkedEntries(entries, { requirePromptVersion: true });
  await appendEntries(await Promise.all(linked.map(attachLineups)));
} else if (command === 'score') {
  const week = Number(get('--week')); const from = get('--from'); const to = get('--to');
  if (!Number.isInteger(week) || week < 1 || !date(from) || !date(to) || from > to) throw new Error('Score requires a positive week and valid --from/--to dates');
  if (args.includes('--final')) throw new Error('--final is no longer used; category changes require the saved-lineup counterfactual');
  const entries = await linkedEntries(latestEntries(await readEntries()).filter((e) => e.week === week));
  const logs = await loadGameLogs('2026-27', from, to);
  const results = entries.map((entry) => ({ ...scoreRow(entry, logs, to), windowEnd: to }));
  console.log('Each row is an independent saved-lineup counterfactual against no move. Overlapping decisions are not a weekly plan. Category outcomes use replayed baseline/opponent lineups, not later Yahoo lineup choices.');
  console.log('source\tchatbot\tdecision\tstatus\tgain\thelped\thurt\treasons');
  for (const r of results) console.log([r.entry.source, r.entry.chatbot ?? '-', r.entry.decision, r.status,
    JSON.stringify(r.gain), r.flips?.helped.join(',') ?? '-', r.flips?.hurt.join(',') ?? '-', r.reasons.join('; ')].join('\t'));

  const summaries = summarize(results);
  const cats = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO']; const reasons = Object.keys(summaries[0]?.rejectReasons ?? {});
  console.log(['source', 'moves', 'holds', 'scored', 'unscored', 'invalid', 'helped', 'hurt', 'net', ...cats.map((c) => `mean ${c}`), 'mean rating', ...reasons].join('\t'));
  for (const s of summaries) console.log([s.source, s.moves, s.holds, s.scored, s.unscored, s.invalid, s.helped, s.hurt, s.net, ...cats.map((c) => s.meanGain ? JSON.stringify(s.meanGain[c]) : '-'), s.meanRating ?? '-', ...reasons.map((reason) => s.rejectReasons[reason])].join('\t'));
} else if (command === 'replay') {
  const to = get('--to');
  if (!date(to)) throw new Error('Replay requires --to YYYY-MM-DD');
  const entries = latestEntries(await readEntries());
  const rows = [];
  for (const decisionId of [...new Set(entries.filter((e) => e.source === 'tony').map((e) => e.decisionId))]) {
    const record = await readDecision(decisionId), { window } = record.report;
    if (window.end > to) continue;
    const pick = (source) => entries.find((e) => e.decisionId === decisionId && e.source === source);
    const logs = await loadGameLogs('2026-27', window.start, window.end);
    // The replay's gain is each entry's lineups against the saved do-nothing baseline, i.e. the none entry; a hold gains zero.
    const tool = scoreRow(pick('tool'), logs, window.end), tony = scoreRow(pick('tony'), logs, window.end);
    rows.push({ decisionId, week: record.report.week, tool, tony, tag: tony.entry.tag,
      differs: !tool.entry || differs(tool.entry, tony.entry) });
  }
  console.log('Each side is a saved-lineup counterfactual against the none entry (hold). Categories helped/hurt use replayed lineups.');
  for (const r of rows) {
    console.log(`decision ${r.decisionId} week ${r.week} ${r.differs ? 'DIFFER' : 'same'} tag ${r.tag}`);
    console.log(`  tool: ${describe(r.tool)}`);
    console.log(`  tony: ${describe(r.tony)}`);
  }
  const s = replaySummary(rows);
  console.log(`decisions ${s.decisions}; differing ${s.differing}; tool won ${s.toolWon}; tony won ${s.tonyWon}; tied ${s.tied}; unscored ${s.unscored}`);
} else throw new Error('usage: bakeoff record <entries.json> | bakeoff score --week N --from YYYY-MM-DD --to YYYY-MM-DD | bakeoff replay --to YYYY-MM-DD');
