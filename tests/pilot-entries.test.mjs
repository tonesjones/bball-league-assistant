import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseReply, pilotEntries } from '../src/engine/pilot-entries.mjs';
import { saveDecision } from '../src/sources/decisions.mjs';
import { advise } from '../src/engine/v0-advice.mjs';
import { projectPlayers } from '../src/engine/projections.mjs';
import { hash } from '../src/sources/bakeoff-records.mjs';

test('parseReply reads the two fixed formats and rejects anything else', () => {
  assert.deepEqual(parseReply('ADD: Casey Fiction | DROP: Alex Sample | START: 2026-10-21 | HELPS: PTS | HURTS: TO | WHY: More games.'),
    { decision: 'move', add: 'Casey Fiction', drop: 'Alex Sample', start: '2026-10-21' });
  assert.deepEqual(parseReply('Reading files...\n**ADD: Casey Fiction | DROP: none | START: 2026-10-21 | HELPS: PTS | HURTS: - | WHY: Open spot.**'),
    { decision: 'move', add: 'Casey Fiction', drop: null, start: '2026-10-21' });
  assert.deepEqual(parseReply('`HOLD | WHY: Nothing clears the bar.`'), { decision: 'hold' });
  assert.match(parseReply('I would add Casey Fiction.').invalidReason, /neither/);
  assert.match(parseReply('HOLD | WHY: a\nHOLD | WHY: b').invalidReason, /more than one/);
  assert.match(parseReply('ADD: A | DROP: B | START: tomorrow | HELPS: - | HURTS: - | WHY: -').invalidReason, /START/);
});

