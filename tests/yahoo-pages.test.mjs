import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSettings } from '../src/sources/yahoo-pages/settings.mjs';
import { parseTeam } from '../src/sources/yahoo-pages/team.mjs';
import { parseMatchup } from '../src/sources/yahoo-pages/matchup.mjs';
import { parseFreeAgents } from '../src/sources/yahoo-pages/free-agents.mjs';
import { parseTransactions } from '../src/sources/yahoo-pages/transactions.mjs';
import { buildSnapshot } from '../src/sources/yahoo-pages/index.mjs';
import { validate } from '../src/sources/league-state.mjs';

const dir = new URL('./fixtures/yahoo-pages/', import.meta.url);
const page = (name) => readFileSync(new URL(`${name}.txt`, dir), 'utf8');
const pages = () => Object.fromEntries(['settings', 'team', 'matchup', 'fa-1', 'fa-2', 'transactions'].map((n) => [n, page(n)]));
const without = (text, line) => text.split('\n').filter((l) => l.trim() !== line).join('\n');
const ASOF = '2026-10-27T16:00:00.000Z';

test('completed matchup handles parenthesized empty and departed player pairs', () => {
  const original = parseMatchup(page('matchup'));
  const text = page('matchup')
    .replace(/Jalen TestwoodPlayer Note\r?\nOKC - PG\r?\n/, '(Empty)\n')
    .replace(/TOR - SG,SF,PF/, '$&\nW, 110-100 vs BOS')
    .replace('Stats associated with players', [
      'Departed FixturePlayer Note', 'BOS - C', ...Array(9).fill('1'), '--',
      '(Empty)', ...Array(9).fill('-'), 'Stats associated with players',
    ].join('\n'));
  const parsed = parseMatchup(text);
  assert.equal(parsed.roster.length, original.roster.length - 1);
  assert.deepEqual(parsed.totals, original.totals);
  assert.deepEqual(parsed.volume, original.volume);
  assert.deepEqual(parsed.opponentRoster, original.opponentRoster);
  assert.equal(parsed.roster.some((p) => p.name === 'Departed Fixture'), false);
  assert.throws(() => parseMatchup(text.replace('W, 110-100 vs BOS', 'garbled game')), /expected a number/);
});

test('totals matchup accepts scheduled game times without changing rosters or totals', () => {
  const original = parseMatchup(page('matchup'));
  for (const game of ['6:30 pm vs DEN', '4:00 pm @ CLE']) {
    const text = page('matchup').replace(/OKC - PG/, `$&\n${game}`);
    assert.deepEqual(parseMatchup(text), original);
    assert.throws(() => parseMatchup(text.replace(game, 'garbled game')), /expected a number/);
  }
});

