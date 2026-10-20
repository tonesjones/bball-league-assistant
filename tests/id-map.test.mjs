import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSnapshot } from '../src/sources/id-map.mjs';

test('matches snapshot locations and leaves unknown players visible', () => {
  const snapshot = { team: { roster: [{ name: 'Test Guard', nbaTeam: 'GSW' }] }, matchup: { opponentRoster: [{ name: 'Test Center', nbaTeam: 'BOS' }] }, freeAgents: [{ name: 'Unknown Player', nbaTeam: 'NYK' }] };
  const ids = { players: [{ name: 'Test Guard', team: 'GSW', espnId: '1' }, { name: 'Test Center', team: 'BOS', espnId: '2' }] };
  assert.deepEqual(matchSnapshot(snapshot, ids), {
    matched: [{ name: 'Test Guard', nbaTeam: 'GSW', espnId: '1', where: 'roster' }, { name: 'Test Center', nbaTeam: 'BOS', espnId: '2', where: 'opponent' }],
    unmatched: [{ name: 'Unknown Player', nbaTeam: 'NYK', where: 'freeAgent' }],
  });
});

test('prefers exact team and leaves ambiguous name unresolved', () => {
  const snapshot = { team: { roster: [{ name: 'Same Name', nbaTeam: 'BOS' }] }, matchup: { opponentRoster: [] }, freeAgents: [] };
  const ids = { players: [{ name: 'Same Name', team: 'GSW', espnId: '1' }, { name: 'Same Name', team: 'BOS', espnId: '2' }] };
  assert.equal(matchSnapshot(snapshot, ids).matched[0].espnId, '2');
});
