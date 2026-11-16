// Parses each captured page on its own for the facts sheet. Pure: text in, data or a reason out.
// A failed page never stops the others. Reasons leave out the page text the parsers quote.
import { parseSettings } from './yahoo-pages/settings.mjs';
import { parseTeam, parseOtherTeam } from './yahoo-pages/team.mjs';
import { parseMatchup } from './yahoo-pages/matchup.mjs';
import { parseFreeAgents } from './yahoo-pages/free-agents.mjs';
import { parseTransactions } from './yahoo-pages/transactions.mjs';
import { parseRosterTree } from './yahoo-pages/roster-tree.mjs';
import { parseTeamValues } from './yahoo-pages/team-values.mjs';

const PARSERS = {
  settings: parseSettings,
  team: parseTeam,
  matchup: (t) => parseMatchup(t, 'matchup'),
  'matchup-totals': (t) => parseMatchup(t, 'matchup-totals'),
  'matchup-next': (t) => parseMatchup(t, 'matchup-next'),
  transactions: parseTransactions,
  'team-values': parseTeamValues,
};

export const shortReason = (err) => String(err?.message ?? err).replace(/: "[\s\S]*$/, '').replace(/^[\w/-]+: (?=line \d)/, '');

function parseOne(input, parse) {
  if (input == null) return { ok: false, reason: 'missing' };
  if (typeof input !== 'string') return { ok: false, reason: input.reason };
  if (!input.trim()) return { ok: false, reason: 'empty file' };
  try {
    return { ok: true, value: parse(input) };
  } catch (err) {
    return { ok: false, reason: shortReason(err) };
  }
}

// texts: { settings, team, 'team-tree', 'team-values', matchup, 'matchup-totals', 'matchup-next', transactions, 'fa-N', 'teams/N', 'teams/N-tree' },
// each a string or { reason } when the capture logged the page as skipped.
export function parsePages(texts) {
  const out = {};
  for (const [key, parse] of Object.entries(PARSERS)) out[key] = parseOne(texts[key], parse);
  const numbered = (re) => Object.keys(texts).filter((k) => re.test(k)).sort((a, b) => Number(/\d+$/.exec(a)[0]) - Number(/\d+$/.exec(b)[0]));
  out.fa = numbered(/^fa-\d+$/).map((k) => ({ file: `${k}.txt`, ...parseOne(texts[k], (t) => parseFreeAgents(t, k)) }));
  // A header-only team page (Chrome) comes with <page>-tree.txt, the roster table's accessibility tree.
  const activeSlots = out.settings.ok ? out.settings.value.rosterPositions.filter((p) => !['BN', 'IL', 'IL+', 'NA'].includes(p.slot))
    .flatMap((p) => Array(p.count).fill(p.slot)) : null;
  const tree = (key) => (texts[`${key}-tree`] == null ? null
    : { file: `${key}-tree.txt`, ...parseOne(texts[`${key}-tree`], (t) => parseRosterTree(t, `${key}-tree`, { activeSlots: key === 'team' ? activeSlots : null })) });
  out['team-tree'] = tree('team');
  out.teams = numbered(/^teams\/\d+$/).map((k) => {
    const plain = { file: `${k}.txt`, teamNumber: Number(k.slice(6)), ...parseOne(texts[k], (t) => parseOtherTeam(t, k)) };
    const t = plain.ok ? null : tree(k);
    return t?.ok ? { ...t, teamNumber: plain.teamNumber } : t ? { ...plain, reason: `${plain.reason}; ${t.file}: ${t.reason}` } : plain;
  });
  return out;
}
