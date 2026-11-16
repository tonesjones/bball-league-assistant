import { readFile } from 'node:fs/promises';
import { easternDate, refreshGameLogs } from '../src/sources/gamelogs.mjs';

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
const coverage = await refreshGameLogs({ season, from, to, checkedAt });
console.log(`Game logs checked at ${checkedAt}; coverage ${coverage.from} to ${coverage.through}`);
