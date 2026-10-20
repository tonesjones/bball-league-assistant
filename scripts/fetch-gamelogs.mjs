import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE, getJson, standardCode } from '../src/sources/espn.mjs';
import { parseScoreboard, parseBoxScore } from '../src/sources/espn-boxscore.mjs';

const args = process.argv.slice(2); const val = (k) => args[args.indexOf(k) + 1];
const season = val('--season');
if (!['2026-27', '2025-26'].includes(season)) throw new Error('usage: --season 2026-27|2025-26');
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const from = val('--from') ?? (season === '2026-27' ? '2026-10-20' : '2025-10-21');
const to = val('--to') ?? (season === '2026-27' ? yesterday : '2026-04-12');
const dir = join('local', 'gamelogs', season); await mkdir(dir, { recursive: true });
for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
  const date = d.toISOString().slice(0, 10); const file = join(dir, `${date}.json`);
  let exists = false; try { await access(file); exists = true; } catch {}
  const day = date.replaceAll('-', '');
  const board = await getJson(`${BASE}/scoreboard?dates=${day}`, { cacheFile: `local/cache/espn/scoreboard-${day}.json`, maxAgeHours: 1 });
  const events = parseScoreboard(board);
  if (exists && events.every((e) => e.status === 'STATUS_FINAL')) continue;
  const lines = [];
  for (const event of events) if (event.status === 'STATUS_FINAL') {
    const summary = await getJson(`${BASE}/summary?event=${event.espnEventId}`, { cacheFile: `local/cache/espn/summary-${event.espnEventId}.json`, maxAgeHours: 24 * 365 });
    lines.push(...parseBoxScore(summary, { date, standardCode }));
  }
  await writeFile(file, `${JSON.stringify(lines, null, 2)}\n`);
}
