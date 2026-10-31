import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildBrief } from '../src/engine/brief.mjs';
import { readPrompt } from '../scripts/brief.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const player = (name, nbaTeam, extra = {}) => ({ name, nbaTeam, positions: ['PG'], status: null, slot: 'BN', ...extra });
const obj = (name, nbaTeam, extra = {}) => ({ name, nbaTeam, status: null, games: 2, minutes: { games: 4, season: 24.5, prior: null }, ...extra });

function inputs() {
  const snapshot = {
    asOf: '2026-10-20T05:00:00Z',
    settings: { rosterPositions: [{ slot: 'Util', count: 1 }, { slot: 'BN', count: 3 }, { slot: 'IL', count: 1 }] },
    team: { roster: [player('Alex Sample', 'AAA', { slot: 'Util' }), player('Drew Bench', 'BBB'), player('Ellis Hurt', 'AAA', { slot: 'IL', status: 'O' })] },
    matchup: { opponentRoster: [] }, freeAgents: [],
  };
  const casey = obj('Casey Fiction', 'CCC'), hale = obj('Hale Waiver', 'AAA', { minutes: { games: 9, season: 30, prior: 28.5 } }),
    iris = obj('Iris Claim', 'DDD', { minutes: { games: 5, season: 18.25, prior: 22 } });
  const step = (pickup) => ({ pickup, drop: null, start: '2026-10-21' });
  const record = {
    id: 'sample', createdAt: '2026-10-20T05:10:00Z', provenance: { modelVersion: 5 },
    report: {
      asOf: snapshot.asOf, week: 1, window: { start: '2026-10-20', end: '2026-10-23' }, fromDate: '2026-10-21', addsFrom: '2026-10-21',
      action: 'add', step: step(casey), waitFor: null, plan: [step(casey)], addsLeft: 3, openSpots: 1,
      startsByDay: [{ date: '2026-10-21', openSlots: 2, pickupStarts: true, displaced: [] },
        { date: '2026-10-22', openSlots: 0, pickupStarts: true, displaced: ['Drew Bench'] }],
      dependsOn: [{ player: casey, games: 4, seasonMpg: 24.5, priorMpg: null, cautiousAction: 'hold' },
        { player: hale, games: 9, seasonMpg: 30, priorMpg: 28.5, cautiousAction: 'hold' }],
      runnersUp: [{ step: step(hale), gain: 0.2, whyLost: 'lower-gain' }, { step: step(iris), gain: 0.1, whyLost: 'below-bar' },
        { step: step(casey), gain: 0.05, whyLost: 'later-start' }],
      decision: { action: 'move', pair: { pickup: casey, drop: null, pickupStart: '2026-10-21' } },
    },
  };
  return { record, snapshot, prompt: 'PROMPT TEXT', promptVersion: 3 };
}

test('every dependsOn player and runner-up appears once, in input order', () => {
  const brief = buildBrief(inputs());
  const at = ['Casey Fiction', 'Hale Waiver', 'Iris Claim'].map((n) => {
    assert.equal(brief.split(`${n} (`).length - 1, 1, n);
    return brief.indexOf(`${n} (`);
  });
  assert.ok(at[0] < at[1] && at[1] < at[2]);
  assert.match(brief, /Casey Fiction \(CCC\): 4 games played, season 24\.5 MPG, prior none MPG\.\nWill this role last through 2026-10-23\?/);
  assert.match(brief, /Hale Waiver \(AAA\): 9 games played, season 30\.0 MPG, prior 28\.5 MPG\./);
  assert.match(brief, /Iris Claim \(DDD\): 5 games played, season 18\.3 MPG, prior 22\.0 MPG\./);
});

test('brief has the sections in order, league rules and roster facts', () => {
  const brief = buildBrief(inputs());
  assert.ok(brief.startsWith('PROMPT TEXT\n'));
  const order = ['## League rules', '## Context questions', '## Roster facts'].map((h) => brief.indexOf(h));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2]);
  assert.match(brief, /PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, TO/);
  assert.match(brief, /Roster slots: Util x1, BN x3, IL x1/);
  assert.match(brief, /Adds left this week: 3/);
  assert.match(brief, /- Ellis Hurt \(AAA\): O/);
  assert.match(brief, /- Alex Sample \(AAA\): healthy/);
  assert.match(brief, /- 2026-10-21: 2 open/);
  assert.doesNotMatch(brief, /2026-10-22: /);
});

test('the timestamp is the decision as-of time, and the action is never shown', () => {
  const brief = buildBrief(inputs());
  assert.match(brief, /Data as of: 2026-10-20T05:00:00Z/);
  assert.doesNotMatch(brief, /gain|whyLost|cautious|Move|Pick up|displaced/i);
});

test('no line has a player name together with add, drop, wait or hold', () => {
  const { record, snapshot, prompt, promptVersion } = inputs();
  const names = [...snapshot.team.roster.map((p) => p.name), 'Casey Fiction', 'Hale Waiver', 'Iris Claim'];
  const brief = buildBrief({ record, snapshot, prompt, promptVersion });
  for (const line of brief.split('\n')) {
    if (names.some((n) => line.includes(n))) assert.doesNotMatch(line, /\b(add|drop|wait|hold)\b/i, line);
  }
});

test('the same decision gives a byte-identical brief', () => {
  assert.equal(buildBrief(inputs()), buildBrief(inputs()));
});

test('the shipped prompt has markers and a version', async () => {
  const { prompt, version } = readPrompt(await readFile(new URL('../docs/chatgpt-brief.md', import.meta.url), 'utf8'));
  assert.ok(Number.isInteger(version) && version >= 3);
  assert.match(prompt, /Don't compute/);
  assert.throws(() => readPrompt('no markers'), /prompt markers/);
});

test('brief CLI writes once, accepts --state and --fa, and refuses a changed snapshot', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-brief-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { record, snapshot } = inputs();
  const schedule = { games: [] }, ids = { players: [] };
  const snapshotPath = path.join(dir, 'local/snapshots/sample.json');
  const snapshotText = JSON.stringify(snapshot);
  Object.assign(record.provenance, { snapshotPath, snapshotHash: hash(snapshotText),
    scheduleHash: hash(JSON.stringify(schedule)), idsHash: hash(JSON.stringify(ids)) });
  Object.assign(record.report, { banked: {} });
  record.projections = { players: [] };
  const files = { 'local/snapshots/sample.json': snapshotText, 'data/ids.json': JSON.stringify(ids),
    'data/schedule-2026-27.json': JSON.stringify(schedule), 'local/decisions/sample.json': JSON.stringify(record) };
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), body);
  }
  const cli = fileURLToPath(new URL('../scripts/brief.mjs', import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(run('--state', 'x.md', '--fa', '10'), `Brief: ${path.join('local/briefs', 'sample.md')}\n`);
  const brief = await readFile(path.join(dir, 'local/briefs/sample.md'), 'utf8');
  assert.match(brief, /Brief prompt version: 3/);
  assert.throws(() => run('sample'), /already exists/);
  await rm(path.join(dir, 'local/briefs/sample.md'));
  await writeFile(snapshotPath, JSON.stringify({ ...snapshot, asOf: '2026-10-21T00:00:00Z' }));
  assert.throws(() => run('sample'), /snapshot hash changed/);
});
