import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { reviewState, saveRatings, recordBriefCopy } from '../src/sources/review-ui.mjs';
import { startReviewServer } from '../scripts/review.mjs';
import { applyReviews } from '../src/engine/bakeoff.mjs';

const now = '2026-10-28T05:00:00Z';
async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'bball-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'local/decisions'), { recursive: true });
  await mkdir(path.join(root, 'local/briefs'), { recursive: true });
  const record = { id: 'check-one', createdAt: now, provenance: { modelVersion: 7 }, report: {
    asOf: now, week: 2, window: { start: '2026-10-26', end: '2026-11-01' },
    decision: { action: 'hold', reason: 'No supported move.' }, notes: ['Synthetic evidence only.'] } };
  await writeFile(path.join(root, 'local/decisions/check-one.json'), JSON.stringify(record));
  await writeFile(path.join(root, 'local/briefs/check-one.md'), 'Synthetic ChatGPT brief');
  const line = Object.fromEntries(['pts','reb','ast','stl','blk','to','fg3m','fgm','fga','ftm','fta'].map((k) => [k, 0]));
  const entries = ['tool','chatbot','none'].map((source) => ({ decisionId: record.id, source, week: 2,
    asOf: now, date: '2026-10-27', rating: null, decision: 'hold', add: null, drop: null,
    ...(source === 'chatbot' && { chatbot: 'synthetic-model', note: 'HOLD | WHY: <img src=x onerror=alert(1)> Synthetic answer.' }),
    lineups: { baseline: [], proposed: [], opponent: [], banked: { mine: line, opponent: line }, from: '2026-10-28', through: '2026-11-01' } }));
  const entriesFile = path.join(root, 'local/bakeoff.jsonl');
  await writeFile(entriesFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const ratings = ['tool','chatbot','none'].map((source, i) => ({ source, rating: i + 3, note: `Reason for ${source}` }));
  return { root, record, entries, entriesFile, ratings };
}

