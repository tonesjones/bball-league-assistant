// Read-only Yahoo pages the league fetch may open. Everything else on yahoo.com is refused.

const HOST = 'basketball.fantasysports.yahoo.com';

// Page name (or a team number) -> query keys allowed on it.
const PAGES = {
  settings: [],
  matchup: ['mid1', 'mid2', 'week'],
  players: ['status', 'pos', 'sort', 'sdir', 'count'],
  transactions: [],
  draft: [],
  draftresults: [],
};

function parse(raw) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

// Returns null when the URL is allowed, or a reason string when it isn't.
export function checkUrl(raw, leagueId) {
  if (typeof raw !== 'string' || raw === '') return null;
  if (raw === 'back' || raw === 'forward') return 'history navigation is not used by the league fetch';
  const url = parse(raw);
  if (!url) return `not a URL: ${raw}`;
  const host = url.hostname.toLowerCase();
  if (host !== 'yahoo.com' && !host.endsWith('.yahoo.com')) return null;

  if (host !== HOST || url.protocol !== 'https:') return `only https://${HOST} pages are allowed on yahoo.com`;
  const m = url.pathname.match(/^\/nba\/(\d+)\/([a-z]+|\d+)\/?$/);
  if (!m) return `path ${url.pathname} is not a read-only league page`;
  const [, league, page] = m;
  if (leagueId && league !== leagueId) return `league ${league} is not YAHOO_LEAGUE_ID`;
  const allowedKeys = /^\d+$/.test(page) ? [] : PAGES[page];
  if (!allowedKeys) return `page "${page}" is not on the read-only list`;
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.includes(key)) return `query parameter "${key}" is not allowed on ${page}`;
  }
  return null;
}
