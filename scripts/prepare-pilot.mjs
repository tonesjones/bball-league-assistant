import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readDecision } from '../src/sources/decisions.mjs';
import { decisionInputs, hash } from '../src/sources/bakeoff-records.mjs';
import { playerEvidence } from '../src/engine/player-evidence.mjs';

const [id] = process.argv.slice(2);
if (!id) throw new Error('usage: npm run pilot:prepare -- <decisionId>');
const record = await readDecision(id), { snapshot, ids, schedule } = await decisionInputs(record);
const coverage = record.provenance.gameLogCoverage;
if (!coverage?.hashes) throw new Error('Decision has no hashed game-log coverage');
const logs = [];
for (const [date, expected] of Object.entries(coverage.hashes).sort()) {
  const text = await readFile(path.join('local/gamelogs', schedule.season ?? '2026-27', `${date}.json`));
  if (hash(text) !== expected) throw new Error(`Decision game logs changed on ${date}; preserve originals or prepare a new decision`);
  logs.push(...JSON.parse(text));
}
const folder = path.join('local/pilot-packets', `${id}-${randomUUID()}`);
await mkdir(folder, { recursive: true });
const files = {
  'snapshot.json': snapshot, 'projections.json': record.projections, 'ids.json': ids,
  'schedule.json': schedule, 'roles.json': record.options.roles,
  'gamelogs.json': logs, 'options.json': record.options, 'banked.json': record.report.banked,
  'evidence.json': playerEvidence(snapshot, ids, logs),
};
const hashes = {};
for (const [name, value] of Object.entries(files)) {
  const text = JSON.stringify(value, null, 2) + '\n';
  await writeFile(path.join(folder, name), text, { flag: 'wx' }); hashes[name] = hash(text);
}
const prompt = await readFile('docs/bakeoff-prompt.md', 'utf8');
const body = prompt.split('<!-- PROMPT START -->')[1]?.split('<!-- PROMPT END -->')[0]?.trim();
if (!body) throw new Error('Pilot prompt markers missing');
await writeFile(path.join(folder, 'prompt.txt'), body + '\n', { flag: 'wx' });
hashes['prompt.txt'] = hash(body + '\n');
const manifest = { status: 'rehearsal-not-frozen', decisionId: id, preparedAt: new Date().toISOString(),
  asOf: record.report.asOf, logCoverage: coverage, commit: record.provenance.commit,
  dirty: record.provenance.dirty, projectionVersion: record.provenance.projectionVersion,
  options: record.options, baselineModel: 'gpt-6.1-sol', hashes,
  pending: ['Tony reviews real move, hold and insufficient-evidence examples',
    'Merge and review model/scorer changes', 'Confirm frozen model, prompt, options and pilot start before prospective logging'] };
await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(`Prepared rehearsal packet: ${folder}\nNo pilot started. Use a fresh isolated chatbot session with only packet files; withhold the tool recommendation.`);
