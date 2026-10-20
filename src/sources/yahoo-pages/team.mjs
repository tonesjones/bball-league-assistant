import { load, fail, indexOf, stopIndex, player, SLOT_RE, NAME_RE } from './common.mjs';

export function parseTeam(text, page = 'team') {
  const L = load(text);
  const t = indexOf(page, L, (s) => s === 'Yahoo Sports Fantasy Basketball', 'the "Yahoo Sports Fantasy Basketball" heading');
  const name = L[t + 1]?.s;
  if (!name) throw fail(page, L[t], 'no team name after the heading');

  const r = indexOf(page, L, (s) => s === 'Record', 'the "Record" label');
  const rec = /^(\d+)-(\d+)-(\d+)$/.exec(L[r - 1]?.s ?? '');
  if (!rec) throw fail(page, L[r - 1] ?? L[r], 'expected a W-L-T record before "Record"');

  const b = indexOf(page, L, (s) => /^Waiver Budget: /.test(s), 'the "Waiver Budget" line');
  const budget = /^Waiver Budget: \$(\d+(?:\.\d+)?)$/.exec(L[b].s);
  if (!budget) throw fail(page, L[b], 'unrecognized waiver budget');

  const pos = indexOf(page, L, (s) => s === 'Pos', 'the roster table header ("Pos")');
  const hdr = indexOf(page, L, (s) => s === 'TO', 'the end of the roster table header ("TO")', pos);
  const stop = stopIndex(L, hdr);

  const roster = [];
  for (let i = hdr + 1; i < stop; i++) {
    const l = L[i];
    if (SLOT_RE.test(l.s) && L[i + 1] && NAME_RE.test(L[i + 1].s)) {
      roster.push(player(page, L[i + 1], L[i + 2], l.s));
      i += 2;
    } else if (NAME_RE.test(l.s)) throw fail(page, l, 'player row without a slot before it');
  }
  if (!roster.length) throw fail(page, L[hdr], 'no roster rows');

  return { name, record: { wins: +rec[1], losses: +rec[2], ties: +rec[3] }, faabBalance: Number(budget[1]), roster };
}
