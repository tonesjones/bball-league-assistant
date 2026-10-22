import { parseSettings } from './settings.mjs';
import { parseTeam } from './team.mjs';
import { parseMatchup } from './matchup.mjs';
import { parseFreeAgents } from './free-agents.mjs';
import { parseTransactions } from './transactions.mjs';
import { validate } from '../league-state.mjs';

// Day columns are M/D. The year is asOf's, moved by one when the dates cross New Year.
function isoDay(md, asOf) {
  const [m, d] = md.split('/').map(Number);
  const ref = new Date(asOf), refMonth = ref.getUTCMonth() + 1;
  const year = ref.getUTCFullYear() + (m < refMonth - 6 ? 1 : m > refMonth + 6 ? -1 : 0);
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// pages: { settings, team, matchup, transactions, 'fa-1': text, 'fa-2': text, ... }
export function buildSnapshot(pages, asOf) {
  const missing = ['settings', 'team', 'matchup', 'transactions'].filter((k) => typeof pages[k] !== 'string');
  const faKeys = Object.keys(pages).filter((k) => /^fa-\d+$/.test(k)).sort((a, b) => a.slice(3) - b.slice(3));
  if (!faKeys.length) missing.push('fa-1');
  if (missing.length) throw new Error(`missing page text: ${missing.join(', ')}`);

  const settings = parseSettings(pages.settings);
  const team = parseTeam(pages.team);
  const m = parseMatchup(pages.matchup);
  if (m.teamName !== team.name) {
    throw new Error(`matchup page is not my team's matchup: "${m.teamName}" does not match "${team.name}"`);
  }
  const transactions = parseTransactions(pages.transactions);
  const freeAgents = faKeys
    .flatMap((k) => parseFreeAgents(pages[k], k))
    .map((p, i) => ({ rank: i + 1, ...p }));

  const snapshot = {
    asOf,
    settings,
    team,
    matchup: {
      week: m.week,
      start: isoDay(m.days[0], asOf),
      end: isoDay(m.days.at(-1), asOf),
      opponentName: m.opponentName,
      totals: m.totals,
      volume: m.volume,
      score: m.score,
      opponentRoster: m.opponentRoster,
    },
    freeAgents,
    transactions,
  };
  validate(snapshot);
  return snapshot;
}