test('review saves all three linked ratings in the existing scorecard format and retries without duplicates', async (t) => {
  const { root, ratings, entries } = await setup(t);
  assert.deepEqual(await saveRatings(root, 'check-one', ratings, { now }), { saved: true, changed: 3 });
  assert.deepEqual(await saveRatings(root, 'check-one', ratings, { now }), { saved: true, changed: 0 });
  let reviews = (await readFile(path.join(root, 'local/pilot-reviews.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(reviews.length, 3);
  assert.deepEqual(applyReviews(entries.map((entry) => ({ entry, windowEnd: '2026-11-01' })), reviews).results.map((r) => r.entry.rating), [3,4,5]);
  ratings[0].rating = 5;
  await saveRatings(root, 'check-one', ratings, { now });
  reviews = (await readFile(path.join(root, 'local/pilot-reviews.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(reviews.length, 4);
  const { selected } = await reviewState(root, 'check-one', { now });
  assert.equal(selected.ratingsSaved, 3); assert.equal(selected.arms[0].review.rating, 5);
  assert.equal(selected.brief, 'Synthetic ChatGPT brief');
  assert.equal(selected.arms[1].entry.note, entries[1].note);
  assert.equal(selected.arms[0].outcome.status, 'pending');
  assert.equal(selected.copiedAt, null);
  await recordBriefCopy(root, 'check-one', { now });
  assert.equal((await reviewState(root, 'check-one', { now })).selected.copiedAt, now);
});

test('invalid, incomplete, foreign and late ratings do not append', async (t) => {
  const { root, ratings, entries, entriesFile } = await setup(t);
  for (const bad of [ratings.slice(1), [ratings[0],ratings[0],ratings[2]], ratings.map((r) => ({ ...r, rating: 6 })), ratings.map((r) => ({ ...r, source: 'unknown' }))]) {
    await assert.rejects(saveRatings(root, 'check-one', bad, { now }));
  }
  await assert.rejects(saveRatings(root, '../check-one', ratings, { now }), /invalid decisionId/);
  await assert.rejects(saveRatings(root, 'check-one', ratings, { now: '2026-11-02T08:00:00Z' }), /ended/);
  await writeFile(entriesFile, JSON.stringify(entries[0]) + '\n');
  assert.equal((await reviewState(root, 'check-one', { now })).selected.pilotComplete, false);
  await assert.rejects(saveRatings(root, 'check-one', ratings, { now }), /all three/);
  entries[0].week = 3;
  await writeFile(entriesFile, entries.map((e) => JSON.stringify(e)).join('\n'));
  await assert.rejects(saveRatings(root, 'check-one', ratings, { now }), /do not match/);
  await assert.rejects(readFile(path.join(root, 'local/pilot-reviews.jsonl')), { code: 'ENOENT' });
});

test('results reuse replay scoring after matchup end and missing rows stay unscored', async (t) => {
  const { root, entries, entriesFile } = await setup(t);
  const after = { now: '2026-11-02T08:00:00Z' };
  let selected = (await reviewState(root, 'check-one', after)).selected;
  assert.ok(selected.closed);
  assert.ok(selected.arms.every((a) => a.outcome.status === 'scored' && a.outcome.changes.helped.length === 0));
  entries[0].lineups.baseline.push({ name: 'Synthetic Starter', espnId: '1', date: '2026-10-28' });
  await writeFile(entriesFile, entries.map((e) => JSON.stringify(e)).join('\n'));
  selected = (await reviewState(root, 'check-one', after)).selected;
  assert.equal(selected.arms[0].outcome.status, 'unscored');
  assert.match(selected.arms[0].outcome.reasons.join(' '), /Missing result/);
  assert.equal(selected.arms[0].outcome.changes, null);
});

test('local HTTP API protects private data, validates writes, and serves only explicit assets', async (t) => {
  const { root, ratings } = await setup(t);
  const { server, origin, token } = await startReviewServer({ root });
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal(server.address().address, '127.0.0.1');
  assert.equal((await fetch(`${origin}/api/state`)).status, 403);
  assert.equal((await fetch(`${origin}/api/state`, { headers: { ...headers, Origin: 'https://elsewhere.example' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    get(`${origin}/api/state`, { headers: { ...headers, Host: 'evil.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  const stateResponse = await fetch(`${origin}/api/state?decision=check-one`, { headers });
  assert.equal(stateResponse.status, 200);
  assert.equal((await stateResponse.json()).selected.id, 'check-one');
  assert.equal(stateResponse.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${origin}/local/decisions/check-one.json`)).status, 404);
  const post = (body, extra = {}) => fetch(`${origin}/api/ratings`, { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  assert.equal((await post({ decisionId: 'check-one', ratings }, { Origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await post({ decisionId: 'check-one', ratings: [] })).status, 400);
  // Use a future window for the real-clock HTTP write test.
  const file = path.join(root, 'local/decisions/check-one.json');
  const record = JSON.parse(await readFile(file)); record.report.window.end = '2099-01-01';
  await writeFile(file, JSON.stringify(record));
  assert.equal((await post({ decisionId: 'check-one', ratings })).status, 200);
  assert.equal((await post({ decisionId: 'check-one', ratings })).status, 200);
  assert.equal((await readFile(path.join(root, 'local/pilot-reviews.jsonl'), 'utf8')).trim().split('\n').length, 3);
  assert.equal((await fetch(origin)).status, 200);
  const js = await (await fetch(`${origin}/review.js`)).text();
  assert.ok(js.includes('textContent')); assert.ok(!js.includes('innerHTML'));
});


test('an explicitly selected check keeps its own brief when a newer decision exists', async (t) => {
  const { root, record } = await setup(t);
  const newer = { ...record, id: 'check-two', createdAt: '2026-10-29T05:00:00Z' };
  await writeFile(path.join(root, 'local/decisions/check-two.json'), JSON.stringify(newer));
  await writeFile(path.join(root, 'local/briefs/check-two.md'), 'A different brief');
  assert.equal((await reviewState(root, undefined, { now })).selected.id, 'check-two');
  const older = (await reviewState(root, 'check-one', { now })).selected;
  assert.equal(older.id, 'check-one');
  assert.equal(older.brief, 'Synthetic ChatGPT brief');
});
