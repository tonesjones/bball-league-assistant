import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function trackTransactions(snapshots, { season, file = 'local/transactions/history.jsonl' }) {
  let history = [];
  try { history = (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const known = new Set(history.map((r) => r.id)), added = [];
  for (const { snapshot, snapshotPath } of [...snapshots].sort((a, b) => a.snapshot.asOf.localeCompare(b.snapshot.asOf))) {
    for (const event of snapshot.transactions) {
      const moves = [...event.moves].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const id = createHash('sha256').update(JSON.stringify({ season, team: event.team, time: event.time, moves })).digest('hex');
      if (known.has(id)) continue;
      known.add(id);
      added.push({ id, season, firstSeen: snapshot.asOf, snapshotPath, event });
    }
  }
  if (added.length) {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, added.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return { history: [...history, ...added].filter((r) => r.season === season), added };
}
