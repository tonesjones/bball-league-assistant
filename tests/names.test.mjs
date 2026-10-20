import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, findPlayer } from '../src/engine/names.mjs';

test('normalizes punctuation, suffixes and accents', () => {
  assert.equal(normalizeName('A.J. Lawson'), normalizeName('AJ Lawson'));
  assert.equal(normalizeName('Jaren Jackson Jr.'), 'jaren jackson');
  assert.equal(normalizeName('Nikola Jokić'), 'nikola jokic');
});

test('findPlayer matches nicknames by last name and breaks ties by team', () => {
  const players = [{ name: 'Cameron Fakeson', team: 'DEN' }, { name: 'Ronald Madeup II', team: 'DET' }, { name: 'Sam Twin', team: 'BOS' }, { name: 'Sam Twin', team: 'MIA' }];
  assert.equal(findPlayer(players, 'Cam Fakeson', 'DEN').player.team, 'DEN');
  assert.equal(findPlayer(players, 'Ron Madeup', null).player.name, 'Ronald Madeup II');
  assert.equal(findPlayer(players, 'Sam Twin', 'MIA').player.team, 'MIA');
  assert.equal(findPlayer(players, 'Sam Twin', 'NYK').reason, 'ambiguous');
  assert.equal(findPlayer(players, 'C Fakeson', 'DEN').reason, 'not found');
  assert.equal(findPlayer(players, 'Nobody Here', 'DEN').reason, 'not found');
});
