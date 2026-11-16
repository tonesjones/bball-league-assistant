import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRosterTree } from '../src/sources/yahoo-pages/roster-tree.mjs';
import { parsePages } from '../src/sources/sheet-pages.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/yahoo-pages/${name}`, import.meta.url), 'utf8');

test('Tony\'s tree: hidden starter slots follow the slot order, comboboxes give BN and IL, Empty rows are skipped', () => {
  const t = parseRosterTree(fixture('team-tree.txt'), 'team-tree', { activeSlots: ['PG', 'C', 'Util'] });
  assert.equal(t.name, 'Test Squad');
  assert.equal(t.date, '2026-11-15');
  assert.deepEqual(t.roster, [
    { name: 'Ann Able', nbaTeam: 'AAA', positions: ['PG', 'SG'], status: null, slot: 'PG' },
    { name: 'Bo Baker', nbaTeam: 'BBB', positions: ['C'], status: 'Q', slot: 'C' },
    { name: 'Cy Cole', nbaTeam: 'CCC', positions: ['PG'], status: null, slot: 'BN' },
    { name: 'Di Dunn', nbaTeam: 'DDD', positions: ['SF'], status: 'O', slot: 'IL' },
  ]);
  assert.equal(parseRosterTree(fixture('team-tree.txt')).roster[0].slot, null);
});

test('another team\'s tree has no slots', () => {
  const t = parseRosterTree(fixture('other-team-tree.txt'), 'teams/3-tree');
  assert.equal(t.name, 'Rival Five');
  assert.deepEqual(t.roster.map((p) => [p.name, p.nbaTeam, p.positions.join(','), p.status, p.slot]),
    [['Fay Fox', 'EEE', 'PF,C', null, null], ['Gus Gray', 'FFF', 'SG', 'O', null]]);
});

test('a tree that does not fit fails without quoting page text', () => {
  assert.throws(() => parseRosterTree(fixture('team-tree.txt'), 'team-tree', { activeSlots: ['C', 'PG', 'Util'] }), /starter order does not fit slot C/);
  assert.throws(() => parseRosterTree(fixture('team-tree.txt').replace('"Questionable"', '"Doubtful"'), 'team-tree'), /unknown status word/);
  assert.throws(() => parseRosterTree('table [ref_1]\n generic "x" [ref_2]'), /roster caption/);
});

test('parsePages uses a tree file when the team page is header-only', () => {
  const settings = fixture('settings.txt');
  const parsed = parsePages({ settings, team: 'Opus\nheader only', 'team-tree': fixture('team-tree.txt'),
    'teams/3': 'header only', 'teams/3-tree': fixture('other-team-tree.txt'), 'teams/4': 'header only' });
  assert.equal(parsed.team.ok, false);
  assert.equal(parsed['team-tree'].ok, false); // the fixture league has more starting slots than the tree's order fits
  const fit = parsePages({ team: 'header only', 'team-tree': fixture('team-tree.txt') });
  assert.equal(fit['team-tree'].ok, true);
  assert.equal(fit['team-tree'].value.roster[0].slot, null);
  assert.equal(parsed.teams[0].ok, true);
  assert.equal(parsed.teams[0].teamNumber, 3);
  assert.equal(parsed.teams[0].value.roster.length, 2);
  assert.equal(parsed.teams[1].ok, false);
});
