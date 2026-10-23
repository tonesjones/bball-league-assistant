import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const DECISIONS_DIR = 'local/decisions';
export const validDecisionId = (id) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id);

export async function readDecision(id, dir = DECISIONS_DIR) {
  if (!validDecisionId(id)) throw new Error('invalid decisionId');
  const record = JSON.parse(await readFile(path.join(dir, `${id}.json`), 'utf8'));
  if (record.id !== id) throw new Error('decisionId does not match record');
  return record;
}

export async function saveDecision({ report, options, provenance }, dir = DECISIONS_DIR) {
  const id = randomUUID(), createdAt = new Date().toISOString();
  const file = path.join(dir, `${id}.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify({ id, createdAt, options, provenance, report }, null, 2) + '\n', { flag: 'wx' });
  return { id, path: file };
}
