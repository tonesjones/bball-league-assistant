import test from 'node:test';
import assert from 'node:assert/strict';
import { absences, roleChanges, roleChangeReport } from '../src/engine/role-change.mjs';
import { DATE, BIG, POOR, bencher, buildLogs, day, player, row } from './fixtures/role-change/logs.mjs';

const run = (logs, extra = {}) => roleChanges({ logs, date: DATE, exclude: new Set(), available: new Set(), ...extra });
const ids = (list) => list.map((p) => p.espnId);

test('keeps the shapes the spec names and leaves out the rest', () => {
  const list = run(buildLogs(), { exclude: new Set(['104']), available: new Set(['106']) });
  const by = new Map(list.map((p) => [p.espnId, p]));
  assert.deepEqual([...by.keys()].sort(), ['101', '102', '105', '106']);
  assert.deepEqual(by.get('105').flags, ['returning']);
  assert.equal(by.get('105').latestAbsence, 6);
  assert.equal(by.get('105').gamesBack, 1);
  assert.deepEqual(by.get('101').flags, ['minutes', 'starter']);
  assert.deepEqual(by.get('102').flags, ['minutes']);
  assert.equal(by.get('101').recentStarts, 3);
  assert.equal(by.get('101').recentGames, 3);
  assert.equal(by.get('101').earlierStarts, 0);
  assert.equal(by.get('102').jump, 8);
  assert.equal(by.get('102').minutes, 24);
  assert.equal(by.get('102').availability, 'unconfirmed');
  assert.equal(by.get('106').availability, 'confirmed');
  assert.equal(by.get('101').team, 'TST');
  assert.equal(by.get('101').box.pts, 10);
  assert.equal(typeof by.get('101').gameZ, 'number');
  assert.equal(typeof by.get('101').seasonZ, 'number');
});

test('sorts by one-game z, then jump, then ESPN ID, and applies limit', () => {
  const logs = buildLogs();
  // G: jump of exactly 8 and a big night. H: jump of 12 and a poor night.
  logs.push(...player(110, 'Gale Golf', bencher, 24, { stats: BIG }), ...player(111, 'Hollis Hotel', bencher, 28, { stats: POOR }));
  // Same box score: the larger jump goes first even with the higher ID, then the lower ID.
  logs.push(...player(312, 'Indy India', bencher, 26), ...player(311, 'Jude Juliet', bencher, 25), ...player(310, 'Kit Kilo', bencher, 25));
  const list = run(logs);
  const order = ids(list);
  assert.ok(order.indexOf('110') < order.indexOf('111'), order.join());
  assert.deepEqual(order.filter((id) => ['310', '311', '312'].includes(id)), ['312', '310', '311']);
  assert.equal(order[0], '110');
  assert.deepEqual(ids(run(logs, { options: { limit: 2 } })), order.slice(0, 2));
});

test('rows after the date do not change the result', () => {
  const logs = buildLogs();
  const before = run(logs);
  const later = [row(101, 'Avery Alpha', '2026-11-11', 5), row(102, 'Blake Bravo', '2026-11-12', 40, { starter: true, stats: BIG }),
    ...player(120, 'Lane Lima', [[1, 10], [2, 10], [3, 10]], 40, { starter: true }).map((r) => ({ ...r, date: '2026-11-13' }))];
  assert.deepEqual(run([...logs, ...later]), before);
});

test('a DNP row on the date does not count as playing', () => {
  const logs = buildLogs().filter((r) => !(r.espnId === '102' && r.date === DATE));
  logs.push(row(102, 'Blake Bravo', DATE, 0, { didNotPlay: true }));
  assert.ok(!ids(run(logs)).includes('102'));
  assert.ok(ids(run(buildLogs())).includes('102'));
});

test('a player back from a long absence is flagged returning, and a short one or a benching is not', () => {
  const logs = buildLogs();
  // Back for one game after missing days 3 to 8: six team games.
  logs.push(...player(130, 'Mo Mike', [[1, 20], [2, 20]], 18));
  // Missed only days 6 to 8: three team games.
  logs.push(...player(131, 'Nia Nov', [[1, 20], [2, 20], [3, 20], [4, 20], [5, 20]], 18));
  // Sat days 3 to 8 by coach's decision: not an absence.
  logs.push(...player(132, 'Oz Oscar', [[1, 20], [2, 20]], 18),
    ...[3, 4, 5, 6, 7, 8].map((d) => ({ ...row(132, 'Oz Oscar', day(d), 0, { didNotPlay: true }), reason: "COACH'S DECISION" })));
  const by = new Map(run(logs).map((p) => [p.espnId, p]));
  assert.deepEqual(by.get('130').flags, ['returning']);
  assert.equal(by.get('130').earlierMpg, 20);
  assert.ok(!by.has('131'));
  assert.ok(!by.has('132'));
  const away = absences(logs, DATE);
  assert.deepEqual(away.get('130'), { team: 'TST', teamGames: 9, missed: 6, latestAbsence: 6, gamesBack: 1 });
  assert.deepEqual(away.get('132'), { team: 'TST', teamGames: 9, missed: 0, latestAbsence: 0, gamesBack: 9 });
});

