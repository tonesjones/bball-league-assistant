import { load, fail, indexOf, rejectSignedOut } from './common.mjs';

const CAT = { 'FG%': 'FG%', 'FT%': 'FT%', '3PTM': '3PM', '3PM': '3PM', PTS: 'PTS', REB: 'REB', AST: 'AST', ST: 'STL', STL: 'STL', BLK: 'BLK', TO: 'TO' };
const SCORING = { 'Head-to-Head - Categories': 'h2h-each-category', 'Head-to-Head - Most Categories': 'h2h-most-categories' };

export function parseSettings(text, page = 'settings') {
  rejectSignedOut(text, page);
  const L = load(text);
  const h = indexOf(page, L, (s) => s === 'Setting\tValue', 'the "Setting<TAB>Value" table');
  const raw = {};
  for (let i = h + 1; i < L.length && L[i].s.includes('\t'); i++) {
    const [k, ...v] = L[i].s.split('\t');
    raw[k.trim().replace(/:$/, '')] = v.join('\t').trim();
  }
  const get = (key) => {
    if (raw[key] === undefined) throw fail(page, L[h], `missing setting "${key}"`);
    return raw[key];
  };
  const row = (key) => L.find((l) => l.s.startsWith(key)) ?? L[h];

  const scoringType = SCORING[get('Scoring Type')];
  if (!scoringType) throw fail(page, row('Scoring Type'), 'unknown scoring type');

  const categories = [...get('Players Stat Categories').matchAll(/\(([^)]+)\)/g)].map((m) => {
    if (!CAT[m[1]]) throw fail(page, row('Players Stat Categories'), `unknown stat category "${m[1]}"`);
    return CAT[m[1]];
  });
  if (!categories.length) throw fail(page, row('Players Stat Categories'), 'no stat categories');

  const rosterPositions = [];
  for (const slot of get('Roster Positions').split(',').map((s) => s.trim()).filter(Boolean)) {
    const hit = rosterPositions.find((p) => p.slot === slot);
    if (hit) hit.count++;
    else rosterPositions.push({ slot, count: 1 });
  }
  if (!rosterPositions.length) throw fail(page, row('Roster Positions'), 'no roster positions');

  const limit = (key, value) => {
    if (/^no max/i.test(value)) return null;
    if (!/^\d+$/.test(value)) throw fail(page, row(key), `expected a number or "No maximum" for "${key}"`);
    return Number(value);
  };
  const maxAddsPerWeek = limit('Max Acquisitions per Week', get('Max Acquisitions per Week'));
  const gamesKey = Object.keys(raw).find((k) => /max.*games/i.test(k));
  const maxGamesPerWeek = gamesKey ? limit(gamesKey, raw[gamesKey]) : null;

  const waiver = get('Waiver Type');
  const waiverType = /^FAB/i.test(waiver) ? 'faab' : waiver;

  const p = /^(\d+) teams? - Weeks? (.+?) \(ends (.+)\)$/.exec(get('Playoffs'));
  if (!p) throw fail(page, row('Playoffs'), 'unrecognized playoffs format');
  const playoffs = { teams: Number(p[1]), weeks: p[2].match(/\d+/g).map(Number), endsOn: p[3] };

  return { scoringType, categories, rosterPositions, maxAddsPerWeek, maxGamesPerWeek, waiverType, playoffs, raw };
}