test('pilotEntries copies a tool move with ESPN ids and dates the entries in Los Angeles time', async () => {
  const f = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
  const pair = { pickup: { name: 'Casey Fiction', nbaTeam: 'CCC' }, drop: { name: 'Alex Sample', nbaTeam: 'AAA' }, pickupStart: '2026-10-21' };
  // 03:00 UTC on the 21st is still the 20th in Los Angeles.
  const record = { id: 'd1', report: { week: 1, asOf: '2026-10-21T03:00:00Z', decision: { action: 'move', pair } } };
  const [tool, none, chatbot] = pilotEntries({ record, snapshot: f.snapshot, ids: f.ids,
    manifest: { chatbotModel: 'gpt-6-sol', promptVersion: 2 }, reply: 'HOLD | WHY: Nothing clears the bar.' });
  assert.deepEqual(tool, { decisionId: 'd1', week: 1, date: '2026-10-20', asOf: '2026-10-21T03:00:00Z', rating: null, chatbot: null,
    source: 'tool', decision: 'move', start: '2026-10-21', add: { name: 'Casey Fiction', espnId: '3' }, drop: { name: 'Alex Sample', espnId: '1' } });
  assert.deepEqual([none.decision, none.add, none.drop], ['hold', null, null]);
  assert.deepEqual([chatbot.decision, chatbot.invalidReason], ['hold', undefined]);
  const insufficient = { ...record, report: { ...record.report, decision: { action: 'insufficient' } } };
  assert.equal(pilotEntries({ record: insufficient, snapshot: f.snapshot, ids: f.ids, manifest: {}, reply: '' })[0].decision, 'hold');
});

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'bball-pilot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = JSON.parse(await readFile(new URL('./fixtures/v0/league.json', import.meta.url)));
  const projections = projectPlayers(f.priors, f.ids, []);
  const report = advise(f.snapshot, { ...f, projections, protectRank: 0 });
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await mkdir(path.join(dir, 'docs'), { recursive: true });
  await writeFile(path.join(dir, 'docs/bakeoff-prompt.md'), await readFile(new URL('../docs/bakeoff-prompt.md', import.meta.url)));
  await writeFile(path.join(dir, 'data/ids.json'), JSON.stringify(f.ids));
  await writeFile(path.join(dir, 'data/schedule-2026-27.json'), JSON.stringify(f.schedule));
  const snapshotPath = path.join(dir, 'snapshot.json'), snapshotText = JSON.stringify(f.snapshot);
  await writeFile(snapshotPath, snapshotText);
  const decision = async () => (await saveDecision({ report, options: report.options, projections,
    provenance: { snapshotPath, snapshotHash: hash(snapshotText), idsHash: hash(JSON.stringify(f.ids)),
      scheduleHash: hash(JSON.stringify(f.schedule)), gameLogCoverage: { hashes: {} } } }, path.join(dir, 'local/decisions'))).id;
  const script = (name) => fileURLToPath(new URL(`../scripts/${name}.mjs`, import.meta.url));
  const prepare = (id, chatbotDir) => {
    execFileSync(process.execPath, [script('prepare-pilot'), id, '--chatbot-dir', chatbotDir], { cwd: dir, stdio: 'pipe' });
    return readdir(path.join(dir, 'local/pilot-packets')).then((names) => path.join(dir, 'local/pilot-packets', names.find((n) => n.startsWith(id))));
  };
  const pilot = async (packet, reply) => {
    const file = path.join(dir, `reply-${path.basename(packet)}.txt`); await writeFile(file, reply);
    return execFileSync(process.execPath, [script('bakeoff'), 'pilot', packet, '--reply', file], { cwd: dir, encoding: 'utf8' });
  };
  const rows = async () => (await readFile(path.join(dir, 'local/bakeoff.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  return { dir, report, decision, prepare, pilot, rows };
}

test('pilot builds and records all three arms from the packet and the raw chatbot reply', async (t) => {
  const { dir, report, decision, prepare, pilot, rows } = await setup(t);
  const id = await decision(), chatbotDir = path.join(dir, 'chatbot');
  const packet = await prepare(id, chatbotDir);
  const copied = (await readdir(chatbotDir)).sort();
  assert.ok(!copied.includes('manifest.json'));
  assert.deepEqual(copied, Object.keys(JSON.parse(await readFile(path.join(packet, 'manifest.json'))).hashes).sort());
  const reply = 'ADD: Casey Fiction | DROP: Alex Sample | START: 2026-10-20 | HELPS: PTS | HURTS: TO | WHY: More games.';
  const out = await pilot(packet, reply);
  assert.match(out, /chatbot: add Casey Fiction, drop Alex Sample, start 2026-10-20/);
  assert.match(out, new RegExp(`rate ${id} tool`));
  const [tool, none, chatbot] = await rows();
  assert.deepEqual([tool.source, none.source, chatbot.source], ['tool', 'none', 'chatbot']);
  assert.ok([tool, none, chatbot].every((e) => e.decisionId === id && e.asOf === report.asOf && e.rating === null && e.lineups));
  assert.equal(tool.decision, report.decision.action === 'move' ? 'move' : 'hold');
  assert.equal(none.decision, 'hold');
  assert.equal(chatbot.chatbot, 'gpt-6-sol');
  assert.equal(chatbot.promptVersion, 2);
  assert.deepEqual([chatbot.add, chatbot.drop], [{ name: 'Casey Fiction', espnId: '3' }, { name: 'Alex Sample', espnId: '1' }]);
  assert.equal(chatbot.note, reply);
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/bakeoff.mjs', import.meta.url)), 'pilot', packet,
    '--reply', path.join(dir, `reply-${path.basename(packet)}.txt`)], { cwd: dir, stdio: 'pipe' }), /already recorded/);
  assert.equal((await rows()).length, 3);
});

test('an unreadable, unknown or illegal chatbot answer is kept as an invalid hold with the raw reply', async (t) => {
  const { dir, decision, prepare, pilot, rows } = await setup(t);
  const replies = ['I like Casey Fiction here.',
    'ADD: Nobody Real | DROP: Alex Sample | START: 2026-10-20 | HELPS: PTS | HURTS: - | WHY: -',
    'ADD: Casey Fiction | DROP: Alex Sample | START: 2026-12-31 | HELPS: PTS | HURTS: - | WHY: -'];
  for (const [i, reply] of replies.entries()) await pilot(await prepare(await decision(), path.join(dir, `chatbot-${i}`)), reply);
  const chatbots = (await rows()).filter((e) => e.source === 'chatbot');
  assert.equal(chatbots.length, 3);
  assert.ok(chatbots.every((e) => e.decision === 'hold' && e.add === null && e.drop === null));
  assert.match(chatbots[0].invalidReason, /neither/);
  assert.match(chatbots[1].invalidReason, /ADD Nobody Real: not found/);
  assert.match(chatbots[2].invalidReason, /illegal move: .*effective date/);
  assert.deepEqual(chatbots.map((e) => e.note), replies);
});
