import test from 'node:test';
import assert from 'node:assert/strict';
import { roleChanges } from '../src/engine/role-change.mjs';
import { formatPlan, planSummary, roleChangeReport } from '../scripts/advise.mjs';
import { DATE, BIG, POOR, bencher, buildLogs, player, row } from './fixtures/role-change/logs.mjs';

const run = (logs, extra = {}) => roleChanges({ logs, date: DATE, exclude: new Set(), available: new Set(), ...extra });
const ids = (list) => list.map((p) => p.espnId);

test('keeps the shapes the spec names and leaves out the rest', () => {
  const list = run(buildLogs(), { exclude: new Set(['104']), available: new Set(['106']) });
  const by = new Map(list.map((p) => [p.espnId, p]));
  assert.deepEqual([...by.keys()].sort(), ['101', '102', '106']);
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

test('the same inputs give byte-identical output', () => {
  const args = { exclude: new Set(['104']), available: new Set(['106']) };
  assert.equal(JSON.stringify(run(buildLogs(), args)), JSON.stringify(run(buildLogs(), args)));
});

const report = (roleChangesValue) => ({
  action: 'hold', asOf: '2026-11-10T16:00:00Z', projection: { asOf: '2026-11-10T15:00:00Z' }, dependsOn: [], categories: {},
  startsByDay: [], addsLeft: 4, openSpots: 0, runnersUp: [], unknowns: [], roleChanges: roleChangesValue,
});

test('formatPlan prints the role-change section after runners-up, and none when empty', () => {
  const players = run(buildLogs(), { exclude: new Set(['104']), available: new Set(['106']) });
  const text = formatPlan(report({ status: 'ok', date: DATE, players }));
  assert.ok(text.indexOf('Runners-up') < text.indexOf('Role changes (watch list)'));
  assert.ok(text.indexOf('Role changes (watch list)') < text.indexOf('Unknowns'));
  assert.match(text.replace(/\n\s+/g, ' '), /Avery Alpha \(TST\) 38 min vs 22 earlier \(\+16\), started 3 of last 3; 10p 4r 2a 1s 0b 1x3 4\/9 1\/2 2to; game z [+-]\d\.\d, season z [+-]\d\.\d; availability unconfirmed/);
  assert.match(text, /availability confirmed/);
  for (const line of text.split('\n')) assert.ok(line.length <= 72, line);
  assert.match(formatPlan(report({ status: 'ok', date: DATE, players: [] })), /Role changes \(watch list\)\n {2}none\n/);
  assert.match(planSummary(report({ status: 'ok', date: DATE, players })).join('\n'), /Role changes: 3 \(see full advice\)/);
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
  assert.deepEqual(ids(result.players).sort(), ['102', '106']);
  assert.ok(result.players.every((p) => p.availability === 'confirmed'));
});

test('each failed check skips the list with its own reason and names no players', () => {
  const cases = [
    ['no league rosters in this capture', (s) => { delete s.league; }],
    ['3 team rosters expected, 2 found', (s) => { s.league.teams.pop(); }],
    ['team 3 appears twice', (s) => { s.league.teams[2].teamNumber = 3; }],
    ['team 3 roster is empty', (s) => { s.league.teams[1].roster = []; }],
    ['league size unknown (no Max Teams setting)', (s) => { delete s.settings.raw['Max Teams']; }],
    ['team number 5 is outside 1 to 4', (s) => { s.league.teams[2].teamNumber = 5; }],
    ['unmatched rostered players: Nobody Real (TST)', (s) => { s.league.teams[0].roster.push({ name: 'Nobody Real', nbaTeam: 'TST' }); }],
  ];
  for (const [reason, change] of cases) {
    const s = snapshot();
    change(s);
    const result = screen(s);
    assert.deepEqual(result, { status: 'skipped', reason }, reason);
    assert.ok(formatPlan(report(result)).replace(/\n\s+/g, ' ').includes(`Role changes: skipped (${reason})`), reason);
    assert.ok(planSummary(report(result)).join('\n').includes('Role changes: skipped'));
  }
});
