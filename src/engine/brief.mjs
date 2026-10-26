import { rosterCrunch } from './crunch.mjs';
import { applyPreferences } from './preferences.mjs';
import { normalizeName } from './names.mjs';

const known = (n) => Number.isFinite(n);
const number = (n) => known(n) ? n.toFixed(3) : 'unknown';
const signed = (n) => known(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(3)}` : 'unknown';
const text = (v) => v == null || v === '' ? 'unknown' : String(v);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`,
  ...rows.map((row) => `| ${row.map((v) => String(v).replace(/\|/g, '\\|')).join(' | ')} |`)];
const positions = (p) => p.positions?.length ? p.positions.join(', ') : 'unknown';
const status = (p) => p.status ?? 'healthy';

function pairLine(pair) {
  const drop = pair.drop ? `drop ${pair.drop.name} (${pair.drop.nbaTeam}, ${text(pair.drop.games)} games left)` : 'no drop (open roster spot)';
  const changes = Object.entries(pair.changes ?? {}).map(([c, v]) => `${c} ${signed(v.total)}`).join(', ');
  return `Pick up ${pair.pickup.name} (${pair.pickup.nbaTeam}, ${status(pair.pickup)}, ${text(pair.pickup.games)} games from ${pair.pickupStart}), `
    + `${drop}. Score ${signed(pair.score)} categories. Changes: ${changes || 'unknown'}.`;
}

const STATE_SECTIONS = ['Standing preferences', 'Decisions', 'Open questions'];

