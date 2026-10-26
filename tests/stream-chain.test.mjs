import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { logHash } from '../src/sources/gamelogs.mjs';
import { planStreamChains } from '../src/engine/stream-chain.mjs';
import { assignLineup } from '../src/engine/needs.mjs';
import { projectPlayers, minutesCase } from '../src/engine/projections.mjs';
import { seasonValues } from '../src/engine/season-value.mjs';
import { formatStreamPlan } from '../scripts/stream-plan.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/stream/week.json', import.meta.url), 'utf8'));
const from = '2026-10-26', to = '2026-11-01';
const player = (name, nbaTeam, positions = ['PG'], extra = {}) => ({ name, nbaTeam, positions, status: null, ...extra });
const setup = () => ({ ...structuredClone(fixture), projections: { players: [] },
  advice: { options: { protectRank: 0, roles: { core: [], stream: ['Stream Alpha'] } } },
  slotPlayer: 'empty', fromDate: from, toDate: to });
const run = (opts = {}) => planStreamChains({ ...setup(), ...opts });
const plan = (r, budget = 4) => r.plans.find((p) => p.budget === budget);
const single = (slots, roster = [], freeAgents = []) => {
  const s = setup();
  s.snapshot.settings.rosterPositions = slots.map((slot) => ({ slot, count: 1 }));
  s.snapshot.team.roster = roster;
  s.snapshot.freeAgents = freeAgents;
  s.schedule.games = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((home) => ({ date: from, home, away: 'ZZZ' }));
  s.toDate = from;
  return s;
};
const line = (name, n) => ({ name, mpg: 20, perGame: { g: 70, pts: n, reb: n, ast: n, stl: n, blk: n, fg3m: n, to: 1,
  fgm: n, fga: n * 2, ftm: n, fta: n * 2 } });

test('back-to-back exact search gives 7/6/5 starts with 4/3/2 adds', () => {
  const r = run();
  assert.deepEqual([4, 3, 2].map((b) => plan(r, b).totalGames), [7, 6, 5]);
  assert.deepEqual(plan(r).links.map((l) => l.team), ['AAA', 'BBB', 'CCC', 'DDD']);
  assert.deepEqual(plan(r, 2).links.map((l) => l.team), ['AAA', 'EEE']);
  assert.equal(plan(r).addsUsed, 4);
  assert.ok(plan(r).links.every((l) => l.unprojected));
});

test('no fitting slot gives zero and a fitting team is chosen instead', () => {
  const s = single(['SG'], [], [player('Stream Center', 'AAA', ['C']), player('Stream Guard', 'BBB', ['SG'])]);
  assert.equal(plan(run(s)).links[0].player.name, 'Stream Guard');
  s.snapshot.freeAgents.pop();
  assert.equal(plan(run(s)).totalGames, 0);
});

test('SG/SF open with Util filled excludes C; open Util fits C', () => {
  const s = single(['SG', 'SF', 'Util'], [player('Stream Roster', 'EEE', ['C'])],
    [player('Stream Center', 'AAA', ['C']), player('Stream Wing', 'BBB', ['SG', 'SF'])]);
  const r = run(s);
  assert.deepEqual(r.dayTable[0].openSlots, ['SG', 'SF']);
  assert.equal(plan(r).links[0].player.name, 'Stream Wing');
  s.snapshot.freeAgents.pop();
  assert.equal(plan(run(s)).totalGames, 0);
  s.snapshot.team.roster = [];
  assert.equal(plan(run(s)).totalGames, 1);
});

test('overfull Wednesday benches no rostered starter for a Wed-Thu pickup and ties Thursday-only', () => {
  const s = single(['Util'], [player('Stream Roster A', 'AAA'), player('Stream Roster B', 'AAA')],
    [player('Stream Both', 'BBB'), player('Stream Thursday', 'CCC')]);
  s.fromDate = '2026-10-28'; s.toDate = '2026-10-29';
  s.schedule.games = [{ date: s.fromDate, home: 'AAA', away: 'BBB' }, { date: s.toDate, home: 'BBB', away: 'CCC' }];
  const r = run(s), p = plan(r);
  assert.equal(p.totalGames, 1);
  assert.deepEqual(p.links[0].dates, [s.toDate]);
  assert.equal(r.dayTable[0].starters.length, 1);
  assert.equal(r.dayTable[0].benched.length, 1);
  assert.ok(p.links[0].alternatives.some((a) => a.name === 'Stream Thursday'));
});

