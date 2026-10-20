import test from 'node:test';
import assert from 'node:assert/strict';
import { assignLineup, projectTeam, UNKNOWN_MPG } from '../src/engine/needs.mjs';

const player = (name, positions, mpg) => ({ name, positions, prior: { mpg, perGame: { pts: 10 } }, nbaTeam: 'AAA', slot: 'BN' });
const slots = (...names) => names.map((slot) => ({ slot, count: 1 }));

test('two centers cannot share one C slot even when a guard slot is empty', () => {
  const high = player('Alex Sample', ['C'], 32), low = player('Blair Example', ['C'], 28);
  const lineup = assignLineup([low, high], slots('C', 'PG', 'BN', 'IL', 'IL+'));
  assert.deepEqual(lineup, [{ player: high, slot: 'C' }]);
  const projected = projectTeam([low, high], {}, {}, { rosterPositions: slots('C', 'PG') },
    { games: [{ date: '2026-10-20', home: 'AAA', away: 'BBB' }] }, '2026-10-20', '2026-10-20');
  assert.deepEqual(projected.started, [{ name: high.name, date: '2026-10-20', slot: 'C' }]);
  assert.equal(projected.totals.PTS, 10);
});

test('augmenting paths move earlier starters to keep the full legal lineup', () => {
  const flexible = player('Alex Sample', ['PG', 'SG'], 35);
  const guard = player('Blair Example', ['PG'], 30);
  const center = player('Casey Fiction', ['C'], 25);
  const lineup = assignLineup([center, guard, flexible], slots('Util', 'PG', 'SG'));
  assert.deepEqual(lineup, [{ player: flexible, slot: 'SG' }, { player: guard, slot: 'PG' }, { player: center, slot: 'Util' }]);
});

test('G and F accept their positions, direct slots reject others, counts expand', () => {
  for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
    const p = player('Alex Sample', [pos], 30);
    assert.equal(assignLineup([p], slots('G')).length, ['PG', 'SG'].includes(pos) ? 1 : 0);
    assert.equal(assignLineup([p], slots('F')).length, ['SF', 'PF'].includes(pos) ? 1 : 0);
    assert.equal(assignLineup([p], slots('C')).length, pos === 'C' ? 1 : 0);
  }
  const players = [player('Alex Sample', ['C'], 30), player('Blair Example', ['C'], 30)];
  assert.equal(assignLineup(players, [{ slot: 'C', count: 2 }]).length, 2);
  assert.deepEqual(assignLineup(players, []), []);
  assert.equal(assignLineup([{ name: 'Casey Fiction' }], slots('Util')).length, 1);
});

test('unknown priors take slots at 24 mpg and ties keep input order without mutation', () => {
  assert.equal(UNKNOWN_MPG, 24);
  const unknown = { name: 'Casey Fiction', positions: ['C'], prior: null };
  const low = player('Alex Sample', ['C'], 23), high = player('Blair Example', ['C'], 25);
  const players = [low, unknown, high], before = structuredClone(players);
  assert.equal(assignLineup([low, unknown], slots('C'))[0].player, unknown);
  assert.equal(assignLineup(players, slots('C'))[0].player, high);
  high.prior.mpg = 23;
  assert.equal(assignLineup([low, high], slots('C'))[0].player, low);
  high.prior.mpg = 25;
  assert.deepEqual(players, before);
});