test('the window covers the last three nights through the date', () => {
  const logs = buildLogs();
  // A minutes jump two nights before the date counts; one four nights before does not.
  logs.push(...player(140, 'Pat Papa', bencher, 30).map((r) => (r.date === DATE ? { ...r, date: day(9) } : r)));
  logs.push(...player(141, 'Quin Quebec', bencher.slice(0, 5), 30).map((r) => (r.date === DATE ? { ...r, date: day(6) } : r)));
  const by = new Map(run(logs).map((p) => [p.espnId, p]));
  assert.deepEqual(by.get('140').flags, ['minutes']);
  assert.equal(by.get('140').lastDate, day(9));
  assert.ok(!by.has('141'));
});

test('the same inputs give byte-identical output', () => {
  const args = { exclude: new Set(['104']), available: new Set(['106']) };
  assert.equal(JSON.stringify(run(buildLogs(), args)), JSON.stringify(run(buildLogs(), args)));
});

// A four-team league: Tony is team 1, so the snapshot holds teams 2 to 4.
const names = new Map(buildLogs().map((r) => [r.espnId, r.name]));
const idMap = { players: [...names].map(([espnId, name]) => ({ name, team: 'TST', espnId })) };
const owned = (...list) => list.map((id) => ({ name: names.get(String(id)), nbaTeam: 'TST' }));
const snapshot = () => ({
  asOf: '2026-11-10T20:00:00Z', settings: { raw: { 'Max Teams': '4' } },
  team: { roster: owned(900, 901) }, matchup: { opponentRoster: owned(902, 903) },
  league: { teams: [{ teamNumber: 2, roster: owned(904, 104) }, { teamNumber: 3, roster: owned(905) }, { teamNumber: 4, roster: owned(906, 101) }] },
  freeAgents: [],
});
const screen = (s) => roleChangeReport({ snapshot: s, ids: idMap, logs: buildLogs() });

test('with every roster present, a rostered player is left out and the rest are confirmed', () => {
  const result = screen(snapshot());
  assert.equal(result.status, 'ok');
  assert.equal(result.date, DATE);
  assert.deepEqual(ids(result.players).sort(), ['102', '105', '106']);
  assert.ok(result.players.every((p) => p.availability === 'confirmed'));
});

test('an unmatched rostered player does not skip the list: his name is excluded and he is returned', () => {
  // Player 102 is missing from the ID map, so a rostered player with his name cannot be excluded by ID.
  const stale = { players: idMap.players.filter((p) => p.espnId !== '102') };
  const s = snapshot();
  s.league.teams[1].roster.push({ name: names.get('102'), nbaTeam: 'TST' });
  const result = roleChangeReport({ snapshot: s, ids: stale, logs: buildLogs() });
  assert.equal(result.status, 'ok');
  assert.deepEqual(ids(result.players).sort(), ['105', '106']);
  assert.deepEqual(result.unmatched, [{ name: names.get('102'), nbaTeam: 'TST' }]);
  // Without the rostered 102 he is listed, so the exclusion came from the name rule.
  assert.ok(ids(roleChangeReport({ snapshot: snapshot(), ids: stale, logs: buildLogs() }).players).includes('102'));
});

test('each failed check skips the list with its own reason and names no players', () => {
  const cases = [
    ['no league rosters in this capture', (s) => { delete s.league; }],
    ['3 team rosters expected, 2 found', (s) => { s.league.teams.pop(); }],
    ['team 3 appears twice', (s) => { s.league.teams[2].teamNumber = 3; }],
    ['team 3 roster is empty', (s) => { s.league.teams[1].roster = []; }],
    ['league size unknown (no Max Teams setting)', (s) => { delete s.settings.raw['Max Teams']; }],
    ['team number 5 is outside 1 to 4', (s) => { s.league.teams[2].teamNumber = 5; }],
  ];
  for (const [reason, change] of cases) {
    const s = snapshot();
    change(s);
    const result = screen(s);
    assert.deepEqual(result, { status: 'skipped', reason }, reason);
  }
});
