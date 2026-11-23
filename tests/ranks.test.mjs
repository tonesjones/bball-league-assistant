import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRankRows } from '../src/sources/yahoo-pages/ranks.mjs';

const dir = new URL('./fixtures/yahoo-pages/', import.meta.url);
const page = (name) => readFileSync(new URL(`${name}.txt`, dir), 'utf8');

test('taken page: Current rank and GP*, with and without a game result line', () => {
  assert.deepEqual(parseRankRows(page('taken-S_AL7-0'), 'taken-S_AL7-0', { publicView: true }), [
    { name: 'Jalen Testwood', nbaTeam: 'OKC', rank: 5, gp: 3 },
    { name: 'Marcus Mockwell Jr.', nbaTeam: 'TOR', rank: 41, gp: 4 },
    { name: 'Bo Benchward', nbaTeam: 'BOS', rank: null, gp: 0 },
  ]);
});

test('free-agent page: Current rank is the line before % Ros, GP* three lines before', () => {
  const rows = parseRankRows(page('fa-1'), 'fa-1');
  assert.deepEqual(rows[0], { name: 'Mark Fakeliams', nbaTeam: 'PHX', rank: 51, gp: 60 });
  assert.deepEqual(rows[1], { name: 'Rico Valemont', nbaTeam: 'CHI', rank: 59, gp: 65 });
});

test('team page: Current rank before % Start, GP* the first whole number', () => {
  const rows = parseRankRows(page('team'), 'team', { layout: 'team' });
  assert.deepEqual(rows[0], { name: 'Jalen Testwood', nbaTeam: 'OKC', rank: 8, gp: 41 });
  assert.equal(rows[1].name, 'Marcus Mockwell Jr.');
  assert.equal(rows[1].gp, 65);
});

test('team page with a Rank column and no % column: the number after the opponent', () => {
  const text = [
    'Yahoo Sports Fantasy Basketball', 'Pos', 'Players', 'GP*', 'Opp', 'Rank', 'MPG', 'TO', '',
    'PG', 'Ann AblePlayer Note', 'AAA - PG,SG', 'W, 100-90 @ BBB', '12', '@BBB', '236', '30:00', '1.5',
    'BN', 'Bo BakerPlayer Note', 'BBB - C', '10', '-', '33:10',
    'Legends and Glossaries',
  ].join('\n');
  assert.deepEqual(parseRankRows(text, 'team', { layout: 'team' }), [
    { name: 'Ann Able', nbaTeam: 'AAA', rank: 236, gp: 12 },
    { name: 'Bo Baker', nbaTeam: 'BBB', rank: null, gp: 10 },
  ]);
});

test('list page without a % line in a row fails instead of guessing', () => {
  const text = page('taken-S_AL7-0').replace('97%', '');
  assert.throws(() => parseRankRows(text, 'taken', { publicView: true }), /taken: line \d+: player row without/);
});

test('signed-out page fails unless the capture is public', () => {
  const text = page('taken-S_AL7-0').replace('Players\n', 'Sign in\nPlayers\n');
  assert.throws(() => parseRankRows(text, 'taken'), /signed out/);
  assert.equal(parseRankRows(text, 'taken', { publicView: true }).length, 3);
});
