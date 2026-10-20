import { load, fail, indexOf, stopIndex, player, num, SLOT_RE, NAME_RE, CATEGORIES } from './common.mjs';

const DAY_RE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}\/\d{1,2})$/;
const HEADER = ['Team', 'FGM/A*', 'FG%', 'FTM/A*', 'FT%', '3PTM', 'PTS', 'REB', 'AST', 'ST', 'BLK', 'TO'];

function ratio(page, line) {
  if (line.s === '-/-') return [null, null];
  const m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(line.s);
  if (!m) throw fail(page, line, 'expected "made/attempted" or "-/-"');
  return [Number(m[1]), Number(m[2])];
}

// A team name line, 11 stat cells, then the number of categories that team leads.
function totalsRow(page, L, i) {
  const c = L.slice(i + 1, i + 13);
  if (c.length < 12) throw fail(page, L[i], 'totals row is cut short');
  const [fgm, fga] = ratio(page, c[0]);
  const [ftm, fta] = ratio(page, c[2]);
  const v = [c[1], c[3], ...c.slice(4, 11)].map((l) => num(page, l));
  const score = num(page, c[11]);
  if (score === null) throw fail(page, c[11], 'expected a category score');
  return {
    name: L[i].s,
    totals: Object.fromEntries(CATEGORIES.map((k, j) => [k, v[j]])),
    volume: { fgm, fga, ftm, fta },
    score,
  };
}

export function parseMatchup(text, page = 'matchup') {
  const L = load(text);
  const w = indexOf(page, L, (s) => /^Week \d+$/.test(s), 'the "Week N" heading');
  const h = indexOf(page, L, (s) => s === HEADER[0], 'the totals table header ("Team")');
  HEADER.forEach((label, j) => {
    if (L[h + j]?.s !== label) throw fail(page, L[h + j] ?? L[h], `expected totals column "${label}"`);
  });
  const days = L.slice(w, h).map((l) => DAY_RE.exec(l.s)?.[1]).filter(Boolean);
  if (!days.length) throw fail(page, L[w], 'no day columns (like "Tue 10/20") after the week heading');
  const mine = totalsRow(page, L, h + HEADER.length);
  const opp = totalsRow(page, L, h + HEADER.length + 13);

  // Player rows alternate: yours, a slot label, the opponent's.
  const from = h + HEADER.length + 26;
  const stop = stopIndex(L, from);
  const heads = [];
  for (let i = from; i < stop; i++) if (NAME_RE.test(L[i].s)) heads.push(i);
  if (!heads.length) throw fail(page, L[from] ?? L[h], 'no player rows');
  if (heads.length % 2) throw fail(page, L[heads[heads.length - 1]], 'player rows come in pairs (yours, then the opponent)');

  const roster = [];
  const opponentRoster = [];
  heads.forEach((at, k) => {
    const next = heads[k + 1] ?? stop;
    let slot = null;
    let cells = 0;
    for (let i = at + 2; i < next; i++) {
      if (SLOT_RE.test(L[i].s)) {
        if (slot !== null || k % 2) throw fail(page, L[i], 'unexpected slot label');
        slot = L[i].s;
      } else {
        num(page, L[i]);
        cells++;
      }
    }
    if (cells !== 9) throw fail(page, L[at], `expected 9 stat cells, found ${cells}`);
    if (k % 2 === 0) {
      if (slot === null) throw fail(page, L[at], 'no slot label after this player');
      roster.push(player(page, L[at], L[at + 1], slot));
    } else opponentRoster.push(player(page, L[at], L[at + 1], roster[roster.length - 1].slot));
  });

  return {
    week: Number(/\d+/.exec(L[w].s)[0]),
    days,
    teamName: mine.name,
    opponentName: opp.name,
    totals: { mine: mine.totals, opponent: opp.totals },
    volume: { mine: mine.volume, opponent: opp.volume },
    score: { mine: mine.score, opponent: opp.score },
    roster,
    opponentRoster,
  };
}
