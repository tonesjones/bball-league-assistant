import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSheet, SHEET_VERSION, lastLine, indexLogs } from '../src/engine/sheet.mjs';
import { parsePages } from '../src/sources/sheet-pages.mjs';
import { parseInjuries } from '../src/sources/espn-injuries.mjs';
import { readFileSync } from 'node:fs';

// A three-slot league (PG, C, Util) with made-up players. Week 4 runs Mon 11-09 to Sun 11-15.
const ok = (value) => ({ ok: true, value });
const no = (reason) => ({ ok: false, reason });
const pl = (name, nbaTeam, positions, slot, status = null) => ({ name, nbaTeam, positions, slot, status });
const settings = { rosterPositions: [{ slot: 'PG', count: 1 }, { slot: 'C', count: 1 }, { slot: 'Util', count: 1 }, { slot: 'BN', count: 1 }, { slot: 'IL', count: 1 }],
  maxAddsPerWeek: 4, raw: { 'Max Teams': '4' } };
const tonyRoster = () => [pl('Ann Able', 'AAA', ['PG'], 'PG'), pl('Bo Baker', 'BBB', ['C'], 'C'), pl('Cy Cole', 'CCC', ['PG', 'SG'], 'Util', 'Q'),
  pl('Di Dunn', 'DDD', ['C'], 'BN', 'O'), pl('Ed Eve', 'EEE', ['SF'], 'IL', 'D')];
