import { parseSettings } from './settings.mjs';
import { parseTeam } from './team.mjs';
import { parseMatchup } from './matchup.mjs';
import { parseFreeAgents } from './free-agents.mjs';
import { parseTransactions } from './transactions.mjs';
import { validate } from '../league-state.mjs';

// Tony's adds this week. Transactions are [] until a real example fixes their shape.
export function countAdds(transactions, teamName) {
  return transactions.filter((t) => t.type === 'add' && t.team === teamName).length;
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
    throw new Error(`matchup: first team "${m.teamName}" is not the team page's team "${team.name}"`);
  }
  const transactions = parseTransactions(pages.transactions);
  const freeAgents = faKeys
    .flatMap((k) => parseFreeAgents(pages[k], k))
    .map((p, i) => ({ rank: i + 1, ...p }));

  const snapshot = {
    asOf,
    settings,
    team: { ...team, addsUsedThisWeek: countAdds(transactions, team.name) },
    matchup: {
      week: m.week,
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