// Copies Tony's own sections from the vault state note word for word. League data never comes
// from the note.
export function standingDecisions(note) {
  const body = note.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  const sections = body.split(/^(?=## )/m);
  const kept = STATE_SECTIONS.map((title) => sections.find((s) => s.trim().split('\n')[0] === `## ${title}`));
  if (kept.some((s) => !s)) throw new Error(`state note needs these sections: ${STATE_SECTIONS.map((t) => `## ${t}`).join(', ')}`);
  return kept.map((s) => s.trim().replace(/^## /, '### ')).join('\n\n');
}

// Formats a saved decision as one Markdown brief for a chat window. Every number comes from the
// decision and its inputs; nothing here scores or ranks.
export function buildBrief({ record, snapshot, schedule, prompt, promptVersion, now, faLimit = 40, standing = null }) {
  const r = record.report, { start, end } = r.window;
  const teamsByDate = new Map();
  for (const g of schedule.games) {
    if (g.date < r.fromDate || g.date > end) continue;
    if (!teamsByDate.has(g.date)) teamsByDate.set(g.date, new Set());
    teamsByDate.get(g.date).add(g.home).add(g.away);
  }
  const plays = (p, date) => Boolean(teamsByDate.get(date)?.has(p.nbaTeam));
  const left = (p) => p.nbaTeam ? [...teamsByDate.keys()].filter((date) => plays(p, date)).length : 'unknown';
  const roles = record.options?.roles ?? {};
  const core = new Set((roles.core ?? []).map(normalizeName)), stream = new Set((roles.stream ?? []).map(normalizeName));
  const role = (p) => core.has(normalizeName(p.name)) ? 'core' : stream.has(normalizeName(p.name)) ? 'stream' : '';
  const ageHours = (Date.parse(now) - Date.parse(r.asOf)) / 3_600_000;

  const lines = [prompt.trim(), '', `# League brief, week ${r.week}`, '', '## Data as of', '',
    `- Snapshot (Yahoo pages read): ${r.asOf}`,
    `- Advice computed: ${record.createdAt}`,
    `- Brief written: ${now} (snapshot ${known(ageHours) ? ageHours.toFixed(1) : 'unknown'} hours old)`,
    `- Model version: ${text(record.provenance?.modelVersion)} | Brief prompt version: ${promptVersion}`,
    `- Week ${r.week}: ${start} to ${end}. Games counted from ${r.fromDate}. Adds left this week: ${text(r.addsLeft)}`,
    '', '## Standing decisions', '',
    standing ?? 'None supplied. Run `npm run brief -- --state <note>` to include the vault state note.',
    '', '## Matchup', '',
    ...table(['Category', 'Mine', 'Opponent', 'P(win)', 'Need'], Object.entries(r.baseline.categories).map(([c, v]) => {
      const incomplete = v.pWinRange && !v.complete;
      return [c, number(v.mine), number(v.opponent),
        incomplete ? v.pWinRange.map((p) => p.toFixed(2)).join('-') : number(v.pWin), incomplete ? 'incomplete' : text(v.label)];
    })),
    '', "## Tool's call", ''];
  const d = r.decision;
  if (d.action === 'move') lines.push(`Move: ${pairLine(d.pair)}`);
  else {
    lines.push(`${d.action === 'insufficient' ? 'Insufficient evidence' : 'Hold'}: ${d.reason}`);
    if (d.best) lines.push('', `Best pair considered: ${pairLine(d.best)}`);
  }

  lines.push('', '## Alternatives', '');
  r.topPairs.forEach((pair, i) => lines.push(`${i + 1}. ${pairLine(pair)}`));
  if (!r.topPairs.length) lines.push('None.');

  lines.push('', '## My roster', '', ...table(['Player', 'Team', 'Positions', 'Slot', 'Status', 'Role', 'Games left'],
    snapshot.team.roster.map((p) => [p.name, text(p.nbaTeam), positions(p), text(p.slot), status(p), role(p), left(p)])));
  lines.push('', '## Opponent roster', '', ...table(['Player', 'Team', 'Slot', 'Status', 'Games left'],
    snapshot.matchup.opponentRoster.map((p) => [p.name, text(p.nbaTeam), text(p.slot), status(p), left(p)])));

  // Decisions saved before Task 18 have no crunch; rebuild the days from the snapshot (losses unknown).
  const crunch = r.crunch?.current ?? rosterCrunch({ lines: {}, snapshot: record.options?.preferences
    ? applyPreferences(snapshot, record.options.preferences).snapshot : snapshot, schedule, fromDate: r.fromDate, endDate: end });
  lines.push('', '## Roster crunch', '',
    'Days when a player with a game sits, from the same daily lineup fit the advice uses (locks, positions, games cap). IL and ruled-out players are not counted.', '');
  const sitDays = crunch.days.filter((d) => d.sits.length);
  if (sitDays.length) lines.push(...table(['Date', 'Playing', 'Starting', 'Sits (reason)'],
    sitDays.map((d) => [d.date, d.playing.length, d.starts.length, d.sits.map((s) => `${s.name} (${s.reason})`).join(', ')])));
  else lines.push('No one sits.');
  lines.push('', '### Chronic sitters (2 or more games sat)', '');
  const chronic = crunch.byPlayer.filter((e) => e.sat >= 2);
  if (chronic.length) lines.push(...table(['Player', 'Games', 'Starts', 'Sat', 'Lost PTS', 'Lost REB', 'Lost AST', 'Lost 3PM', 'Lost STL', 'Lost BLK', 'Lost TO', 'Lost FGM/FGA', 'Lost FTM/FTA'],
    chronic.map((e) => { const l = e.lost, f = (v) => typeof v === 'number' ? +v.toFixed(2) : v;
      const pair = (m, a) => typeof l[m] === 'number' && typeof l[a] === 'number' ? `${f(l[m])}/${f(l[a])}` : 'unknown';
      return [e.name, e.games, e.starts, e.sat, f(l.pts), f(l.reb), f(l.ast), f(l.fg3m), f(l.stl), f(l.blk), f(l.to), pair('fgm', 'fga'), pair('ftm', 'fta')]; })));
  else lines.push('None.');

  const agents = (snapshot.freeAgents ?? []).slice(0, faLimit);
  lines.push('', `## Free agents (first ${agents.length}, Yahoo page order)`, '',
    ...table(['Player', 'Team', 'Positions', 'Status', 'Waiver clears', 'Games left'],
      agents.map((p) => [p.name, text(p.nbaTeam), positions(p), status(p), p.waiverClears ?? 'free agent', left(p)])));

  const pending = r.pending ?? {};
  lines.push('', '## Pending moves', '');
  for (const w of pending.waivers ?? []) lines.push(`- Claim ${w.order} (${w.date}): add ${w.add}${w.bid == null ? '' : ` for $${w.bid}`}${w.drop ? `, drop ${w.drop}` : ''}`);
  if (pending.warning) lines.push(`- Warning: ${pending.warning}`);
  lines.push(`- Proposed trades: ${snapshot.team.pending?.proposedTrades ?? 0}`);

  lines.push('', '## Players the tool could not score', '');
  for (const p of r.unscored) lines.push(`- ${p.name} (${text(p.nbaTeam)}, ${p.where}): ${p.reason}`);
  if (!r.unscored.length) lines.push('None.');
  return lines.join('\n') + '\n';
}
