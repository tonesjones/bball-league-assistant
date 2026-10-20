import { readFile } from 'node:fs/promises';

export async function loadGameLogs(season, from, to) {
  const start = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`); const rows = [];
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    try { rows.push(...JSON.parse(await readFile(`local/gamelogs/${season}/${date}.json`, 'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return rows;
}
