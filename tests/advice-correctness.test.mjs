import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planWeek } from '../src/engine/week-plan.mjs';
import { projectPlayers } from '../src/engine/projections.mjs';
const fresh = () => JSON.parse(readFileSync(new URL('./fixtures/v0/league.json', import.meta.url)));
const run = (f, { roles, preferences, projections, fromDate, bars } = {}) => planWeek({ snapshot: f.snapshot, schedule: f.schedule,
  projections: projections ?? { players: f.priors }, ids: f.ids, roles, preferences,
  options: { protectRank: 0, ...(fromDate && { fromDate }), ...(bars && { addBar: 0, dropBar: 0 }) } });
// A plan that proposes or waits on a move, or leaves a runner-up, is "a move exists".
const moves = (r) => r.action !== 'hold' || r.runnersUp.length > 0;
const droppedNames = (r) => [r.step, r.waitFor, ...r.plan, ...r.runnersUp.map((u) => u.step)].map((s) => s?.drop?.name);
const better = (f) => { f.snapshot.freeAgents[0].nbaTeam = 'AAA'; f.priors[2].perGame.pts = 60; };

test('IL drops require an unreserved active roster spot', () => {
  for (const slot of ['IL', 'IL+']) {
    const f = fresh(); better(f);
    const injured = { ...f.snapshot.team.roster[0], slot, status: 'O', name: 'Injured Synthetic' };
    f.snapshot.team.roster.push(injured);
    f.ids.players.push({ ...f.ids.players[0], name: injured.name });
    const opts = { roles: { core: ['Alex Sample'], stream: [injured.name] } };
    const full = run(f, opts);
    assert.equal(full.decision.action, 'hold');
    assert.equal(full.guardrail.blockedByRule.ilCapacity, 1);
    assert.ok(!moves(full));
    f.snapshot.settings.rosterPositions.push({ slot: 'BN', count: 1 });
    // planWeek adds into the open spot without a drop, so the IL player is no longer blocked or needed.
    const open = run(f, opts);
    assert.equal(open.action, 'add');
    assert.equal(open.step.drop, null);
    f.snapshot.team.pending = { waivers: [{ date: 'Oct 22', add: 'Pending Synthetic', drop: null }] };
    const reserved = run(f, opts);
    assert.ok(!moves(reserved));
    assert.equal(reserved.guardrail.blockedByRule.ilCapacity, 1);
  }
});

test('future lineup locks block drops while expired locks do not', () => {
  const f = fresh(); better(f);
  f.snapshot.team.roster[0].positions = ['PG'];
  for (const date of ['2026-10-20', '2026-10-22', '2026-11-02']) {
    const r = run(f, { roles: { stream: ['Alex Sample'] }, preferences: { lineupLocks: [{ date, slot: 'Util', player: 'Alex Sample' }] } });
    assert.equal(r.decision.action, 'hold');
    assert.equal(r.guardrail.blockedByRule.lineupLock, 1);
    assert.ok(!moves(r));
  }
  const expired = run(f, { fromDate: '2026-10-22', preferences: {
    lineupLocks: [{ date: '2026-10-20', slot: 'Util', player: 'Alex Sample' }] } });
  assert.ok(droppedNames(expired).includes('Alex Sample'));
});

test('null banked counting categories are excluded from baseline and move scores', () => {
  for (const side of ['mine', 'opponent']) for (const c of ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TO']) {
    const f = fresh(); better(f);
    // The pickup must help in more than the one excluded category, or the planner holds.
    Object.assign(f.priors[2].perGame, { reb: 20, ast: 15, stl: 4, blk: 4, fg3m: 6 });
    f.snapshot.matchup.totals[side][c] = null;
    const r = run(f, { fromDate: '2026-10-22', projections: projectPlayers(f.priors, f.ids, []), bars: true });
    assert.equal(r.baseline.categories[c].label, 'unknown');
    assert.equal(r.baseline.categories[c].pWin, null);
    // Bars are zero so the best step is proposed and its categories are reported.
    assert.equal(r.action, 'add');
    assert.ok(!(c in r.categories));
    assert.ok(Math.abs(r.gain - Object.values(r.categories).reduce((sum, v) => sum + v.change, 0)) < 1e-9);
    assert.equal(r.baseline.expectedCategories, Object.values(r.baseline.categories).reduce((sum, v) => sum + (v.pWin ?? 0), 0));
    const pre = run(f, { fromDate: f.snapshot.matchup.start });
    assert.notEqual(pre.baseline.categories[c].label, 'unknown');
    const zero = fresh(); better(zero); zero.snapshot.matchup.totals[side][c] = 0;
    assert.notEqual(run(zero, { fromDate: '2026-10-22' }).baseline.categories[c].label, 'unknown');
  }
});
