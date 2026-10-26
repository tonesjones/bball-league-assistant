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
const pair = { pickup: { name: 'Casey Fiction', nbaTeam: 'CCC', status: null, games: 2 }, drop: { name: 'Drew Bench', nbaTeam: 'BBB', games: 1 },
  dropRole: 'stream', pickupStart: '2026-10-21', score: 0.25, changes: { PTS: { total: 4.5, pWin: 0.1 }, TO: { total: -1, pWin: 0.02 } } };

function inputs({ decision = { action: 'move', reason: 'clears the bar', pair } } = {}) {
  const snapshot = {
    asOf: '2026-10-20T05:00:00Z',
    settings: { rosterPositions: [{ slot: 'Util', count: 1 }, { slot: 'BN', count: 3 }, { slot: 'IL', count: 1 }] },
    team: { roster: [player('Alex Sample', 'AAA', { slot: 'Util' }), player('Drew Bench', 'BBB'), player('Ellis Hurt', 'AAA', { slot: 'IL', status: 'O' }), player('Finn Out', 'BBB', { status: 'O' })],
      pending: { proposedTrades: 1 } },
    matchup: { opponentRoster: [player('Gray Rival', 'CCC', { slot: 'Util' })] },
    freeAgents: [{ name: 'Casey Fiction', nbaTeam: 'CCC', positions: [], status: null, waiverClears: null },
      { name: 'Hale Waiver', nbaTeam: 'AAA', positions: ['C'], status: 'GTD', waiverClears: '2026-10-22' }],
  };
  const schedule = { games: [{ date: '2026-10-20', home: 'AAA', away: 'BBB' }, { date: '2026-10-21', home: 'AAA', away: 'BBB' },
    { date: '2026-10-22', home: 'CCC', away: 'DDD' }, { date: '2026-10-23', home: 'CCC', away: 'AAA' }, { date: '2026-10-30', home: 'AAA', away: 'BBB' }] };
  const record = {
    id: 'sample', createdAt: '2026-10-20T05:10:00Z', options: { roles: { core: ['Alex Sample'], stream: ['Drew Bench'] } },
    provenance: { modelVersion: 4 },
    report: {
      asOf: snapshot.asOf, week: 1, window: { start: '2026-10-20', end: '2026-10-23' }, fromDate: '2026-10-21', addsLeft: 3,
      baseline: { categories: {
        PTS: { mine: 100, opponent: 90, pWin: 0.7, label: 'lean', pWinRange: [0.7, 0.7], complete: true },
        'FG%': { mine: null, opponent: 0.47, pWin: null, label: 'unknown', pWinRange: [0.2, 0.6], complete: false },
      } },
      decision, topPairs: [pair], pending: { waivers: [{ order: 1, date: '2026-10-21', add: 'Iris Claim', bid: 3, drop: null }] },
      unscored: [{ name: 'Gray Rival', nbaTeam: 'CCC', where: 'opponent', reason: 'no prior' }],
    },
  };
  return { record, snapshot, schedule, prompt: 'PROMPT TEXT', promptVersion: 1, now: '2026-10-20T08:00:00Z' };
}

test('brief starts with the prompt and the as-of block', () => {
  const brief = buildBrief(inputs());
  assert.ok(brief.startsWith('PROMPT TEXT\n'));
  assert.match(brief, /Snapshot \(Yahoo pages read\): 2026-10-20T05:00:00Z/);
  assert.match(brief, /snapshot 3\.0 hours old/);
  assert.match(brief, /Model version: 4 \| Brief prompt version: 1/);
  assert.match(brief, /Games counted from 2026-10-21\. Adds left this week: 3/);
});

