import { load, fail, indexOf, stopIndex, player, NAME_RE, rejectSignedOut } from './common.mjs';

const PCT_RE = /^\d{1,3}%$/;
const RANK_RE = /^(\d+|-)$/;
const value = (s) => (s === '-' ? null : Number(s));

// Yahoo's "Current" rank (rank among all players for the page's stat window) and games played,
// for each player row on a players list page (fa-*, hot-*, taken-*) or a team page.
//
// List pages: a row reads name, "TEAM - POS", optional game result, opponent, roster status,
// GP*, Pre-Season, Current, % Ros. Current is the line before the "NN%" line, GP* three lines
// before it. Team pages (layout 'team'): Current is the line before "NN%" when the row has one;
// otherwise the first whole number after GP* and the opponent (a "Rank" column). GP* is the first
// whole number after "TEAM - POS". A "-" reads as null.
export function parseRankRows(text, page, { publicView = false, layout = 'list' } = {}) {
  rejectSignedOut(text, page, { publicView });
  const L = load(text);
  const head = layout === 'team' ? 'Pos' : 'Roster Status';
  const h = indexOf(page, L, (s) => s === head, `the player table header ("${head}")`);
  const hdr = indexOf(page, L, (s) => s === 'TO', 'the end of the player table header ("TO")', h);
  const cols = L.slice(h, hdr).map((l) => l.s);
  if (!cols.includes('Current') && !cols.includes('Rank')) throw fail(page, L[h], 'no "Current" or "Rank" column in the player table header');
  const stop = stopIndex(L, hdr);
  const out = [];
  for (let i = hdr + 1; i < stop; i++) {
    if (!NAME_RE.test(L[i].s)) continue;
    const { name, nbaTeam } = player(page, L[i], L[i + 1]);
    let j = i + 2;
    while (j < stop && !NAME_RE.test(L[j].s)) j++;
    const row = L.slice(i + 2, j).map((l) => l.s);
    const p = row.findIndex((s) => PCT_RE.test(s));
    let rank = null, gp = null;
    if (layout === 'team') {
      const g = row.findIndex((s) => /^\d+$/.test(s));
      if (g >= 0) gp = Number(row[g]);
      if (p > 0 && RANK_RE.test(row[p - 1])) rank = value(row[p - 1]);
      else if (p < 0 && g >= 0) {
        const r = row.slice(g + 1).find((s) => RANK_RE.test(s));
        if (r != null) rank = value(r);
      }
    } else {
      if (p < 3) throw fail(page, L[i], 'player row without "GP*, Pre-Season, Current, NN%"');
      if (!RANK_RE.test(row[p - 1]) || !RANK_RE.test(row[p - 3])) throw fail(page, L[i], 'expected whole numbers or "-" for GP* and Current');
      rank = value(row[p - 1]);
      gp = value(row[p - 3]);
    }
    out.push({ name, nbaTeam, rank, gp });
    i = j - 1;
  }
  if (!out.length) throw fail(page, L[hdr], 'no player rows');
  return out;
}
