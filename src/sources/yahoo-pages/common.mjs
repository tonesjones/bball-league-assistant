// Shared helpers for the page parsers. Parsers are pure: text in, data out.

export const SLOT_RE = /^(PG|SG|G|SF|PF|F|C|Util|BN|IL\+?|NA)$/;
export const NAME_RE = /^(.+?)(INJ|GTD|DTD|SUSP|NA|O|P|Q|D)?(?:New Player Note|Player Note|No new player Notes)$/;
export const TEAMPOS_RE = /^([A-Z]{2,3}) - ([A-Z]{1,2}(?:,[A-Z]{1,2})*)$/;
export const CATEGORIES = ['FG%', 'FT%', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'];

// Non-blank lines with their 1-based line numbers; non-breaking spaces become plain spaces.
export function load(text) {
  return String(text)
    .replace(/ /g, ' ')
    .split(/\r?\n/)
    .map((s, i) => ({ n: i + 1, s: s.trim() }))
    .filter((l) => l.s !== '');
}

export function rejectSignedOut(text, page) {
  if (text.split(/\r?\n/).some((line) => line.trim() === 'Sign in')) {
    throw new Error(`signed out of Yahoo: ${page} page; sign in to Yahoo in the browser pane and refresh`);
  }
}

export function end(lines) {
  const last = lines[lines.length - 1];
  return { n: last ? last.n + 1 : 1, s: '<end of text>' };
}

export function fail(page, line, why) {
  return new Error(`${page}: line ${line.n}: ${why}: "${line.s}"`);
}

export function indexOf(page, lines, test, why, from = 0) {
  for (let i = from; i < lines.length; i++) if (test(lines[i].s)) return i;
  throw fail(page, end(lines), `${why} not found`);
}

export function stopIndex(lines, from) {
  for (let i = from; i < lines.length; i++) {
    if (/^(Legends and Glossaries|Stats associated with players|Previous \d+|Yahoo Sports - NBC)/.test(lines[i].s)) return i;
  }
  return lines.length;
}

export function player(page, nameLine, teamLine, slot = null) {
  const m = NAME_RE.exec(nameLine.s);
  if (!m) throw fail(page, nameLine, 'expected a player name line');
  const name = m[1].trim();
  if (/[A-Z]$/.test(name) && !/ (II|III|IV|V)$/.test(name)) throw fail(page, nameLine, 'unknown injury status code after the player name');
  const t = TEAMPOS_RE.exec(teamLine?.s ?? '');
  if (!t) throw fail(page, teamLine ?? nameLine, 'expected "TEAM - POS,POS" after the player name');
  return { name, nbaTeam: t[1], positions: t[2].split(','), status: m[2] ?? null, slot };
}

// "-" becomes null.
export function num(page, line) {
  if (line.s === '-') return null;
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(line.s)) throw fail(page, line, 'expected a number or "-"');
  return Number(line.s);
}
