import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const BAKEOFF_LOG = 'local/bakeoff.jsonl';

export async function readEntries(path = BAKEOFF_LOG) {
  try { return (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

// Append-only. A second entry for the same decision and source needs replaces: true, and the newest
// entry counts: readers apply latestEntries from src/engine/bakeoff.mjs.
export async function appendEntries(entries, path = BAKEOFF_LOG) {
  await mkdir(dirname(path), { recursive: true });
  const keys = new Set((await readEntries(path)).map((e) => `${e.decisionId}/${e.source}`));
  for (const entry of entries) {
    const key = `${entry.decisionId}/${entry.source}`;
    if (keys.has(key) && entry.replaces !== true) throw new Error(`Decision/source already recorded: ${key}`);
    keys.add(key);
  }
  await appendFile(path, entries.map((e) => JSON.stringify({ taken: false, ...e, recordedAt: new Date().toISOString() })).join('\n') + '\n');
}
