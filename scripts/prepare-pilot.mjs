import { constants, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readDecision } from '../src/sources/decisions.mjs';
import { decisionInputs, hash } from '../src/sources/bakeoff-records.mjs';
import { playerEvidence } from '../src/engine/player-evidence.mjs';

const [id, ...rest] = process.argv.slice(2);
const chatbotDir = rest[0] === '--chatbot-dir' ? rest[1] : undefined;
if (!id || (rest.length && !chatbotDir)) throw new Error('usage: npm run pilot:prepare -- <decisionId> [--chatbot-dir <new empty folder>]');
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
await mkdir('local/pilot-replies', { recursive: true });
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
const field = (label) => {
  const value = new RegExp(`^${label}: (\\S+)$`, 'm').exec(prompt)?.[1];
  if (!value) throw new Error(`docs/bakeoff-prompt.md has no "${label}:" line`);
  return value;
};
const manifest = { protocol: 'continuous', decisionId: id, preparedAt: new Date().toISOString(),
  asOf: record.report.asOf, logCoverage: coverage, commit: record.provenance.commit,
  dirty: record.provenance.dirty, modelVersion: record.provenance.modelVersion ?? null,
  projectionVersion: record.provenance.projectionVersion, options: record.options,
  promptVersion: Number(field('Prompt version')), chatbotModel: field('Chatbot model'),
  chatbotEffort: field('Chatbot effort'), hashes };
await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
if (chatbotDir) {
  // The chatbot sees only the hashed files: no manifest, which names the decision and commit.
  await mkdir(chatbotDir, { recursive: true });
  for (const name of Object.keys(hashes)) await copyFile(path.join(folder, name), path.join(chatbotDir, name), constants.COPYFILE_EXCL);
  console.log(`Copied the chatbot's files to: ${chatbotDir}`);
}
console.log(`Prepared pilot packet: ${folder}\nRun the chatbot arm (prompt version ${manifest.promptVersion}, ${manifest.chatbotModel}, ${manifest.chatbotEffort}) in a fresh isolated session with only the files in manifest.hashes; withhold the tool recommendation.`);
