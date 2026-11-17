import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firstPages, laterPages, teamCount, matchupWeek, stamp, isPublicLog, PUBLIC_MODE_LINE } from '../src/sources/public-capture.mjs';
import { checkUrl } from '../src/sources/yahoo-urls.mjs';
import { parsePages, PUBLIC_TEAM_REASON } from '../src/sources/sheet-pages.mjs';
import { parseSettings } from '../src/sources/yahoo-pages/settings.mjs';

const dir = new URL('./fixtures/yahoo-pages/', import.meta.url);
const page = (name) => readFileSync(new URL(`${name}.txt`, dir), 'utf8');
// The signed-out view carries the site's "Sign in" link in its header.
const signedOut = (text) => text.replace('Yahoo Sports\n', 'Yahoo Sports\nSign in\n');
const without = (text, re) => text.split('\n').filter((l) => !re.test(l.trim())).join('\n');

test('every planned page is on the read-only list, and Tony\'s team is not read twice', () => {
  const all = [...firstPages('4242', '7'), ...laterPages('4242', '7', { week: 5, teams: 12, sunday: true })];
  for (const p of all) assert.equal(checkUrl(p.url, '4242'), null, p.url);
  const files = all.map((p) => p.file);
  assert.deepEqual(files.slice(0, 5), ['settings.txt', 'team.txt', 'matchup.txt', 'matchup-totals.txt', 'matchup-next.txt']);
  assert.ok(all.find((p) => p.file === 'matchup-totals.txt').url.endsWith('matchup?mid1=7&week=5'));
  assert.ok(all.find((p) => p.file === 'matchup-next.txt').url.endsWith('matchup?mid1=7&week=6'));
  assert.deepEqual(files.filter((f) => f.startsWith('fa-')), ['fa-1.txt', 'fa-2.txt', 'fa-3.txt', 'fa-4.txt']);
  assert.equal(files.filter((f) => f.startsWith('teams/')).length, 11);
  assert.ok(!files.includes('teams/7.txt'));
  assert.equal(new Set(files).size, files.length);
});

test('no next-week page except on Sunday, and no week pages without a week number', () => {
  const files = (o) => laterPages('4242', '7', o).map((p) => p.file);
  assert.ok(!files({ week: 5, teams: 4, sunday: false }).includes('matchup-next.txt'));
  const noWeek = files({ week: null, teams: null, sunday: true });
  assert.ok(!noWeek.some((f) => f.startsWith('matchup')));
  assert.ok(!noWeek.some((f) => f.startsWith('teams/')));
});

test('reads the team count and the week number', () => {
  assert.equal(teamCount('League Name:\tX\nMax Teams:\t12\nScoring Type:\tY'), 12);
  assert.equal(teamCount('nothing'), null);
  assert.equal(matchupWeek('Matchup\nWeek 5\nNov 16 - Nov 22\nWeek 6'), 5);
  assert.equal(matchupWeek('no week here'), null);
});

test('stamps the folder in the given time zone', () => {
  const t = new Date('2026-11-17T07:30:00Z');
  assert.deepEqual(stamp(t, 'America/Los_Angeles'), { folder: '2026-11-16-2330', weekday: 'Mon' });
  assert.deepEqual(stamp(t, 'UTC'), { folder: '2026-11-17-0730', weekday: 'Tue' });
});

test('recognizes a public capture log', () => {
  assert.equal(isPublicLog(`${PUBLIC_MODE_LINE}\nsettings.txt https://x ok\n`), true);
  assert.equal(isPublicLog('settings.txt https://x ok\n'), false);
  assert.equal(isPublicLog(null), false);
});

test('the signed-out check stays on unless the capture was public', () => {
  const text = signedOut(page('settings'));
  assert.throws(() => parseSettings(text), /signed out of Yahoo/);
  assert.deepEqual(parseSettings(text, 'settings', { publicView: true }).categories, parseSettings(page('settings')).categories);
  assert.match(parsePages({ settings: text }).settings.reason, /signed out of Yahoo/);
  assert.equal(parsePages({ settings: text }, { publicView: true }).settings.ok, true);
});

test('a public team page gives the roster only, without owner lines', () => {
  const pub = without(signedOut(page('team')), /^(You have used \d+ of|Waiver Budget:)/);
  const p = parsePages({ team: pub }, { publicView: true });
  assert.deepEqual(p.team, { ok: false, reason: PUBLIC_TEAM_REASON });
  assert.equal(p['team-public'].ok, true);
  assert.ok(p['team-public'].value.roster.length > 0);
  assert.equal(parsePages({ team: pub }).team.ok, false);
  assert.equal(parsePages({ team: pub })['team-public'], undefined);
});
