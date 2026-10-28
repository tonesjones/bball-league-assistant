import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advise } from '../src/engine/v0-advice.mjs';
import { projectPlayers } from '../src/engine/projections.mjs';
const fresh = () => JSON.parse(readFileSync(new URL('./fixtures/v0/league.json', import.meta.url)));
const run = (f, options = {}) => advise(f.snapshot, { ...f, protectRank: 0, top: 100, ...options });
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
    assert.equal(full.topPairs.length, 0);
    f.snapshot.settings.rosterPositions.push({ slot: 'BN', count: 1 });
    assert.ok(run(f, opts).topPairs.some((p) => p.drop?.name === injured.name));
    f.snapshot.team.pending = { waivers: [{ date: 'Oct 22', add: 'Pending Synthetic', drop: null }] };
    const reserved = run(f, opts);
    assert.equal(reserved.topPairs.length, 0);
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
    assert.equal(r.topPairs.length, 0);
  }
  const expired = run(f, { fromDate: '2026-10-22', preferences: {
    lineupLocks: [{ date: '2026-10-20', slot: 'Util', player: 'Alex Sample' }] } });
  assert.ok(expired.topPairs.some((p) => p.drop.name === 'Alex Sample'));
});

test('null banked counting categories are excluded from baseline and move scores', () => {
  for (const side of ['mine', 'opponent']) for (const c of ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TO']) {
    const f = fresh(); better(f);
    f.snapshot.matchup.totals[side][c] = null;
    const r = run(f, { fromDate: '2026-10-22', projections: projectPlayers(f.priors, f.ids, []) });
    assert.equal(r.baseline.categories[c].label, 'unknown');
    assert.equal(r.baseline.categories[c].pWin, null);
    assert.equal(r.baseline.categories[c].pWinRange, null);
    assert.ok(r.topPairs.length);
    for (const pair of r.topPairs) {
      assert.ok(!(c in pair.changes));
      assert.ok(Math.abs(pair.score - Object.values(pair.changes).reduce((sum, v) => sum + v.pWin, 0)) < 1e-9);
    }
    assert.equal(r.baseline.expectedCategories, Object.values(r.baseline.categories).reduce((sum, v) => sum + (v.pWin ?? 0), 0));
    const pre = run(f, { fromDate: f.snapshot.matchup.start });
    assert.notEqual(pre.baseline.categories[c].label, 'unknown');
    const zero = fresh(); better(zero); zero.snapshot.matchup.totals[side][c] = 0;
    assert.notEqual(run(zero, { fromDate: '2026-10-22' }).baseline.categories[c].label, 'unknown');
  }
});
