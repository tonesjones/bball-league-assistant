import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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

// Capture time wins over write time: rerunning an older capture must not become the default.
// Missing or invalid capture times sort last; creation time breaks ties.
export async function newestDecision(dir = DECISIONS_DIR) {
  const records = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.json'))
    .map((f) => readDecision(path.basename(f, '.json'), dir)));
  const timestamp = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
  records.sort((a, b) => {
    for (const [left, right] of [[a.report?.asOf, b.report?.asOf], [a.createdAt, b.createdAt]]) {
      const at = timestamp(left), bt = timestamp(right);
      if (at !== bt) return at > bt ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
  return records[0];
}

export async function saveDecision({ id = randomUUID(), report, options, provenance, projections = null }, dir = DECISIONS_DIR) {
  if (!validDecisionId(id)) throw new Error('invalid decisionId');
  const createdAt = new Date().toISOString();
  const file = path.join(dir, `${id}.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify({ id, createdAt, options, provenance, projections, report }, null, 2) + '\n', { flag: 'wx' });
  return { id, path: file };
}