test('flexible rostered G/F moves to F so PG starts without displacement', () => {
  const flex = player('Stream Flex', 'AAA', ['SG', 'SF']);
  const s = single(['G', 'F'], [flex], [player('Stream Guard', 'BBB')]);
  assert.equal(assignLineup([flex], s.snapshot.settings.rosterPositions)[0].slot, 'G');
  assert.equal(plan(run(s)).totalGames, 1);
  assert.deepEqual(run(s).dayTable[0].starters, [flex.name]);
  assert.deepEqual(assignLineup([flex, s.snapshot.freeAgents[0]], s.snapshot.settings.rosterPositions, [], ['Stream Guard'])
    .map((x) => [x.player.name, x.slot]), [['Stream Flex', 'F'], ['Stream Guard', 'G']]);
});

test('day table reports open slots and benched counts for every day', () => {
  const r = run();
  assert.equal(r.dayTable.length, 7);
  assert.ok(r.dayTable.every((d) => d.openSlots.includes('Util') && d.benched.length === 0));
  const s = single(['Util'], [player('Stream One', 'AAA'), player('Stream Two', 'AAA')]);
  const d = run(s).dayTable[0];
  assert.equal(d.games.length, 2); assert.equal(d.starters.length, 1);
  assert.equal(d.benched.length, 1); assert.deepEqual(d.openSlots, []);
  assert.match(formatStreamPlan(run(s)), /\| 1 \(Stream Two\) \| none/);
});

test('out, missing return timeline, unknown team and late waivers never enter links or alternatives', () => {
  const s = single(['Util'], [], [player('Stream Out', 'AAA', ['PG'], { status: 'O', returnTimeline: 'tomorrow' }),
    player('Stream No Return', 'AAA', ['PG'], { returnTimeline: null }),
    player('Stream Late', 'AAA', ['PG'], { waiverClears: 'Oct 28' }),
    player('Stream Unknown', null), player('Stream Valid', 'BBB')]);
  const p = plan(run(s));
  assert.equal(p.links[0].player.name, 'Stream Valid');
  assert.deepEqual(p.links[0].alternatives, []);
});

test('waivers can start on clearing date but never earlier; dropped players cannot be re-added', () => {
  const s = setup();
  s.snapshot.freeAgents[0].waiverClears = 'Oct 27';
  const r = run(s);
  for (const p of r.plans) for (const l of p.links) if (l.player.name === 'Stream Beta') assert.ok(l.start >= '2026-10-27');
  const x = single(['Util'], [], [player('Stream Alternating A', 'AAA'), player('Stream Alternating B', 'BBB')]);
  x.toDate = '2026-10-28';
  x.schedule.games = [from, '2026-10-27', x.toDate].map((date, i) => ({ date, home: i === 1 ? 'BBB' : 'AAA', away: 'ZZZ' }));
  assert.equal(plan(run(x)).totalGames, 2);
  for (const p of run(x).plans) assert.equal(new Set(p.links.map((l) => l.player.name)).size, p.links.length);
});

test('current-season rates promote a protectRank hold, reserve an add, and exclude it from chains', () => {
  const s = setup(), hot = line('Stream Beta', 1), rival = line('Stream Reference', 3);
  const ids = { players: [{ espnId: '1', priorName: hot.name }] };
  s.projections = projectPlayers([hot, rival], ids, [{ ...hot.perGame, pts: 100, reb: 100, ast: 100, stl: 100, blk: 100,
    fg3m: 100, fgm: 100, fga: 200, ftm: 100, fta: 200, espnId: '1', espnEventId: '1', date: from, min: 20 }]);
  s.advice.options.protectRank = 1;
  assert.equal(seasonValues(s.projections.players.map((p) => minutesCase(p, 'prior', 'prior'))).get(hot.name).rank, 2);
  assert.equal(seasonValues(s.projections.players).get(hot.name).rank, 1);
  assert.equal(seasonValues(s.projections.players.map((p) => minutesCase(p, 'prior', 'season'))).get(hot.name).rank, 1);
  const r = run(s);
  assert.equal(r.holds[0].name, hot.name); assert.equal(r.reservedAdds, 1);
  assert.deepEqual(r.plans.map((p) => p.status), ['planned', 'planned', 'not available']);
  assert.ok(r.holds[0].cases.some((c) => c.rate === 'season' && c.rank === 1));
  assert.ok(r.holds[0].minutes); assert.ok(r.holds[0].rates);
  for (const p of r.plans) for (const l of p.links ?? []) {
    assert.notEqual(l.player.name, hot.name); assert.ok(l.alternatives.every((a) => a.name !== hot.name));
  }
  const text = formatStreamPlan(r);
  assert.ok(text.indexOf('Long-term pickups first') < text.indexOf('2 adds:'));
});