const oppRoster = () => [pl('Fay Fox', 'AAA', ['C'], 'C'), pl('Gus Gray', 'ZZZ', ['PG'], 'PG')];
const empty = () => Object.fromEntries(['FG%', 'FT%', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'].map((c) => [c, 1]));
const nullVolume = { fgm: null, fga: null, ftm: null, fta: null };
const matchup = (week = 4, days = ['11/9', '11/10', '11/11', '11/12', '11/13', '11/14', '11/15'], opponentName = 'Opp Team') => ({
  week, days, teamName: 'Tony Team', opponentName, totals: { mine: empty(), opponent: empty() }, volume: { mine: nullVolume, opponent: nullVolume },
  score: { mine: 0, opponent: 0 }, roster: tonyRoster(), opponentRoster: oppRoster() });
const totalsPage = () => ({ ...matchup(), volume: { mine: { fgm: 10, fga: 20, ftm: 4, fta: 5 }, opponent: { fgm: 9, fga: 18, ftm: 2, fta: 4 } } });
const transactions = [
  { team: 'Tony Team', time: 'Nov 10, 1:05 am', moves: [{ player: 'Jo Jay', nbaTeam: 'JJJ', type: 'add', faab: 3 }, { player: 'Ko Kay', nbaTeam: 'KKK', type: 'drop', faab: null }] },
  { team: 'Rival Team', time: 'Nov 11, 1:05 am', moves: [{ player: 'Lu Lee', nbaTeam: 'LLL', type: 'add', faab: 7 }] },
];
const freeAgents = [{ name: 'Hal Hill', nbaTeam: 'HHH', positions: ['C'], status: null, waiverClears: 'Nov 12' },
  { name: 'Ivy Ink', nbaTeam: 'BBB', positions: ['PG'], status: null, waiverClears: 'Nov 14' }];
const pages = (over = {}) => ({
  settings: ok(settings), team: ok({ name: 'Tony Team', faabBalance: 90, addsUsedThisWeek: 1, roster: tonyRoster() }),
  matchup: ok(matchup()), 'matchup-totals': ok(totalsPage()), 'matchup-next': no('missing'), transactions: ok(transactions),
  fa: [{ file: 'fa-1.txt', ...ok(freeAgents) }], teams: [], ...over,
});

const ids = { players: ['Ann Able:AAA', 'Bo Baker:BBB', 'Cy Cole:CCC', 'Di Dunn:DDD', 'Ed Eve:EEE', 'Fay Fox:AAA', 'Hal Hill:HHH', 'Ivy Ink:BBB']
  .map((s, i) => ({ espnId: String(i + 1), name: s.split(':')[0], team: s.split(':')[1] })) };
const games = [['2026-11-12', 'AAA', 'CCC'], ['2026-11-12', 'DDD', 'XXX'], ['2026-11-13', 'BBB', 'HHH'], ['2026-11-13', 'ZZZ', 'YYY'],
  ['2026-11-14', 'AAA', 'BBB'], ['2026-11-14', 'CCC', 'HHH'], ['2026-11-16', 'AAA', 'BBB'], ['2026-11-17', 'HHH', 'ZZZ']];
const schedule = { season: '2026-27', games: games.map(([date, home, away]) => ({ date, home, away })) };

const row = (espnId, date, min, s = {}) => ({ espnId, date, espnEventId: `${date}-${espnId}`, didNotPlay: false, starter: false, min,
  pts: 10, reb: 4, ast: 2, stl: 1, blk: 0, fg3m: 1, to: 2, fgm: 4, fga: 8, ftm: 1, fta: 2, ...s });
const d = (n) => `2026-11-${String(n).padStart(2, '0')}`;
const logs = () => [
  // Ann: six games; the oldest is outside the last five. A 0-minute game and a DNP come last and do not count.
  row('1', d(1), 30, { pts: 100, fgm: 0, fga: 10 }), ...[10, 12, 14, 16, 18].map((pts, i) => row('1', d(3 + i), 30, { pts, fgm: 5, fga: 10 })),
  row('1', d(9), 0, { pts: 0 }), { ...row('1', d(10), 0), didNotPlay: true },
  // Bo: two games.
  row('2', d(6), 20), row('2', d(8), 24),
  // Cy, Fay, Hal: five games each.
  ...[3, 4, 5, 6, 7].flatMap((n) => [row('3', d(n), 25, { fgm: 2, fga: 10 }), row('6', d(n), 28), row('7', d(n), 22)]),
];
const injuries = { ok: true, value: parseInjuries(JSON.parse(readFileSync(new URL('./fixtures/espn/injuries.json', import.meta.url), 'utf8'))) };
const sheet = (over = {}, input = {}) => buildSheet({ injuries, folder: '2026-11-11-2300', captureDate: '2026-11-11', captureTime: '23:00', pages: pages(over),
  ids, schedule, logs: logs(), coverage: { checkedAt: '2026-11-12T07:00:00.000Z', through: '2026-11-11' }, scoreboard: { final: 3, notFinal: 0 }, ...input });
const section = (md, n) => md.split(/\n(?=## )/).find((s) => s.startsWith(`## ${n}.`));
const rowOf = (text, name) => text.split('\n').find((l) => l.startsWith(`| ${name} |`)) ?? '';

test('the header gives the version, the claim date and the processing week', () => {
  const h = section(sheet().markdown, 1);
  assert.equal(SHEET_VERSION, 5);
  assert.match(h, /Sheet version: 5/);
  assert.match(h, /Capture as of: 2026-11-11 23:00 \(Wed\)/);
  assert.match(h, /Games on 2026-11-11: 3 final, 0 not final/);
  assert.match(h, /First date a claim placed tonight can play: 2026-11-12 \(Thu\)/);
  assert.match(h, /Processing week: week 4, 2026-11-09 to 2026-11-15/);
  assert.match(section(sheet({}, { scoreboard: null }).markdown, 1), /Games on 2026-11-11: unknown/);
});

test('FG% comes from summed makes and attempts, banked plus projected', () => {
  const m = section(sheet().markdown, 3);
  const [base, cautious] = m.split('### Cautious');
  // Remaining: Ann 2 starts at 5/10, Cy (Q) 2 at 2/10, Bo 2 at 4/8: 22/56. Banked 10/20. Di is O and adds nothing.
  assert.match(rowOf(base, 'FG%'), /\| 0\.500 \(10\/20\) \| 0\.393 \(22\.0\/56\.0\) \| 0\.421 \(32\.0\/76\.0\) \|/);
  // Cautious drops Cy (Q): 18/36 remaining, 28/56 final.
  assert.match(rowOf(cautious, 'FG%'), /\| 0\.500 \(18\.0\/36\.0\) \| 0\.500 \(28\.0\/56\.0\) \|/);
  // Ann scores 14 a game twice, Cy and Bo 10 twice each: 68 remaining on 1 banked.
  assert.match(rowOf(base, 'PTS'), /^\| PTS \| 1 \| 68\.0 \| 69\.0 \|/);
  assert.match(base, /Opponent \(Opp Team, roster from matchup\.txt\): 3 starts, 1 by players with no log, not counted \(Gus Gray 11-13\)/);
});

test('last-5 lines use the last five games with minutes, and a player with no log says so', () => {
  const r = section(sheet().markdown, 5);
  assert.match(rowOf(r, 'Ann Able'), /^\| Ann Able \| PG \| {2}\| PG \| 30\.0 \| 14\.0 \| 4\.0 \|.*\| 5\.0\/10\.0 \| 1\.0\/2\.0 \| 2\.0 \| {2}\| 30\.0 \| 2: Thu 11-12, Sat 11-14 \|$/);
  assert.match(rowOf(r, 'Bo Baker'), /\| 2 \| 22\.0 \|/);
  assert.match(rowOf(r, 'Gus Gray'), /\| no log \| {2}\|.*\| no log \| 1: Fri 11-13 \|$/);
  assert.doesNotMatch(rowOf(r, 'Gus Gray'), /0\.0/);
  const line = lastLine(indexLogs(logs(), '2026-11-11').get('1'));
  assert.equal(line.games, 5);
  assert.equal(line.pts, 14);
});

test('budget, slots and the IL check', () => {
  const b = section(sheet().markdown, 2);
  assert.match(b, /Adds used this week \(team page\): 1 of 4; adds left: 3/);
  assert.match(b, /FAAB left: \$90/);
  assert.match(b, /Open roster spots \(non-IL\): 0/);
  assert.match(b, /Open IL slots: 0 of 1/);
  assert.match(b, /IL check .*: Ed Eve \(IL, status D\)/);
});

test('the open-day grid and usable starts by open slot and waiver date', () => {
  const md = sheet().markdown;
  const g = section(md, 4);
  assert.match(g, /\| Thu 11-12 \| Ann Able, Cy Cole \(Q\), Di Dunn \(O\) \| 2 of 3 \| C \| 2 \|/);
  assert.match(g, /\| Fri 11-13 \| Bo Baker \| 1 of 3 \| PG, Util \| 2 \|/);
  assert.match(g, /\| Sat 11-14 \| Ann Able, Bo Baker, Cy Cole \(Q\) \| 3 of 3 \| none \| 1 \|/);
  assert.match(g, /\| Sun 11-15 \| none \| 0 of 3 \| PG, C, Util \| 3 \|/);
  const c = section(md, 6);
  // Hal: Fri has open slots, Sat is full.
  assert.match(rowOf(c.replace(/^\| fa-1 /gm, ''), 'Hal Hill'), /\| W \(Nov 12\) \| 2: Fri 11-13, Sat 11-14 \| 1: Fri 11-13 \| 22\.0 \| 22\.0 \|/);
  // Ivy: Fri is before her waiver date, Sat is full.
  assert.match(rowOf(c.replace(/^\| fa-1 /gm, ''), 'Ivy Ink'), /\| W \(Nov 14\) \| 2: Fri 11-13, Sat 11-14 \| 0: none \| no log \|/);
});

test('candidates show last season\'s minutes and missed games; section 9 lists who is out on their teams', () => {
  // Bo and Ivy play for BBB. Ivy missed the 11-06 game and played 11-08.
  const teamLogs = [...logs().map((r) => (r.espnId === '2' ? { ...r, team: 'BBB' } : r)), { ...row('8', d(8), 26), espnEventId: `${d(8)}-2`, team: 'BBB' }];
  const md = sheet({}, { logs: teamLogs, priors: [{ name: 'Ivy Ink', mpg: 25.5 }, { name: 'Hal Hill', mpg: null }] }).markdown;
  const c = section(md, 6).replace(/^\| fa-1 /gm, '');
  assert.match(rowOf(c, 'Ivy Ink'), /\| 26\.0 \| 26\.0 \| 25\.5 \| 1 of 2; latest 1 missed, 1 back \|/);
  assert.match(rowOf(c, 'Hal Hill'), /\| 22\.0 \| 22\.0 \|  \| unknown \|/);
  const out = section(md, 9).split("### Out on the candidates' teams")[1];
  // Bo is out on Ivy's team; Hal is a candidate himself, and Zed's team has no candidate.
  assert.match(out, /\| BBB \| Bo Baker \| Out \| not given \| 22\.0 \| 2 \| 0 \|  \|/);
  assert.doesNotMatch(out, /Hal Hill|Zed Zero/);
});

test('transactions list Tony\'s moves and other managers\' winning bids', () => {
  const t = section(sheet().markdown, 8);
  assert.match(t, /\| 2026-11-10 \| Nov 10, 1:05 am \| add \| Jo Jay \| JJJ \| \$3 \|/);
  assert.match(t, /\| 2026-11-10 \| Nov 10, 1:05 am \| drop \| Ko Kay \| KKK \|  \|/);
  assert.match(t, /\| 2026-11-11 \| Nov 11, 1:05 am \| \$7 \| Lu Lee \| LLL \| Rival Team \|/);
});

test('a header-only team page: roster from the matchup page, FAAB unavailable, adds counted as a minimum', () => {
  const { markdown, status } = sheet({ team: no('line 4: the record or standing label not found') });
  const b = section(markdown, 2);
  assert.match(b, /FAAB left: UNAVAILABLE: team\.txt \(line 4: the record or standing label not found\); UNAVAILABLE: team-values\.txt \(missing\)/);
  assert.match(b, /counted on transactions\.txt, 2026-11-09 on\): 1 minimum .* adds left: 3 at most, not confirmed/);
  assert.match(b, /Roster source: matchup\.txt/);
  assert.match(section(markdown, 3), /0\.421 \(32\.0\/76\.0\)/);
  assert.ok(status.includes('2. Budget and slots: partial'));
  assert.ok(status.includes('3. Matchup by category: ok'));
});

test('a header-only team page with a tree file: roster from team-tree.txt, FAAB unavailable', () => {
  const tree = ok({ name: 'Tony Team', date: '2026-11-11', roster: tonyRoster() });
  const { markdown } = sheet({ team: no('line 3: heading not found'), 'team-tree': tree });
  assert.match(section(markdown, 2), /Roster source: team-tree\.txt/);
  assert.match(section(markdown, 2), /IL check .*: Ed Eve \(IL, status D\)/);
  assert.match(section(markdown, 2), /FAAB left: UNAVAILABLE: team\.txt/);
  assert.match(section(markdown, 5), /Roster from team-tree\.txt\./);
  assert.match(section(markdown, 8), /\| add \| Jo Jay \|/);
});

test('FAAB comes from team-values.txt when the team page did not parse, with its source file', () => {
  const parsed = parsePages({ 'team-values': 'Waiver Budget: $82\nplayer adds for this week: hidden' });
  assert.deepEqual(parsed['team-values'].value, { faabBalance: 82 });
  const b = section(sheet({ team: no('line 3: heading not found'), 'team-values': parsed['team-values'] }).markdown, 2);
  assert.match(b, /FAAB left: \$82 \(team-values\.txt\)/);
  assert.doesNotMatch(b, /UNAVAILABLE: team-values/);
});

test('FAAB is UNAVAILABLE and names both files when team-values.txt is missing or has no match', () => {
  const bad = parsePages({ 'team-values': 'no budget text here' })['team-values'];
  assert.equal(bad.ok, false);
  assert.match(section(sheet({ team: no('x'), 'team-values': bad }).markdown, 2),
    /FAAB left: UNAVAILABLE: team\.txt \(x\); UNAVAILABLE: team-values\.txt \(no "Waiver Budget: \$N" match\)/);
  assert.match(section(sheet({ team: no('x') }).markdown, 2), /UNAVAILABLE: team\.txt \(x\); UNAVAILABLE: team-values\.txt \(missing\)/);
});

test('a public capture: roster from the public team page, FAAB estimated from winning bids', () => {
  const { markdown, status } = sheet({ team: no('public view: no adds line, waiver budget or pending claims'),
    'team-public': ok({ name: 'Tony Team', roster: tonyRoster() }) });
  const b = section(markdown, 2);
  assert.match(b, /Roster source: team\.txt \(public view\)/);
  assert.match(b, /FAAB left: UNAVAILABLE: team\.txt \(public view/);
  assert.match(b, /FAAB estimate: at most \$97 \(\$100 season budget minus \$3 in 1 winning bid on transactions\.txt, which reaches back to 2026-11-10; older bids are not counted\)/);
  assert.match(b, /counted on transactions\.txt/);
  assert.match(b, /IL check .*: Ed Eve \(IL, status D\)/);
  assert.ok(status.includes('2. Budget and slots: partial'));
});

test('candidates carry season and recent-window ranks, and hot-only players join the list', () => {
  const hotOnly = { name: 'Jo Hot', nbaTeam: 'HHH', positions: ['C'], status: null, waiverClears: null };
  const c = section(sheet({ hot: { l7a: [{ file: 'hot-l7a-1.txt', ...ok([hotOnly, freeAgents[1]]) }], l7t: [], l14a: [], l14t: [] } }).markdown, 6);
  assert.match(c, /\| Season rank \| L7 avg \| L7 tot \| L14 avg \| L14 tot \|/);
  // Ivy Ink: season rank 2, 7-day average rank 2.
  assert.match(c, /\| fa-1 \| Ivy Ink \| BBB \|  \| PG \| 2 \| 2 \|  \|  \|  \|/);
  // Hal Hill is in the season list only.
  assert.match(c, /\| fa-1 \| Hal Hill \| HHH \|  \| C \| 1 \|  \|  \|  \|  \|/);
  // Jo Hot is in the 7-day list only, after the season pages.
  assert.match(c, /\| hot-l7a-1 \| Jo Hot \| HHH \|  \| C \|  \| 1 \|  \|  \|  \|/);
  assert.match(c, /hot pages: L7 avg\)/);
});

test('without hot pages the rank columns stay and say none were captured', () => {
  const c = section(sheet().markdown, 6);
  assert.match(c, /\| fa-1 \| Hal Hill \| HHH \|  \| C \| 1 \|  \|  \|  \|  \|/);
  assert.match(c, /hot pages: none captured/);
});

test('no FAAB estimate when the team page gives the balance', () => {
  assert.doesNotMatch(section(sheet().markdown, 2), /FAAB estimate/);
});

test('the injury report lists Tony, opponent and candidate players found in the feed', () => {
  const r = section(sheet().markdown, 9);
  assert.match(r, /Feed fetched: 2026-11-11T20:15:00Z/);
  assert.match(r, /\| Tony \| Ann Able \| AAA \| Day-To-Day \| 2026-11-10 \| 2026-11-12 \| Able \(ankle\) is questionable for Thursday\. \|/);
  assert.match(r, /\| Tony \| Bo Baker \| BBB \| Out \| 2026-11-09 \| not given \|/);
  const hal = r.split('\n').find((l) => l.startsWith('| Candidate |'));
  assert.match(hal, /\| Hal Hill \| HHH \| Out \| 2026-11-11 \| 2026-11-14 \| .*\.\.\. \|$/);
  assert.equal(hal.split(' | ').length, 7, 'a pipe in the comment must not add a column');
  assert.doesNotMatch(r, /Zed Zero/);
});

test('a feed failure prints UNAVAILABLE in section 9 and leaves the other sections alone', () => {
  const { markdown, status } = sheet({}, { injuries: { ok: false, reason: 'ESPN unreachable' } });
  assert.match(section(markdown, 9), /UNAVAILABLE: ESPN injuries feed \(ESPN unreachable\)/);
  assert.ok(status.includes('9. Injury report: UNAVAILABLE'));
  assert.ok(status.includes('2. Budget and slots: ok'));
});

test('each missing page marks only the sections that need it', () => {
  const { markdown, status } = sheet({ transactions: no('missing'), fa: [] });
  assert.match(section(markdown, 8), /UNAVAILABLE: transactions\.txt \(missing\)/);
  assert.match(section(markdown, 6), /UNAVAILABLE: fa-\*\.txt \(missing\)/);
  for (const n of [1, 2, 3, 4, 5]) assert.doesNotMatch(section(markdown, n), /UNAVAILABLE/);
  assert.deepEqual(status.map((s) => s.split(': ')[1]), ['ok', 'ok', 'ok', 'ok', 'ok', 'UNAVAILABLE', 'ok', 'UNAVAILABLE', 'ok']);
  const noMatchup = sheet({ matchup: no('missing') }).markdown;
  assert.match(section(noMatchup, 3), /UNAVAILABLE: matchup\.txt \(missing\)/);
  assert.match(section(noMatchup, 1), /week number unknown/);
  assert.match(section(sheet().markdown, 7), /Skipped: no league rosters in this capture/);
});

test('unknown banked totals stay unknown, and a page with no stats yet banks zero', () => {
  const m = matchup();
  m.totals.mine.PTS = null;
  assert.match(rowOf(section(sheet({ matchup: ok(m) }).markdown, 3), 'PTS'), /^\| PTS \| unknown \| 68\.0 \| unknown \|.*\| unknown \|$/);
  const blank = matchup();
  for (const side of ['mine', 'opponent']) for (const c of Object.keys(blank.totals[side])) blank.totals[side][c] = null;
  const md = section(sheet({ matchup: ok(blank), 'matchup-totals': no('missing') }).markdown, 3);
  assert.match(rowOf(md, 'PTS'), /^\| PTS \| 0 \| 68\.0 \| 68\.0 \|/);
  assert.match(rowOf(md, 'FG%'), /^\| FG% \| no attempts \(0\/0\) \| 0\.393/);
});

test('a Sunday-night capture uses next week: zero banked, zero adds, opponent from matchup-next', () => {
  const sunday = { folder: '2026-11-15-2035', captureDate: '2026-11-15', captureTime: '20:35' };
  const without = sheet({}, sunday).markdown;
  assert.match(section(without, 1), /Processing week: week 5, 2026-11-16 to 2026-11-22/);
  assert.match(section(without, 2), /Adds used in week 5 \(2026-11-16 to 2026-11-22\): 0 of 4; adds left: 4/);
  assert.match(section(without, 3), /Opponent: UNAVAILABLE: matchup-next\.txt \(missing\)/);
  assert.match(rowOf(section(without, 3), 'PTS'), /^\| PTS \| 0 \| 24\.0 \| 24\.0 \| unavailable/);
  assert.match(section(without, 5), /### Opponent\n\nUNAVAILABLE: matchup-next\.txt/);
  const next = { ...matchup(5, ['11/16', '11/17', '11/18', '11/19', '11/20', '11/21', '11/22'], 'Next Team'), opponentRoster: [pl('Hal Hill', 'HHH', ['C'], 'C')] };
  const withNext = sheet({ 'matchup-next': ok(next) }, sunday).markdown;
  assert.match(section(withNext, 3), /Opponent \(Next Team, roster from matchup-next\.txt\): 1 starts/);
  assert.match(rowOf(section(withNext, 3), 'PTS'), /^\| PTS \| 0 \| 24\.0 \| 24\.0 \| 0 \| 10\.0 \| 10\.0 \| \+14\.0 \|$/);
  const wrongWeek = sheet({ 'matchup-next': ok({ ...next, week: 4 }) }, sunday).markdown;
  assert.match(section(wrongWeek, 3), /UNAVAILABLE: matchup-next\.txt \(week 4, expected week 5\)/);
});

test('the same inputs give the same bytes', () => {
  assert.equal(sheet().markdown, sheet().markdown);
  assert.equal(sheet({ team: no('x') }).markdown, sheet({ team: no('x') }).markdown);
});

test('parsePages isolates failures and quotes no page text', () => {
  const parsed = parsePages({ matchup: 'Week 4\nsecret page words', team: '', 'fa-2': 'nothing', 'fa-10': 'nothing', 'teams/3': { reason: 'capture log: skipped' } });
  assert.equal(parsed.settings.reason, 'missing');
  assert.equal(parsed.team.reason, 'empty file');
  assert.equal(parsed.matchup.ok, false);
  assert.doesNotMatch(parsed.matchup.reason, /secret/);
  assert.deepEqual(parsed.fa.map((f) => f.file), ['fa-2.txt', 'fa-10.txt']);
  assert.ok(parsed.fa.every((f) => !f.ok && !/nothing/.test(f.reason)));
  assert.deepEqual(parsed.teams, [{ file: 'teams/3.txt', teamNumber: 3, ok: false, reason: 'capture log: skipped' }]);
});
