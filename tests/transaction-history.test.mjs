import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { trackTransactions } from '../src/sources/transaction-history.mjs';

test('transaction history backfills snapshots, deduplicates observations and never removes rolled-off events', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-transactions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { season: '2026-27', file: path.join(dir, 'history.jsonl') };
  const event = { team: 'Sample Team', time: 'Oct 21, 1:11 am', moves: [{ player: 'Sample Add', type: 'add', faab: 5 }, { player: 'Sample Drop', type: 'drop', faab: null }] };
  const capture = (asOf, events) => ({ snapshotPath: 'example.json', snapshot: { asOf, transactions: events } });
  const first = await trackTransactions([capture('2026-10-22', [{ ...event, moves: [...event.moves].reverse() }]), capture('2026-10-21', [event])], options);
  assert.equal(first.history.length, 1);
  assert.equal(first.history[0].firstSeen, '2026-10-21');
  const before = await readFile(options.file, 'utf8');
  const rerun = await trackTransactions([capture('2026-10-23', [])], options);
  assert.equal(rerun.history.length, 1); assert.equal(rerun.added.length, 0);
  assert.equal(await readFile(options.file, 'utf8'), before);
  const next = await trackTransactions([capture('2026-10-23', [{ ...event, team: 'Other Team' }])], options);
  assert.equal(next.added.length, 1); assert.equal(next.history.length, 2);
});
