import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSettings } from '../src/sources/yahoo-pages/settings.mjs';
import { parseTeam } from '../src/sources/yahoo-pages/team.mjs';
import { parseMatchup } from '../src/sources/yahoo-pages/matchup.mjs';
import { parseFreeAgents } from '../src/sources/yahoo-pages/free-agents.mjs';
import { parseTransactions } from '../src/sources/yahoo-pages/transactions.mjs';
import { buildSnapshot, countAdds } from '../src/sources/yahoo-pages/index.mjs';
import { validate } from '../src/sources/league-state.mjs';

const dir = new URL('./fixtures/yahoo-pages/', import.meta.url);
const page = (name) => readFileSync(new URL(`${name}.txt`, dir), 'utf8');
const pages = () => Object.fromEntries(['settings', 'team', 'matchup', 'fa-1', 'fa-2', 'transactions'].map((n) => [n, page(n)]));
const without = (text, line) => text.split('\n').filter((l) => l.trim() !== line).join('\n');
const ASOF = '2026-10-27T16:00:00.000Z';

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
  assert.equal(t.roster.length, 10);
  assert.deepEqual(t.roster[1], { name: 'Marcus Mockwell Jr.', nbaTeam: 'TOR', positions: ['SG', 'SF', 'PF'], status: 'Q', slot: 'SG' });
  assert.deepEqual(t.roster.at(-1), { name: 'Wendell Benchmark', nbaTeam: 'BOS', positions: ['C'], status: 'INJ', slot: 'IL' });
  assert.equal(t.roster[0].status, null);
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

test('transactions: any other content throws with the line', () => {
  const text = page('transactions').replace('No recent transactions', 'Added Some Player to Fixture Five');
  assert.throws(() => parseTransactions(text), /transactions: line \d+: transactions layout not seen yet: "Added Some Player/);
  const extra = page('transactions').replace('No recent transactions', 'No recent transactions\nSomething else');
  assert.throws(() => parseTransactions(extra), /transactions layout not seen yet: "Something else"/);
});

test('countAdds counts only this team\'s adds', () => {
  const t = [{ type: 'add', team: 'A' }, { type: 'drop', team: 'A' }, { type: 'add', team: 'B' }];
  assert.equal(countAdds(t, 'A'), 1);
  assert.equal(countAdds([], 'A'), 0);
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
  assert.throws(() => buildSnapshot(r, ASOF), /not the team page's team/);
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
