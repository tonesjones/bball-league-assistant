import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreferences } from '../src/engine/preferences.mjs';
import { projectTeam, openRosterSpots } from '../src/engine/needs.mjs';

const player = (name, positions, extra = {}) => ({ name, nbaTeam: 'AAA', positions, status: null, slot: 'BN',
  prior: { mpg: 30, perGame: { pts: 10 } }, ...extra });
const settings = { rosterPositions: [{ slot: 'PG', count: 1 }, { slot: 'Util', count: 1 }, { slot: 'BN', count: 2 }, { slot: 'IL', count: 1 }] };
const snapshot = (roster) => ({ settings, team: { roster } });
const schedule = { games: [{ date: '2026-10-26', home: 'AAA', away: 'BBB' }] };

test('a lineup lock fixes that day\'s slot ahead of a higher-minutes player', () => {
  const star = player('Star Guard', ['PG'], { prior: { mpg: 36, perGame: { pts: 20 } } });
  const pg = player('Kyrie Sample', ['PG']), wing = player('Wing Sample', ['SF']);
  const { snapshot: s, notes } = applyPreferences(snapshot([star, pg, wing]),
    { lineupLocks: [{ date: '2026-10-26', slot: 'Util', player: 'Kyrie Sample' }] });
  const started = projectTeam(s.team.roster, {}, {}, settings, schedule, '2026-10-26', '2026-10-26').started;
  assert.deepEqual(started.map((g) => [g.name, g.slot]).sort(), [['Kyrie Sample', 'Util'], ['Star Guard', 'PG']]);
  assert.match(notes[0], /Kyrie Sample starts at Util on 2026-10-26/);
  const unlocked = projectTeam([star, pg, wing], {}, {}, settings, schedule, '2026-10-26', '2026-10-26').started;
  assert.equal(unlocked.length, 2);
});

test('only a listed IL candidate with an IL status opens a roster spot', () => {
  const hurt = player('Cason Sample', ['PG'], { status: 'O' }), other = player('Kawhi Sample', ['SF'], { status: 'O' });
  const full = snapshot([hurt, other, player('A', ['PG']), player('B', ['PG'])]);
  assert.equal(openRosterSpots(settings, full.team.roster), 0);
  const moved = applyPreferences(full, { ilCandidates: ['Cason Sample'], notIlCandidates: ['Kawhi Sample'] });
  assert.equal(moved.snapshot.team.roster.find((p) => p.name === 'Cason Sample').slot, 'IL');
  assert.equal(moved.snapshot.team.roster.find((p) => p.name === 'Kawhi Sample').slot, 'BN');
  assert.equal(openRosterSpots(settings, moved.snapshot.team.roster), 1);
  assert.equal(full.team.roster[0].slot, 'BN', 'the input snapshot is not changed');
  const healthy = applyPreferences(snapshot([player('Cason Sample', ['PG'])]), { ilCandidates: ['Cason Sample'] });
  assert.equal(healthy.snapshot.team.roster[0].slot, 'BN');
  assert.match(healthy.notes[0], /not IL-eligible/);
});

test('bad preferences fail loudly', () => {
  const s = snapshot([player('Cason Sample', ['PG'])]);
  assert.throws(() => applyPreferences(s, { ilCandidates: ['Nobody'] }), /Nobody is not on the roster/);
  assert.throws(() => applyPreferences(s, { ilCandidates: ['Cason Sample'], notIlCandidates: ['Cason Sample'] }), /both/);
  assert.throws(() => applyPreferences(s, { lineupLocks: [{ date: '2026-10-26', slot: 'BN', player: 'Cason Sample' }] }), /not an active slot/);
  assert.throws(() => applyPreferences(s, { lineupLocks: [{ date: '10/26', slot: 'Util', player: 'Cason Sample' }] }), /YYYY-MM-DD/);
  assert.throws(() => applyPreferences(snapshot([player('Big Sample', ['C'])]), { lineupLocks: [{ date: '2026-10-26', slot: 'PG', player: 'Big Sample' }] }), /can't play PG/);
});

test('empty preferences change nothing', () => {
  const roster = [player('Cason Sample', ['PG'])];
  const { snapshot: s, notes } = applyPreferences(snapshot(roster), {});
  assert.deepEqual(s.team.roster, roster);
  assert.deepEqual(notes, []);
});
