import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { easternDate, addDays } from '../engine/weeks.mjs';
import { BASE, getJson, standardCode } from './espn.mjs';
import { parseScoreboard, parseBoxScore } from './espn-boxscore.mjs';

export const logHash = (text) => createHash('sha256').update(text).digest('hex');
export { easternDate };

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

export async function loadGameLogs(season, from, to, { root = 'local/gamelogs' } = {}) {
  const start = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`); const rows = [];
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    try { rows.push(...JSON.parse(await readFile(path.join(root, season, `${date}.json`), 'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return rows;
}

// Fetches ESPN scoreboards and final box scores for each day from..to and writes one file a day.
// Coverage is written only after every day succeeds, so a partial refresh never looks fresh. It
// merges with the existing coverage when the two ranges touch, so a short refresh keeps older days.
export async function refreshGameLogs({ season, from, to, root = 'local/gamelogs', cacheDir = 'local/cache/espn', checkedAt = new Date().toISOString() }) {
  const dir = path.join(root, season); await mkdir(dir, { recursive: true });
  const hashes = {};
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10); const file = path.join(dir, `${date}.json`);
    const day = date.replaceAll('-', '');
    // The bare ?dates= URL can stay stuck on an empty 200 at ESPN's edge (2026-10-26); &limit=100 bypasses it.
    const board = await getJson(`${BASE}/scoreboard?dates=${day}&limit=100`, { cacheFile: path.join(cacheDir, `scoreboard-${day}.json`), maxAgeHours: 0 });
    if (!Array.isArray(board.events)) throw new Error(`scoreboard ${date} has no events array`);
    const lines = [];
    for (const event of parseScoreboard(board)) if (event.status === 'STATUS_FINAL') {
      const summary = await getJson(`${BASE}/summary?event=${event.espnEventId}`, { cacheFile: path.join(cacheDir, `summary-${event.espnEventId}.json`), maxAgeHours: 24 * 365 });
      const rows = parseBoxScore(summary, { date, standardCode });
      if (!rows.length) throw new Error(`Final game ${event.espnEventId} has no box score`);
      lines.push(...rows);
    }
    const text = `${JSON.stringify(lines, null, 2)}\n`;
    await writeFile(file, text);
    hashes[date] = logHash(text);
  }
  let coverage = { checkedAt, from, through: to, hashes };
  try {
    const old = JSON.parse(await readFile(path.join(dir, '_coverage.json'), 'utf8'));
    if (old.from && old.through && old.from <= addDays(to, 1) && old.through >= addDays(from, -1)) {
      coverage = { checkedAt, from: [old.from, from].sort()[0], through: [old.through, to].sort()[1], hashes: { ...old.hashes, ...hashes } };
    }
  } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  coverage.hashes = Object.fromEntries(Object.entries(coverage.hashes).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path.join(dir, '_coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
  return coverage;
}
