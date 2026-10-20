import { load, fail, indexOf, stopIndex, player, NAME_RE } from './common.mjs';

// One page of Yahoo's available-players list, in the order shown. The rank is assigned by the caller.
export function parseFreeAgents(text, page = 'fa') {
  const L = load(text);
  const r = indexOf(page, L, (s) => s === 'Roster Status', 'the player table header ("Roster Status")');
  const hdr = indexOf(page, L, (s) => s === 'TO', 'the end of the player table header ("TO")', r);
  const stop = stopIndex(L, hdr);
  const out = [];
  for (let i = hdr + 1; i < stop; i++) {
    if (!NAME_RE.test(L[i].s)) continue;
    const { name, nbaTeam, positions, status } = player(page, L[i], L[i + 1]);
    let waiverClears = null;
    let j = i + 2;
    for (; j < stop && !NAME_RE.test(L[j].s); j++) {
      const w = /^W \((.+)\)$/.exec(L[j].s);
      if (w && waiverClears === null) waiverClears = w[1];
    }
    out.push({ name, nbaTeam, positions, status, waiverClears });
    i = j - 1;
  }
  if (!out.length) throw fail(page, L[hdr], 'no player rows');
  return out;
}
