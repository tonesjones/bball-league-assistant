import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseInjuries, trimComment } from '../src/sources/espn-injuries.mjs';
import { loadInjuries } from '../src/sources/espn-injuries-load.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/espn/injuries.json', import.meta.url), 'utf8'));

test('the injuries parser reads status, dates, team, comment and the ESPN athlete ID', () => {
  const { fetchedAt, entries } = parseInjuries(fixture());
  assert.equal(fetchedAt, '2026-11-11T20:15:00Z');
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[0], { espnId: '1', name: 'Ann Able', team: 'AAA', status: 'Day-To-Day', date: '2026-11-10T21:00Z',
    returnDate: '2026-11-12', comment: 'Able (ankle) is questionable for Thursday.' });
  assert.equal(entries[1].returnDate, null);
  assert.equal(entries[3].team, 'GSW');
});

test('a feed without an injuries array throws', () => {
  assert.throws(() => parseInjuries({ status: 'success' }), /no injuries array/);
});

test('trimComment cuts long text to 160 characters and leaves short text alone', () => {
  assert.equal(trimComment('short'), 'short');
  const cut = trimComment('x'.repeat(200));
  assert.equal(cut.length, 160);
  assert.ok(cut.endsWith('...'));
});

test('a feed failure or a missing cached file returns a reason and does not throw', async () => {
  const failed = await loadInjuries({ get: async () => { throw new Error('ESPN request failed: https://example.test (503)'); } });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /503/);
  const none = await loadInjuries({ noFetch: true, cacheFile: new URL('./fixtures/espn/no-such-file.json', import.meta.url) });
  assert.deepEqual(none, { ok: false, reason: 'no cached file and --no-fetch' });
  const ok = await loadInjuries({ get: async () => fixture() });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.entries.length, 4);
});
