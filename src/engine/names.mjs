export function normalizeName(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[.'’\-]/g, ' ').replace(/\b([a-z])\s+(?=[a-z]\b)/g, '$1').replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const parts = (name) => { const [first = '', ...rest] = normalizeName(name).split(' '); return { first, last: rest.join(' ') }; };

// Exact normalized name, then same last name with one first name a prefix of the other (Cam, Cameron).
// A team match breaks ties; two players on the same team, or two elsewhere, are ambiguous.
// Single initials need a unique match on the given team.
export function findPlayer(players, name, team) {
  const key = normalizeName(name), want = parts(name);
  const pick = (list) => {
    const onTeam = list.filter((p) => team && p.team === team);
    if (onTeam.length === 1) return { player: onTeam[0] };
    if (onTeam.length > 1 || list.length > 1) return { reason: 'ambiguous' };
    return list.length ? { player: list[0] } : null;
  };
  return pick(players.filter((p) => normalizeName(p.name) === key)) ?? pick(players.filter((p) => {
    const got = parts(p.name);
    return got.last === want.last && got.first.length > 1 && want.first.length > 1 && (got.first.startsWith(want.first) || want.first.startsWith(got.first));
  })) ?? (team && want.first.length === 1 ? pick(players.filter((p) => {
    // Match the full name's tail: "D. Sharpe" vs "Day'Ron Sharpe", whose apostrophe splits the first name.
    return p.team === team && parts(p.name).first.startsWith(want.first) && normalizeName(p.name).endsWith(` ${want.last}`);
  })) : null) ?? { reason: 'not found' };
}