test('insufficient evidence pickup reserves an add and preserves advice numbers and cases', () => {
  const s = setup();
  const evidence = { pickup: { name: 'Stream Gamma', games: 2, minutes: { games: 1 } }, drop: { name: 'Stream Other' },
    score: 0.2, minuteScenarios: [{ scoreRange: [-0.1, 0.3] }], rateScenarios: [{ scoreRange: [-0.2, 0.4] }] };
  s.advice.decision = { action: 'insufficient', best: evidence };
  const r = run(s);
  assert.equal(r.holds[0].name, evidence.pickup.name); assert.deepEqual(r.holds[0].evidence, evidence);
  assert.equal(r.addsAvailable, 3);
  assert.match(formatStreamPlan(r), /advice gain 0\.200 \(minutes and rate cases -0\.200 to 0\.400\)/);
  s.advice.decision.action = 'hold';
  assert.equal(run(s).reservedAdds, 0);
});

test('hold move dropping stream slot stops all chains and explains slot ownership', () => {
  const s = setup(); s.slotPlayer = 'Stream Alpha';
  s.advice.decision = { action: 'move', pair: { pickup: { name: 'Stream Beta' }, drop: { name: s.slotPlayer }, score: 0.3 } };
  const r = run(s);
  assert.deepEqual(r.plans, []); assert.equal(r.slotGoesTo, 'Stream Beta');
  assert.match(formatStreamPlan(r), /stream slot goes to Stream Beta/);
  assert.deepEqual(JSON.parse(JSON.stringify(r)).dayTable, r.dayTable);
});

test('unavailable budgets, core or unmarked stream slots, games caps and invalid dates are refused', () => {
  const s = setup(); s.snapshot.team.addsUsedThisWeek = 2;
  assert.deepEqual(run(s).plans.map((p) => p.status), ['planned', 'not available', 'not available']);
  s.slotPlayer = 'Stream Alpha'; s.advice.options.roles = { core: ['Stream Alpha'], stream: [] };
  assert.throws(() => run(s), /core player/);
  s.advice.options.roles.core = [];
  assert.throws(() => run(s), /marked stream/);
  s.slotPlayer = 'empty'; s.snapshot.settings.maxGamesPerWeek = 40;
  assert.throws(() => run(s), /games cap/);
  assert.throws(() => run({ fromDate: '2026-02-30' }), /dates/);
});

test('tie order is total games, projected games, season value, then alphabetical names; input order is irrelevant', () => {
  const s = single(['Util'], [], [player('Stream Alpha', 'AAA'), player('Stream Beta', 'BBB'), player('Stream Gamma', 'CCC')]);
  s.projections.players = [line('Stream Beta', 1), line('Stream Gamma', 3)];
  assert.equal(plan(run(s)).links[0].player.name, 'Stream Gamma');
  s.projections.players = [line('Stream Beta', 1)];
  assert.equal(plan(run(s)).links[0].player.name, 'Stream Beta');
  s.projections.players = [];
  const first = run(s);
  assert.equal(plan(first).links[0].player.name, 'Stream Alpha');
  s.snapshot.freeAgents.reverse();
  assert.deepEqual(run(s), first); assert.deepEqual(run(s), first);
  s.toDate = '2026-10-27'; s.schedule.games.push({ date: s.toDate, home: 'AAA', away: 'EEE' });
  s.projections.players = [line('Stream Beta', 1)];
  assert.equal(plan(run(s), 2).totalGames, 2);
});

test('current stream player uses no add, has a no-move baseline, and is never re-added', () => {
  const s = setup(); s.slotPlayer = 'Stream Alpha';
  s.snapshot.team.roster[0].nbaTeam = 'AAA';
  s.snapshot.freeAgents = s.snapshot.freeAgents.filter((p) => p.nbaTeam !== 'AAA');
  const r = run(s);
  assert.equal(r.noMoveGames, 2);
  assert.equal(plan(r).totalGames, 7);
  assert.equal(plan(r).links[0].usesAdd, false);
  assert.equal(plan(r).addsUsed, 3);
  assert.match(formatStreamPlan(r), /recommendation: keep current player/);
});

test('report gives timestamps, daily starts, alternatives and first-link-only refresh wording', () => {
  const r = run(), text = formatStreamPlan(r);
  assert.match(text, new RegExp(fixture.snapshot.asOf));
  assert.match(text, new RegExp(fixture.schedule.fetchedAt));
  assert.match(text, /Only the first link is a recommendation/);
  assert.match(text, /Refresh and rerun before the next link/);
  assert.match(text, /illustrative only/); assert.match(text, /No move: 0 starts/);
  assert.match(text, /2026-10-26: 1/); assert.match(text, /unprojected/);
  assert.ok(plan(r).links.every((l) => l.alternatives.length <= 3));
});

