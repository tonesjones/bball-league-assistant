#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, mkdtemp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startReviewServer, codeVersion } from '../../../scripts/review.mjs';
import { snapshotFreshness } from '../../../scripts/advise.mjs';
import { MODEL_VERSION } from '../../../src/engine/advice-common.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const exists = async (file) => { try { await access(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

async function doctor(source = root) {
  source = path.resolve(source);
  const blockers = [];
  if (Number(process.versions.node.split('.')[0]) < 20) blockers.push('Node 20+ required');
  const env = await readFile(path.join(source, '.env'), 'utf8').catch((e) => { if (e.code === 'ENOENT') return ''; throw e; });
  for (const key of ['YAHOO_LEAGUE_ID', 'YAHOO_TEAM_ID']) {
    const line = env.split(/\r?\n/).find((s) => s.trim().startsWith(key + '='));
    if (!line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '')) blockers.push(key + ' missing');
  }
  for (const file of ['data/ids.json', 'data/priors/players.json', 'data/schedule-2026-27.json']) {
    if (!await exists(path.join(source, file))) blockers.push('Missing ' + file);
  }
  let latestCapture = null;
  if (await exists(path.join(source, 'local/raw'))) {
    latestCapture = (await readdir(path.join(source, 'local/raw'))).filter((s) => /^\d{4}-\d\d-\d\d-\d{4}$/.test(s)).sort().at(-1) ?? null;
  }
  if (!latestCapture) blockers.push('No saved capture; fresh browser capture needed');
  else {
    for (const file of ['settings', 'team', 'matchup', 'matchup-totals', 'fa-1', 'fa-2', 'fa-3', 'fa-4', 'transactions']) {
      if (!await exists(path.join(source, 'local/raw', latestCapture, file + '.txt'))) blockers.push('Latest capture missing ' + file + '.txt');
    }
    const snapshot = path.join(source, 'local/snapshots', latestCapture + '.json');
    if (await exists(snapshot)) {
      try { snapshotFreshness((await json(snapshot)).asOf); } catch (e) { blockers.push(e.message); }
    } else blockers.push('Latest capture has no parsed snapshot; freshness not verified');
  }
  console.log(JSON.stringify({ source, node: process.version, latestCapture, blockers,
    unverified: ['Browser sign-in and unchanged-text export', 'ESPN network', 'Clipboard and rendered review'],
    stalePolicy: 'Evidence and refresh:analyze have no stale override. Use fresh capture; never rename old captures or change timestamps.' }, null, 2));
  if (blockers.length) process.exitCode = 2;
}

async function smoke() {
  const base = path.join(root, 'local/verification');
  await mkdir(base, { recursive: true });
  const evidence = await mkdtemp(path.join(base, 'review-'));
  const scratch = path.join(evidence, 'scratch');
  const before = { head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain') };
  let service, passed = false;
  const transcript = [];
  try {
    await mkdir(path.join(scratch, 'local/decisions'), { recursive: true });
    await mkdir(path.join(scratch, 'local/briefs'), { recursive: true });
    const now = new Date().toISOString();
    const record = { id: 'verification-only', createdAt: now, provenance: { modelVersion: MODEL_VERSION }, report: {
      asOf: now, week: 1, window: { start: now.slice(0, 10), end: '2099-01-01' },
      decision: { action: 'hold', reason: 'Synthetic verification; not league advice.' }, notes: [] } };
    await writeFile(path.join(scratch, 'local/decisions/verification-only.json'), JSON.stringify(record));
    const brief = 'SYNTHETIC VERIFICATION BRIEF\nNot current advice.\n';
    await writeFile(path.join(scratch, 'local/briefs/verification-only.md'), brief);
    service = await startReviewServer({ root: scratch, version: await codeVersion(root) });
    const { origin, token } = service;
    assert.equal(service.server.address().address, '127.0.0.1');
    async function request(route, data, auth = true) {
      const response = await fetch(origin + route, { signal: AbortSignal.timeout(5000),
        headers: { ...(auth && { Authorization: 'Bearer ' + token }), ...(data && { Origin: origin, 'Content-Type': 'application/json' }) },
        ...(data && { method: 'POST', body: JSON.stringify(data) }) });
      const body = await response.text();
      transcript.push({ route, method: data ? 'POST' : 'GET', request: data, status: response.status, body });
      return { status: response.status, body, value: () => JSON.parse(body) };
    }
    const health = await request('/api/health');
    assert.equal(health.status, 200); assert.equal(health.value().root, scratch);
    assert.equal(health.value().version, await codeVersion(root));
    assert.equal((await request('/api/state', null, false)).status, 403);
    const page = await request('/'); assert.equal(page.status, 200); assert.match(page.body, /Copy ChatGPT brief/);
    for (const route of ['/review.js', '/review.css']) assert.equal((await request(route)).status, 200);
    const state = (await request('/api/state?decision=verification-only')).value().selected;
    assert.equal(state.id, record.id); assert.equal(state.brief, brief); assert.equal(state.pilotComplete, false);
    assert.equal((await request('/api/ratings', { decisionId: record.id, ratings: [] })).status, 400);
    assert.equal(await exists(path.join(scratch, 'local/pilot-reviews.jsonl')), false);
    assert.equal((await request('/api/copied', { decisionId: record.id })).status, 200);
    const events = (await readFile(path.join(scratch, 'local/review-ui/events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(events.length, 1); assert.equal(events[0].type, 'brief-copied'); assert.equal(events[0].decisionId, record.id);
    assert.equal((await request('/api/state?decision=verification-only')).value().selected.copiedAt, events[0].recordedAt);
    await writeFile(path.join(evidence, 'copy-event.json'), JSON.stringify(events[0], null, 2));
    assert.deepEqual({ head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain') }, before);
    passed = true;
  } finally {
    if (service) {
      await new Promise((resolve, reject) => { service.server.close((e) => e ? reject(e) : resolve()); service.server.closeAllConnections(); });
      await assert.rejects(fetch(service.origin + '/api/health', { signal: AbortSignal.timeout(1000) }));
    }
    // Remove only this run's scratch directory, never real records or another server.
    assert.equal(path.dirname(scratch), evidence);
    await rm(scratch, { recursive: true, force: true });
    await writeFile(path.join(evidence, 'http.json'), JSON.stringify(transcript, null, 2));
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed, serverStopped: !service?.server.listening,
      scratchRemoved: !await exists(scratch), commit: before.head,
      coverage: 'Production review HTTP routes with synthetic disk inputs; not browser interaction, clipboard, brief generation, ESPN, or Yahoo capture.' }, null, 2));
    assert.ok(await exists(path.join(evidence, 'http.json')));
    console.log('Evidence retained: ' + evidence);
  }
  console.log('PASS: isolated review HTTP integration; cleanup and evidence retention verified.');
}
try {
  const [mode, source, ...extra] = process.argv.slice(2);
  if (extra.length || !['doctor', 'smoke'].includes(mode) || mode === 'smoke' && source) throw new Error('Usage: node .agents/skills/verify-league-refresh/check.mjs doctor [source-checkout] | smoke');
  if (mode === 'doctor') await doctor(source); else await smoke();
} catch (e) { console.error(e.stack); process.exitCode = 1; }
