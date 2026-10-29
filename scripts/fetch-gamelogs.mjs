import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE, getJson, standardCode } from '../src/sources/espn.mjs';
import { parseScoreboard, parseBoxScore } from '../src/sources/espn-boxscore.mjs';
import { easternDate, logHash } from '../src/sources/gamelogs.mjs';

const args = process.argv.slice(2); const val = (k) => args.includes(k) ? args[args.indexOf(k) + 1] : undefined;
const season = val('--season');
if (!['2026-27', '2025-26'].includes(season)) throw new Error('usage: --season 2026-27|2025-26');
const snapshotFile = args.includes('--snapshot') ? val('--snapshot') : null;
const snapshot = snapshotFile ? JSON.parse(await readFile(snapshotFile, 'utf8')) : null;
const checkedAt = new Date().toISOString();
if (snapshot && (!Number.isFinite(Date.parse(snapshot.asOf)) || Date.parse(snapshot.asOf) > Date.parse(checkedAt))) throw new Error('Snapshot asOf must be a valid past timestamp');
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const from = val('--from') ?? (season === '2026-27' ? '2026-10-20' : '2025-10-21');
const to = val('--to') ?? (snapshot ? easternDate(snapshot.asOf) : season === '2026-27' ? yesterday : '2026-04-12');
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
if (!validDate(from) || !validDate(to) || from > to) throw new Error('invalid game-log date range');
if (snapshot && to !== easternDate(snapshot.asOf)) throw new Error('--to must match the snapshot Eastern date');
const dir = join('local', 'gamelogs', season); await mkdir(dir, { recursive: true });
const hashes = {};
for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
  const date = d.toISOString().slice(0, 10); const file = join(dir, `${date}.json`);
  const day = date.replaceAll('-', '');
  // The bare ?dates= URL can stay stuck on an empty 200 at ESPN's edge (2026-10-26); &limit=100 bypasses it.
  const board = await getJson(`${BASE}/scoreboard?dates=${day}&limit=100`, { cacheFile: `local/cache/espn/scoreboard-${day}.json`, maxAgeHours: 0 });
  if (!Array.isArray(board.events)) throw new Error(`scoreboard ${date} has no events array`);
  const events = parseScoreboard(board);
  const lines = [];
  for (const event of events) if (event.status === 'STATUS_FINAL') {
    const summary = await getJson(`${BASE}/summary?event=${event.espnEventId}`, { cacheFile: `local/cache/espn/summary-${event.espnEventId}.json`, maxAgeHours: 24 * 365 });
    const rows = parseBoxScore(summary, { date, standardCode });
    if (!rows.length) throw new Error(`Final game ${event.espnEventId} has no box score`);
    lines.push(...rows);
  }
  const text = `${JSON.stringify(lines, null, 2)}\n`;
  await writeFile(file, text);
  hashes[date] = logHash(text);
}
// Publish coverage only after every requested day succeeds. A partial refresh never looks fresh.
await writeFile(join(dir, '_coverage.json'), JSON.stringify({ checkedAt, from, through: to, hashes }, null, 2) + '\n');
console.log(`Game logs checked at ${checkedAt}; coverage ${from} to ${to}`);
