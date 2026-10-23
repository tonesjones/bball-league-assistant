import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePerformance, playerEvidence } from '../src/engine/player-evidence.mjs';

const row = (fields = {}) => ({ espnId: '1', date: '2026-10-21', espnEventId: 'example', starter: true, didNotPlay: false,
  min: 24, pts: 12, reb: 6, ast: 3, stl: 1, blk: 2, to: 2, fg3m: 1, fgm: 5, fga: 10, ftm: 1, fta: 2,
  teamContext: { minutes: 240, fga: 80, fta: 20, to: 16 }, ...fields });

test('outside-source production, volume and estimated usage use actual box scores', () => {
  const r = summarizePerformance([row()]);
  assert.equal(r.games, 1); assert.equal(r.starts, 1); assert.equal(r.mpg, 24);
  assert.equal(r.perGame.pts, 12); assert.equal(r.fgPct, 0.5);
  assert.ok(Math.abs(r.estimatedUsgPct - 100 * (10 + .44 * 2 + 2) * 48 / (24 * (80 + .44 * 20 + 16))) < 1e-10);
  assert.equal(r.lastGame.date, '2026-10-21');
});

test('aggregate usage weights team-opportunity exposure and does not average game percentages', () => {
  const a = row(), b = row({ espnEventId: 'other', min: 12, fga: 4, fta: 0, to: 0, teamContext: { minutes: 265, fga: 100, fta: 30, to: 20 } });
  const r = summarizePerformance([a, b]);
  const exposure = 24 / 48 * (80 + .44 * 20 + 16) + 12 / 53 * (100 + .44 * 30 + 20);
  assert.ok(Math.abs(r.estimatedUsgPct - 100 * (10 + .44 * 2 + 2 + 4) / exposure) < 1e-10);
});

test('DNPs do not invent production, no games stays unknown, and missing usage inputs stay unknown', () => {
  const r = summarizePerformance([row(), row({ espnEventId: 'dnp', didNotPlay: true, min: 0, reason: "COACH'S DECISION", starter: false })]);
  assert.equal(r.games, 1); assert.equal(r.dnps, 1); assert.equal(r.perGame.pts, 12);
  assert.equal(summarizePerformance([]).mpg, null);
  assert.equal(summarizePerformance([]).estimatedUsgPct, null);
  assert.equal(summarizePerformance([row(), row({ espnEventId: 'missing', teamContext: null })]).estimatedUsgPct, null);
  assert.equal(summarizePerformance([row({ pts: undefined })]).perGame.pts, null);
});

test('player IDs join Yahoo availability to outside stats without using Yahoo performance fields', () => {
  const snapshot = { asOf: '2026-10-22T20:00:00Z', team: { roster: [{ name: 'Example', nbaTeam: 'AAA', pts: 999 }] },
    freeAgents: [{ name: 'Available', nbaTeam: 'BBB', rank: 1 }], matchup: { opponentRoster: [] } };
  const ids = { players: [{ name: 'Example', team: 'AAA', espnId: '1' }, { name: 'Available', team: 'BBB', espnId: '2' }] };
  const report = playerEvidence(snapshot, ids, [row()]);
  assert.equal(report.roster[0].season.perGame.pts, 12);
  assert.equal(report.available[0].season.games, 0);
  assert.equal(report.available[0].season.perGame.pts, null);
});
