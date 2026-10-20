import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { checkUrl } from '../src/sources/yahoo-urls.mjs';

const base = 'https://basketball.fantasysports.yahoo.com/nba/12345';

test('allows every page in docs/update-league.md', () => {
  for (const path of [
    '/settings',
    '/7',
    '/matchup?mid1=7',
    '/players?status=A&pos=P&sort=AR&sdir=1&count=75',
    '/transactions',
  ]) {
    assert.equal(checkUrl(base + path, '12345'), null, path);
  }
});

test('allows a URL given without a scheme', () => {
  assert.equal(checkUrl('basketball.fantasysports.yahoo.com/nba/12345/settings', '12345'), null);
});

test('leaves non-Yahoo sites alone', () => {
  assert.equal(checkUrl('https://www.espn.com/nba/schedule', '12345'), null);
  assert.equal(checkUrl('https://notyahoo.com/addplayer', '12345'), null);
});

test('blocks pages that change a roster or account', () => {
  for (const path of [
    '/addplayer?apid=1',
    '/7/dropplayer',
    '/7/proposetrade',
    '/7/editroster',
    '/players?status=A&action=add',
    '/matchup?mid1=7&crumb=x',
  ]) {
    assert.match(checkUrl(base + path, '12345'), /./, path);
  }
});

test('blocks other Yahoo hosts, other leagues, http and history moves', () => {
  assert.match(checkUrl('https://login.yahoo.com/', '12345'), /only/);
  assert.match(checkUrl('http://basketball.fantasysports.yahoo.com/nba/12345/settings', '12345'), /only/);
  assert.match(checkUrl('https://basketball.fantasysports.yahoo.com/nba/999/settings', '12345'), /league/);
  assert.match(checkUrl('back', '12345'), /history/);
});

test('hook script exits 2 on a blocked URL and 0 on an allowed one', () => {
  const run = (url) => {
    try {
      execFileSync('node', ['scripts/guard-yahoo-url.mjs'], {
        input: JSON.stringify({ tool_name: 'mcp__Claude_Browser__navigate', tool_input: { url } }),
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      return 0;
    } catch (err) {
      return err.status;
    }
  };
  assert.equal(run('https://basketball.fantasysports.yahoo.com/nba/1/addplayer'), 2);
  assert.equal(run('https://www.espn.com/'), 0);
});