test('brief shows the move with its numbers, or a hold with its reason', () => {
  const move = buildBrief(inputs());
  assert.match(move, /Move: Pick up Casey Fiction \(CCC, healthy, 2 games from 2026-10-21\), drop Drew Bench \(BBB, 1 games left\)\. Score \+0\.250 categories\. Changes: PTS \+4\.500, TO -1\.000\./);
  assert.match(move, /## Alternatives\n\n1\. Pick up Casey Fiction/);
  const hold = buildBrief(inputs({ decision: { action: 'hold', reason: 'No pair clears the bar.', best: pair } }));
  assert.match(hold, /Hold: No pair clears the bar\.\n\nBest pair considered: Pick up Casey Fiction/);
  assert.match(buildBrief(inputs({ decision: { action: 'insufficient', reason: 'Missing rates.' } })), /Insufficient evidence: Missing rates\./);
});

test('brief counts games left from the first counted date and marks roles', () => {
  const brief = buildBrief(inputs());
  assert.match(brief, /\| Alex Sample \| AAA \| PG \| Util \| healthy \| core \| 2 \|/);
  assert.match(brief, /\| Drew Bench \| BBB \| PG \| BN \| healthy \| stream \| 1 \|/);
  assert.match(brief, /\| Gray Rival \| CCC \| Util \| healthy \| 2 \|/);
  assert.match(brief, /\| Hale Waiver \| AAA \| C \| GTD \| 2026-10-22 \| 2 \|/);
});

test('daily games flag a day with more players than active slots and skip IL and out players', () => {
  const brief = buildBrief(inputs());
  assert.match(brief, /\| 2026-10-21 \| 2 \| 1 \| over by 1 \| Alex Sample, Drew Bench \|/);
  assert.match(brief, /\| 2026-10-22 \| 0 \| 1 \|  \|  \|/);
  assert.doesNotMatch(brief, /2026-10-30/);
});

test('missing values print as unknown, never 0', () => {
  const brief = buildBrief(inputs());
  assert.match(brief, /\| FG% \| unknown \| 0\.470 \| 0\.20-0\.60 \| incomplete \|/);
  assert.match(brief, /\| Casey Fiction \| CCC \| unknown \| healthy \| free agent \| 2 \|/);
  assert.match(brief, /Claim 1 \(2026-10-21\): add Iris Claim for \$3/);
  assert.match(brief, /Proposed trades: 1/);
  assert.match(brief, /Gray Rival \(CCC, opponent\): no prior/);
});

test('the free-agent list respects the cap', () => {
  const brief = buildBrief({ ...inputs(), faLimit: 1 });
  assert.match(brief, /## Free agents \(first 1, Yahoo page order\)/);
  assert.doesNotMatch(brief, /Hale Waiver/);
});

test('the shipped prompt has markers and a version', async () => {
  const { prompt, version } = readPrompt(await readFile(new URL('../docs/chatgpt-brief.md', import.meta.url), 'utf8'));
  assert.ok(Number.isInteger(version) && version >= 1);
  assert.match(prompt, /Don't recompute/);
  assert.throws(() => readPrompt('no markers'), /prompt markers/);
});

test('brief CLI writes once and refuses a changed snapshot', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-brief-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { record, snapshot, schedule } = inputs();
  const ids = { players: [] };
  const snapshotPath = path.join(dir, 'local/snapshots/sample.json');
  const snapshotText = JSON.stringify(snapshot);
  Object.assign(record.provenance, { snapshotPath, snapshotHash: hash(snapshotText),
    scheduleHash: hash(JSON.stringify(schedule)), idsHash: hash(JSON.stringify(ids)) });
  Object.assign(record.report, { banked: {} });
  record.projections = { players: [] };
  const files = { 'local/snapshots/sample.json': snapshotText, 'data/ids.json': JSON.stringify(ids),
    'data/schedule-2026-27.json': JSON.stringify(schedule), 'local/decisions/sample.json': JSON.stringify(record) };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), text);
  }
  const cli = fileURLToPath(new URL('../scripts/brief.mjs', import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(run(), `Brief: ${path.join('local/briefs', 'sample.md')}\n`);
  const brief = await readFile(path.join(dir, 'local/briefs/sample.md'), 'utf8');
  assert.match(brief, /Brief prompt version: 1/);
  assert.throws(() => run('sample'), /already exists/);
  await rm(path.join(dir, 'local/briefs/sample.md'));
  await writeFile(snapshotPath, JSON.stringify({ ...snapshot, asOf: '2026-10-21T00:00:00Z' }));
  assert.throws(() => run('sample'), /snapshot hash changed/);
});