test('settings: categories, slots, limits, playoffs', () => {
  const s = parseSettings(page('settings'));
  assert.equal(s.scoringType, 'h2h-each-category');
  assert.deepEqual(s.categories, ['FG%', 'FT%', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO']);
  assert.deepEqual(s.rosterPositions.find((p) => p.slot === 'C'), { slot: 'C', count: 2 });
  assert.equal(s.rosterPositions.reduce((n, p) => n + p.count, 0), 16);
  assert.equal(s.maxAddsPerWeek, 4);
  assert.equal(s.maxGamesPerWeek, null);
  assert.equal(s.waiverType, 'faab');
  assert.deepEqual(s.playoffs, { teams: 6, weeks: [20, 21, 22], endsOn: 'Sunday, Apr 4' });
  assert.equal(s.raw['Waiver Time'], '2 days');
});

test('settings: a games cap setting is read when present', () => {
  const text = page('settings').replace('Weekly Deadline:\t', 'Max Games Played per Week:\t42\nWeekly Deadline:\t');
  assert.equal(parseSettings(text).maxGamesPerWeek, 42);
});

test('team: name, record, budget, roster with slots and statuses', () => {
  const t = parseTeam(page('team'));
  assert.equal(t.name, 'Fixture Five');
  assert.deepEqual(t.record, { wins: 2, losses: 1, ties: 0 });
  assert.equal(t.faabBalance, 91);
  assert.equal(t.rank, null);
  assert.equal(t.addsUsedThisWeek, 0);
  assert.equal(t.roster.length, 10);
  assert.deepEqual(t.roster[1], { name: 'Marcus Mockwell Jr.', nbaTeam: 'TOR', positions: ['SG', 'SF', 'PF'], status: 'Q', slot: 'SG' });
  assert.deepEqual(t.roster.at(-1), { name: 'Wendell Benchmark', nbaTeam: 'BOS', positions: ['C'], status: 'INJ', slot: 'IL' });
  assert.equal(t.roster[0].status, null);
});

test('live team: standing, adds used, and empty roster slot', () => {
  const t = parseTeam(page('team-live'));
  assert.equal(t.rank, 12);
  assert.equal(t.addsUsedThisWeek, 1);
  assert.equal(t.roster.some((p) => p.name === 'Fred Fakeley'), false);
  assert.equal(t.roster.length, 9);
  assert.throws(() => parseTeam(without(page('team-live'), 'You have used 1 of your 4 player adds for this week.')), /team: line \d+: the weekly player adds line not found/);
});

test('team: a notice between the heading and the team name is not read as the name', () => {
  // Shape seen 2026-10-29: icon glyph lines around a one-line notice, then the name.
  const notice = 'Yahoo Sports Fantasy Basketball\n\t\t\t\n\nUpdate to IL changes: synthetic notice text.\n\n\t\n';
  const team = page('team-live').replace('Yahoo Sports Fantasy Basketball\n', notice);
  assert.equal(parseTeam(team).name, 'Fixture Five');
  const p = { ...pages(), team, matchup: page('matchup-empty'), transactions: page('transactions-live') };
  assert.equal(buildSnapshot(p, ASOF).team.name, 'Fixture Five');
  assert.throws(() => parseTeam(page('team-live').replace(/\(Since '15\)/, '')), /team: line \d+: the manager line .* not found/);
});

test('signed-out team and matchup pages fail before parsing', () => {
  assert.throws(() => parseTeam(page('team-signed-out')), /^Error: signed out of Yahoo: team page; sign in to Yahoo in the browser pane and refresh$/);
  assert.throws(() => parseMatchup(page('matchup-signed-out')), /^Error: signed out of Yahoo: matchup page; sign in to Yahoo in the browser pane and refresh$/);
});

test('matchup: totals, volume, both rosters', () => {
  const m = parseMatchup(page('matchup'));
  assert.equal(m.week, 2);
  assert.equal(m.teamName, 'Fixture Five');
  assert.equal(m.opponentName, 'Rim Runners');
  assert.equal(m.totals.mine.PTS, 410);
  assert.equal(m.totals.mine['FG%'], 0.48);
  assert.equal(m.totals.opponent.PTS, 395.5);
  assert.deepEqual(m.volume.mine, { fgm: 120, fga: 250, ftm: 60, fta: 75 });
  assert.deepEqual(m.score, { mine: 5, opponent: 4 });
  assert.equal(m.roster.length, 10);
  assert.equal(m.opponentRoster.length, 10);
  assert.equal(m.opponentRoster[0].slot, 'PG');
  assert.equal(m.opponentRoster[9].status, 'O');
  assert.equal(m.opponentRoster[5].name, 'Day’Ron Sharpless');
});

test('matchup: dashes are null', () => {
  const text = page('matchup').replace('120/250', '-/-').replace('\n410\n', '\n-\n');
  const m = parseMatchup(text);
  assert.deepEqual(m.volume.mine, { fgm: null, fga: null, ftm: 60, fta: 75 });
  assert.equal(m.totals.mine.PTS, null);
});

test('live matchup: totals without volume and abbreviated players in paired slots', () => {
  const m = parseMatchup(page('matchup-live'));
  assert.equal(m.week, 2);
  assert.deepEqual(m.days, ['10/27', '10/28', '10/29', '10/30', '10/31', '11/1']);
  assert.equal(m.teamName, 'Fixture Five');
  assert.equal(m.opponentName, 'Rim Runners');
  assert.equal(m.totals.mine.PTS, 38);
  assert.equal(m.totals.mine['FG%'], 0.474);
  assert.equal(m.totals.opponent['FT%'], null);
  for (const side of ['mine', 'opponent']) assert.deepEqual(m.volume[side], { fgm: null, fga: null, ftm: null, fta: null });
  assert.deepEqual(m.score, { mine: 6, opponent: 2 });
  assert.equal(m.roster.length, 4);
  assert.equal(m.opponentRoster.length, 4);
  assert.deepEqual(m.roster[2], { name: 'C.J. McFakeum', nbaTeam: 'NOP', positions: ['SG'], status: null, slot: 'Util' });
  assert.equal(m.opponentRoster[2].name, 'T. Tester III');
  assert.equal(m.roster[1].status, 'Q');
  assert.equal(m.opponentRoster[1].status, 'O');
  assert.equal(m.roster[3].status, 'NA');
  assert.equal(m.opponentRoster[0].slot, 'PG');
});

test('matchup-totals page supplies banked makes and attempts for the live matchup', () => {
  const live = { ...pages(), matchup: page('matchup-live') };
  const s = buildSnapshot({ ...live, 'matchup-totals': page('matchup') }, ASOF);
  assert.deepEqual(s.matchup.volume, { mine: { fgm: 120, fga: 250, ftm: 60, fta: 75 }, opponent: { fgm: 118, fga: 260, ftm: 71, fta: 90 } });
  assert.equal(s.matchup.totals.mine.PTS, 38);
  assert.deepEqual(buildSnapshot(live, ASOF).matchup.volume.mine, { fgm: null, fga: null, ftm: null, fta: null });
  assert.throws(() => buildSnapshot({ ...live, 'matchup-totals': page('matchup').replace('Week 2', 'Week 3') }, ASOF),
    /matchup-totals page does not match the matchup page: week "3" vs "2"/);
  assert.throws(() => buildSnapshot({ ...live, 'matchup-totals': page('matchup-different-team') }, ASOF),
    /matchup-totals page does not match the matchup page: team "Fixture Six" vs "Fixture Five"/);
  assert.throws(() => buildSnapshot({ ...live, 'matchup-totals': page('matchup').replaceAll('Rim Runners', 'Other Club') }, ASOF),
    /opponent "Other Club" vs "Rim Runners"/);
});

test('live matchup builds a valid snapshot with week dates', () => {
  const s = buildSnapshot({ ...pages(), matchup: page('matchup-live') }, ASOF);
  assert.deepEqual([s.matchup.start, s.matchup.end], ['2026-10-27', '2026-11-01']);
  assert.doesNotThrow(() => validate(s));
});

test('live matchup skips empty slots without shifting paired rows', () => {
  const m = parseMatchup(page('matchup-empty'));
  assert.equal(m.roster.length, 3);
  assert.equal(m.opponentRoster.length, 4);
  assert.equal(m.roster.some((p) => p.name === 'D. Benchley'), false);
  assert.equal(m.opponentRoster[3].name, 'Z. Zedman');
});

test('matchup: an empty slot of mine still gives the opponent row its slot', () => {
  const full = parseMatchup(page('matchup'));
  const m = parseMatchup(page('matchup').replace(/Jalen TestwoodPlayer Note\r?\nOKC - PG\r?\n/, 'Empty\n'));
  assert.equal(m.roster.length, full.roster.length - 1);
  assert.equal(m.roster.some((p) => p.name === 'Jalen Testwood'), false);
  assert.deepEqual(m.opponentRoster, full.opponentRoster);
});

test('icon-font glyphs are dropped before parsing', () => {
  const text = page('transactions-live').replace('FAB Offers', 'FAB Offers\n\n');
  assert.deepEqual(parseTransactions(text), parseTransactions(page('transactions-live')));
});

test('live matchup rejects malformed headers, totals and player blocks with line numbers', () => {
  const text = page('matchup-live');
  const cases = [
    text.replace('Team\tFG%\tFT%', 'Team\tFT%'),
    text.replace('Team\tFG%\tFT%', 'Team\tFT%\tFG%'),
    text.replace('Player\tFG%\tFT%', 'Player\tFT%'),
    without(text, 'TOTAL'),
    text.replace(/\n\.474\r?\n/, '\n'),
    text.replace(/\n\.500\r?\n/, '\n'),
    text.replace(/\n\.500\r?\n/, '\n.500\n1\n'),
    text.replace(/\nQ\r?\n/, '\nXX\n'),
    text.replace('J. TestwoodOKC - PG', 'J. Testwood - PG'),
    text.replace(/Z\. ZedmanLAC - C[\s\S]*?TOTAL/, 'TOTAL'),
    text.replace('J. TestwoodOKC - PG', 'TOTAL'),
    text.slice(0, text.indexOf('\n\nFixture Five', text.indexOf('Team\t'))),
    text.slice(0, text.indexOf('Rim Runners', text.indexOf('Team\t'))),
  ];
  for (const bad of cases) assert.throws(() => parseMatchup(bad), /matchup: line \d+: /);
});

test('free agents: team, positions, status, waiver clear date', () => {
  const fa = parseFreeAgents(page('fa-1'), 'fa-1');
  assert.equal(fa.length, 4);
  assert.deepEqual(fa[0], { name: 'Mark Fakeliams', nbaTeam: 'PHX', positions: ['C'], status: 'O', waiverClears: 'Oct 28' });
  assert.equal(fa[2].status, 'Q');
  assert.equal(fa[3].waiverClears, 'Oct 29');
});

test('transactions: the empty page is []', () => {
  assert.deepEqual(parseTransactions(page('transactions')), []);
});

test('transactions: live moves are grouped and classified', () => {
  assert.deepEqual(parseTransactions(page('transactions-live')), [
    { team: 'Fixture Five', time: 'Oct 21, 1:11 am', moves: [
      { player: 'Test Player One', nbaTeam: 'OKC', type: 'add', faab: 7 },
      { player: 'Test Player Two', nbaTeam: 'TOR', type: 'drop', faab: null },
    ] },
    { team: 'Rim Runners', time: 'Oct 20, 8:04 pm', moves: [{ player: 'Test Player Three', nbaTeam: 'BOS', type: 'add', faab: 3 }] },
    { team: 'Fixture Five', time: 'Oct 20, 7:30 pm', moves: [{ player: 'Test Player Four', nbaTeam: 'LAL', type: 'add', faab: 0 }] },
  ]);
  const bad = page('transactions-live').replace('$3 Waiver', 'Free Agent');
  assert.throws(() => parseTransactions(bad), /transactions: line \d+: transactions layout not seen yet: "Free Agent"/);
});

test('transactions: the pager above and below a full page is skipped', () => {
  const text = page('transactions-live')
    .replace('FAB Offers', 'FAB Offers\nPrevious 25 Next 25')
    .replace('Yahoo Sports - NBC', 'Previous 25 Next 25\nYahoo Sports - NBC');
  assert.deepEqual(parseTransactions(text), parseTransactions(page('transactions-live')));
});

test('transactions: unclassified content throws with the line', () => {
  const text = page('transactions').replace('No recent transactions', 'Added Some Player to Fixture Five');
  assert.throws(() => parseTransactions(text), /transactions: line \d+: transactions layout not seen yet: "Added Some Player/);
  const extra = page('transactions').replace('No recent transactions', 'No recent transactions\nSomething else');
  assert.throws(() => parseTransactions(extra), /transactions layout not seen yet: "Something else"/);
});

test('fixture pages build a snapshot that validates', () => {
  const s = buildSnapshot(pages(), ASOF);
  assert.equal(s.asOf, ASOF);
  assert.equal(s.team.addsUsedThisWeek, 0);
  assert.deepEqual(s.transactions, []);
  assert.deepEqual([s.matchup.start, s.matchup.end], ['2026-10-27', '2026-11-01']);
  assert.deepEqual(s.freeAgents.map((p) => p.rank), [1, 2, 3, 4, 5, 6]);
  assert.equal(s.matchup.opponentName, 'Rim Runners');
  assert.doesNotThrow(() => validate(JSON.parse(JSON.stringify(s))));
});

test('live fixtures build a valid snapshot and use the team page add count', () => {
  const p = { ...pages(), team: page('team-live'), matchup: page('matchup-empty'), transactions: page('transactions-live') };
  const s = buildSnapshot(p, ASOF);
  assert.equal(s.team.rank, 12);
  assert.equal(s.team.addsUsedThisWeek, 1);
  assert.equal(s.transactions.length, 3);
  assert.doesNotThrow(() => validate(s));
});

test('a mangled layout throws with the page and the line', () => {
  const cases = [
    ['settings', without(page('settings'), 'Setting\tValue'), /settings: line \d+: .*Setting<TAB>Value/],
    ['team', without(page('team'), 'Pos'), /team: line \d+: .*"Pos"/],
    ['team', page('team').replace('2-1-0\nRecord', 'two wins\nRecord'), /team: line \d+: .*"two wins"/],
    ['matchup', without(page('matchup'), 'AST'), /matchup: line \d+: expected totals column "AST".*"(ST|BLK)"/],
    ['fa-1', without(page('fa-1'), 'Roster Status'), /fa-1: line \d+: .*Roster Status/],
    ['transactions', without(page('transactions'), 'Recent Transactions'), /transactions: line \d+: /],
  ];
  const parsers = { settings: parseSettings, team: parseTeam, matchup: parseMatchup, 'fa-1': parseFreeAgents, transactions: parseTransactions };
  for (const [name, text, re] of cases) {
    assert.throws(() => parsers[name](text, name), re, name);
  }
});

test('a broken player row throws', () => {
  assert.throws(() => parseTeam(page('team').replace('TOR - SG,SF,PF', 'Toronto')), /team: line \d+: expected "TEAM - POS,POS".*"Toronto"/);
  assert.throws(() => parseMatchup(page('matchup').replace(/\n\.553\n/, '\nbad\n')), /matchup: line \d+: expected a number or "-": "bad"/);
});

test('buildSnapshot never returns a partial snapshot', () => {
  const p = pages();
  p.matchup = without(p.matchup, 'Week 2');
  assert.throws(() => buildSnapshot(p, ASOF), /matchup: line/);
  const q = pages();
  delete q.settings;
  assert.throws(() => buildSnapshot(q, ASOF), /missing page text: settings/);
  const r = pages();
  r.matchup = r.matchup.replaceAll('Fixture Five', 'Someone Else');
  assert.throws(() => buildSnapshot(r, ASOF), /matchup page is not my team's matchup:/);
  const mismatch = pages();
  mismatch.matchup = page('matchup-different-team');
  assert.throws(() => buildSnapshot(mismatch, ASOF), /matchup page is not my team's matchup:/);
});

test('validate rejects a missing or empty roster and missing settings', () => {
  const good = () => buildSnapshot(pages(), ASOF);
  const noRoster = good();
  delete noRoster.team.roster;
  assert.throws(() => validate(noRoster), /team\.roster is missing or empty/);
  const emptyRoster = good();
  emptyRoster.team.roster = [];
  assert.throws(() => validate(emptyRoster), /team\.roster is missing or empty/);
  const noSettings = good();
  delete noSettings.settings;
  assert.throws(() => validate(noSettings), /settings is missing/);
});

test('validate lists every problem', () => {
  const s = buildSnapshot(pages(), ASOF);
  delete s.settings;
  s.team.roster = [];
  s.matchup.opponentRoster = [];
  s.asOf = 'yesterday';
  try {
    validate(s);
    assert.fail('should throw');
  } catch (err) {
    for (const part of ['asOf', 'settings is missing', 'team.roster', 'matchup.opponentRoster']) assert.match(err.message, new RegExp(part));
  }
});

test('free agents: status P is read, an unknown status code throws with the line', () => {
  const fa = parseFreeAgents(page('fa-1').replace('Rico ValemontPlayer Note', 'Rico ValemontPPlayer Note'), 'fa-1');
  assert.deepEqual(fa.find((p) => p.name === 'Rico Valemont').status, 'P');
  const d = parseFreeAgents(page('fa-1').replace('Rico ValemontPlayer Note', 'Rico ValemontDNew Player Note'), 'fa-1');
  assert.deepEqual(d.find((p) => p.name === 'Rico Valemont').status, 'D');
  const dtd = parseFreeAgents(page('fa-1').replace('Rico ValemontPlayer Note', 'Rico ValemontDTDPlayer Note'), 'fa-1');
  assert.deepEqual(dtd.find((p) => p.name === 'Rico Valemont').status, 'DTD');
  assert.throws(
    () => parseFreeAgents(page('fa-1').replace('Rico ValemontPlayer Note', 'Rico ValemontXPlayer Note'), 'fa-1'),
    /fa-1: line \d+: unknown injury status code.*"Rico ValemontXPlayer Note"/,
  );
});

test('player names: Jr./III suffixes and a status after a numeral still parse', () => {
  const fa = parseFreeAgents(page('fa-1').replace('Kelly Oubreson Jr.QPlayer Note', 'Kelly Oubreson IIIQPlayer Note'), 'fa-1');
  assert.equal(fa.find((p) => p.name === 'Kelly Oubreson III').status, 'Q');
});

// Shapes seen in real captures; names are synthetic.
const withPending = (count, ...items) => page('team').replace('Waiver Budget: $91',
  ['Waiver Budget: $91', '', 'Pending Transactions', String(count), 'Collapse', ...items, 'Edit Waiver Priority', 'Edit'].join('\n'));

test('team: pending waiver claims, proposed trades and unlisted items', () => {
  const t = parseTeam(withPending(5,
    'Waiver 1 (Oct 28): Bid $3 for Pat Pickup, Drop Marcus Mockwell Jr.', 'View Details',
    'Waiver 2 (Oct 28): Add Quinn Claim, Drop Wendell Benchmark', 'View Details',
    'Waiver 3 (Oct 29): Add Riley Rookie', 'View Details',
    'You have proposed a trade to Other Fixture Team', 'View Proposed Trade'));
  assert.deepEqual(t.pending, { count: 5, proposedTrades: 1, unlisted: 1, waivers: [
    { order: 1, date: 'Oct 28', add: 'Pat Pickup', bid: 3, drop: 'Marcus Mockwell Jr.' },
    { order: 2, date: 'Oct 28', add: 'Quinn Claim', bid: null, drop: 'Wendell Benchmark' },
    { order: 3, date: 'Oct 29', add: 'Riley Rookie', bid: null, drop: null }] });
  assert.equal(t.roster.length, 10);
  assert.deepEqual(parseTeam(page('team')).pending, { count: 0, waivers: [], proposedTrades: 0, unlisted: 0 });
  assert.throws(() => parseTeam(withPending(1, 'Waiver 1 (Oct 28): Swap Pat Pickup')), /team: line \d+: unrecognized pending waiver claim/);
  assert.throws(() => parseTeam(withPending(0, 'Waiver 1 (Oct 28): Add Pat Pickup')), /more pending items listed than the count/);
  const s = buildSnapshot({ ...pages(), team: withPending(1, 'Waiver 1 (Oct 28): Add Pat Pickup') }, ASOF);
  assert.doesNotThrow(() => validate(JSON.parse(JSON.stringify(s))));
  s.team.pending.waivers[0].add = '';
  assert.throws(() => validate(s), /team\.pending has a bad shape/);
});

test('other teams\' pages parse into league.teams; a routine build has none', () => {
  // Another team's page has no weekly adds or waiver budget lines.
  const other = without(without(page('team'), 'You have used 0 of your 4 player adds for this week.'), 'Waiver Budget: $91')
    .replaceAll('Fixture Five', 'Fixture Other');
  const own = page('team');
  const s = buildSnapshot({ ...pages(), 'teams/9': other, 'teams/3': other, 'teams/7': own }, ASOF);
  assert.deepEqual(s.league.teams.map((t) => t.teamNumber), [3, 9]);
  assert.deepEqual(s.league.teams[0].roster, parseTeam(own).roster);
  assert.doesNotThrow(() => validate(JSON.parse(JSON.stringify(s))));
  assert.equal('league' in buildSnapshot(pages(), ASOF), false);
});

test('a mangled other-team page throws with its page name; validate rejects a bad league', () => {
  const bad = page('team').replaceAll('Fixture Five', 'Fixture Other').replace('TOR - SG,SF,PF', 'Toronto');
  assert.throws(() => buildSnapshot({ ...pages(), 'teams/4': bad }, ASOF), /teams\/4: line \d+/);
  const s = buildSnapshot(pages(), ASOF);
  assert.throws(() => validate({ ...s, league: { teams: [{ teamNumber: 0, roster: [] }] } }), /league\.teams\[0\]/);
});

test('transactions retain traded players without counting them as waiver adds', () => {
  const text = 'Recent Transactions\nFAB Offers\nExample Guard POR - PG O\nTraded to\nFixture Team\nOct 30, 1:22 am\nExample Center MIL - C\nTraded to\nOther Fixture\nOct 30, 1:22 am\nYahoo Sports - NBC';
  assert.deepEqual(parseTransactions(text), [
    {team: 'Fixture Team', time: 'Oct 30, 1:22 am', moves: [{player: 'Example Guard', nbaTeam: 'POR', type: 'trade', faab: null}]},
    {team: 'Other Fixture', time: 'Oct 30, 1:22 am', moves: [{player: 'Example Center', nbaTeam: 'MIL', type: 'trade', faab: null}]},
  ]);
});
