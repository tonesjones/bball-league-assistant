import { HOT_WINDOWS, HOT_PAGES, TAKEN_OFFSETS, takenFile } from './hot-lists.mjs';

// Pure helpers for the public (signed-out) capture in scripts/capture-public.mjs. No I/O.
// The league's pages are public, so a cloud session reads them without signing in to Yahoo.
// See docs/update-league.md, "Cloud capture".

export const BASE = 'https://basketball.fantasysports.yahoo.com/nba';
export const FA_OFFSETS = [0, 25, 50, 75];

// Pages to read before the week number is known.
export function firstPages(league, team) {
  return [
    { file: 'settings.txt', url: `${BASE}/${league}/settings` },
    { file: 'team.txt', url: `${BASE}/${league}/${team}` },
    { file: 'matchup.txt', url: `${BASE}/${league}/matchup?mid1=${team}` },
  ];
}

// Pages that need the week number from matchup.txt and the team count from settings.txt.
// Sunday nights also read next week's matchup, because a claim placed then counts next week.
export function laterPages(league, team, { week, teams, sunday }) {
  const pages = [];
  if (week != null) pages.push({ file: 'matchup-totals.txt', url: `${BASE}/${league}/matchup?mid1=${team}&week=${week}` });
  if (week != null && sunday) pages.push({ file: 'matchup-next.txt', url: `${BASE}/${league}/matchup?mid1=${team}&week=${week + 1}` });
  for (const [i, count] of FA_OFFSETS.entries()) {
    pages.push({ file: `fa-${i + 1}.txt`, url: `${BASE}/${league}/players?status=A&pos=P&sort=AR&sdir=1&count=${count}` });
  }
  for (const w of HOT_WINDOWS) {
    for (let i = 0; i < HOT_PAGES; i++) {
      pages.push({ file: `hot-${w.key}-${i + 1}.txt`, url: `${BASE}/${league}/players?status=A&pos=P&stat1=${w.stat}&sort=AR&sdir=1&count=${i * 25}` });
    }
  }
  pages.push({ file: 'transactions.txt', url: `${BASE}/${league}/transactions` });
  for (let n = 1; n <= (teams ?? 0); n++) {
    if (String(n) !== String(team)) pages.push({ file: `teams/${n}.txt`, url: `${BASE}/${league}/${n}` });
  }
  return pages;
}

// Taken-player pages, one list per recent window, in page order. The capture reads a window's
// pages in order and stops it early once takenWindowDone says so.
export function takenPages(league) {
  return HOT_WINDOWS.map((w) => ({
    stat: w.stat,
    pages: TAKEN_OFFSETS.map((n) => ({ file: takenFile(w.stat, n), url: `${BASE}/${league}/players?status=T&pos=P&stat1=${w.stat}&sort=AR&sdir=1&count=${n}` })),
  }));
}

// A window is done when every rostered player (name|team keys) has been seen on its pages, or when
// a page came back short (fewer than 25 rows: the end of the list). Without a roster, read them all.
export function takenWindowDone(rosterKeys, seenKeys, lastPageRows) {
  if (lastPageRows != null && lastPageRows < 25) return true;
  return rosterKeys.length > 0 && rosterKeys.every((k) => seenKeys.has(k));
}

// "Max Teams:<TAB>12" on the settings page.
export function teamCount(settingsText) {
  const m = /^Max Teams:\s*(\d+)\s*$/m.exec(settingsText ?? '');
  return m ? Number(m[1]) : null;
}

// The first "Week N" line on the matchup page.
export function matchupWeek(matchupText) {
  const m = /^\s*Week (\d+)\b/m.exec(matchupText ?? '');
  return m ? Number(m[1]) : null;
}

// Folder stamp YYYY-MM-DD-HHmm and weekday in the given time zone.
export function stamp(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { folder: `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}`, weekday: parts.weekday };
}

// The first line of _log.txt for a public capture. scripts/sheet.mjs reads it to accept the
// signed-out view of every page.
export const PUBLIC_MODE_LINE = 'mode: public (signed out)';
export const isPublicLog = (logText) => String(logText ?? '').split(/\r?\n/).some((l) => l.trim() === PUBLIC_MODE_LINE);