test('effective versus transaction week counts Sunday-for-Monday adds in different weeks', () => {
  const s = single(['Util'], [], [player('Stream Monday', 'AAA'), player('Stream Tuesday', 'BBB')]);
  s.snapshot.team.addsUsedThisWeek = 2;
  s.fromDate = '2026-11-02'; s.toDate = '2026-11-03';
  s.schedule.games = [{ date: s.fromDate, home: 'AAA', away: 'ZZZ' }, { date: s.toDate, home: 'BBB', away: 'ZZZ' }];
  const effective = run(s), transaction = run({ ...s, addsWeek: 'transaction' });
  assert.equal(plan(effective, 2).links[0].addsWeek, 1);
  assert.equal(plan(transaction, 2).links[0].addsWeek, 0);
  assert.equal(plan(transaction, 2).links[0].transactionDate, '2026-11-01');
  assert.match(formatStreamPlan(transaction), /Adds week: transaction/);
});


test('CLI loads synthetic snapshot, projections, roles and protected names, refuses stale data, and writes no reports', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'stream-cli-'));
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  });
  const s = setup(), checked = '2020-10-25', logs = '[]';
  s.snapshot.asOf = '2020-10-25T12:00:00Z';
  s.snapshot.matchup.opponentRoster = [];
  s.schedule.games.push({ date: checked, home: 'AAA', away: 'BBB' });
  const files = { 'snapshot.json': s.snapshot, 'data/ids.json': { players: [] },
    'data/priors/players.json': [line('Stream Reference', 1)], 'data/schedule-2026-27.json': s.schedule,
    'local/roles.json': { stream: [] }, 'local/protected.json': { protected: ['Stream Alpha'] },
    'local/gamelogs/2026-27/_coverage.json': { from: checked, through: checked,
      checkedAt: s.snapshot.asOf, hashes: { [checked]: logHash(logs) } } };
  for (const [file, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), JSON.stringify(value));
  }
  await writeFile(path.join(dir, `local/gamelogs/2026-27/${checked}.json`), logs);
  const cli = fileURLToPath(new URL('../scripts/stream-plan.mjs', import.meta.url));
  const execute = (args) => execFileSync(process.execPath, [cli, 'snapshot.json', ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  const args = ['--slot', 'empty', '--from', from, '--to', to, '--allow-stale', '--max-age-hours', '0'];
  const output = execute(args);
  assert.match(output, /Total 7 started games/);
  assert.match(output, /Adds week: effective/);
  assert.match(output, /STALE:/);
  assert.throws(() => execute(['--slot', 'empty', '--max-age-hours', '0']), /hours old/);
  assert.throws(() => execute(['--slot', 'Stream Alpha', '--allow-stale']), /core player/);
  assert.deepEqual((await readdir(path.join(dir, 'local'))).sort(), ['gamelogs', 'protected.json', 'roles.json']);
});

test('a short first matchup week leaves next week with full adds, and transaction mode spans both weeks', () => {
  const s = setup();
  s.snapshot.matchup = { ...s.snapshot.matchup, start: '2026-10-20', end: '2026-10-25' };
  s.snapshot.team.addsUsedThisWeek = 2;
  const effective = run(s);
  assert.equal(effective.addsLeft, 4);
  assert.deepEqual([4, 3, 2].map((b) => plan(effective, b).totalGames), [7, 6, 5]);
  assert.ok(plan(effective).links.every((l) => l.addsWeek === 1));
  const transaction = run({ ...s, addsWeek: 'transaction' });
  assert.equal(transaction.addsLeft, 2);
  assert.equal(plan(transaction).status, 'planned');
  assert.equal(plan(transaction).links[0].addsWeek, 0);
  assert.ok(plan(transaction).links.slice(1).every((l) => l.addsWeek === 1));
});

test('a large pool of weaker candidates does not change the exact chain', () => {
  const s = setup();
  for (let i = 0; i < 40; i++) s.snapshot.freeAgents.push(player(`Stream Filler ${String(i).padStart(2, '0')}`, 'EEE', ['PG']));
  const r = run(s);
  assert.deepEqual([4, 3, 2].map((b) => plan(r, b).totalGames), [7, 6, 5]);
  assert.deepEqual(plan(r).links.map((l) => l.team), ['AAA', 'BBB', 'CCC', 'DDD']);
});
