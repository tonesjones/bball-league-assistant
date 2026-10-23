import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const logHash = (text) => createHash('sha256').update(text).digest('hex');
export const easternDate = (asOf) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf));

// Freshness describes when the scoreboards were checked, not when the last player played.
export async function loadProjectionLogs(season, { asOf, from, through = easternDate(asOf), root = 'local/gamelogs' }) {
  if (!Number.isFinite(Date.parse(asOf)) || !/^\d{4}-\d{2}-\d{2}$/.test(from ?? '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(through ?? '') || !Number.isFinite(Date.parse(from))
    || !Number.isFinite(Date.parse(through)) || from > through) throw new Error('Invalid projection game-log window');
  const dir = path.join(root, season);
  let coverage;
  try { coverage = JSON.parse(await readFile(path.join(dir, '_coverage.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; throw new Error('Game-log coverage is missing; run fetch:gamelogs --snapshot <snapshot.json>.'); }
  if (!Number.isFinite(Date.parse(coverage.checkedAt)) || Date.parse(coverage.checkedAt) < Date.parse(asOf)
    || !coverage.from || coverage.from > from || !coverage.through || coverage.through < through) {
    throw new Error('Game logs are older than the snapshot or lack season coverage; run fetch:gamelogs --snapshot <snapshot.json>.');
  }
  const logs = [];
  for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${through}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    let text;
    try { text = await readFile(path.join(dir, `${date}.json`), 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; throw new Error(`Missing game-log day ${date}; refresh game logs.`); }
    if (coverage.hashes?.[date] !== logHash(text)) throw new Error(`Game-log coverage/hash mismatch on ${date}; refresh game logs.`);
    const rows = JSON.parse(text);
    if (rows.some((row) => row.date !== date)) throw new Error(`Game-log date mismatch on ${date}`);
    if (rows.some((row) => typeof row.didNotPlay !== 'boolean' || !('starter' in row))) {
      throw new Error(`Game logs need DNP/starter migration on ${date}; refresh game logs.`);
    }
    logs.push(...rows);
  }
  return { logs, coverage };
}

export async function loadGameLogs(season, from, to) {
  const start = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`); const rows = [];
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    try { rows.push(...JSON.parse(await readFile(`local/gamelogs/${season}/${date}.json`, 'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return rows;
}
