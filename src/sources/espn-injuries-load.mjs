import { readFile } from 'node:fs/promises';
import { BASE, getJson } from './espn.mjs';
import { parseInjuries } from './espn-injuries.mjs';
import { shortReason } from './sheet-pages.mjs';

export const INJURIES_CACHE = 'local/cache/espn/injuries.json';

// Returns { ok: true, value } or { ok: false, reason }. Never throws: a feed failure must not stop the sheet.
// noFetch reads the cached file only. The cache life is short because injuries change daily.
export async function loadInjuries({ noFetch = false, cacheFile = INJURIES_CACHE, maxAgeHours = 2, get = getJson } = {}) {
  try {
    const json = noFetch ? JSON.parse(await readFile(cacheFile, 'utf8')) : await get(`${BASE}/injuries`, { cacheFile, maxAgeHours });
    return { ok: true, value: parseInjuries(json) };
  } catch (err) {
    return { ok: false, reason: noFetch && err.code === 'ENOENT' ? 'no cached file and --no-fetch' : shortReason(err) };
  }
}
