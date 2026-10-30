import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
export const TEAM_CODES = { GS: 'GSW', SA: 'SAS', NY: 'NYK', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' };
export const standardCode = (abbr) => TEAM_CODES[abbr] ?? abbr;
let lastRequest = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getJson(url, { cacheFile, maxAgeHours = 24 } = {}) {
  if (cacheFile) {
    try {
      if (Date.now() - (await stat(cacheFile)).mtimeMs < maxAgeHours * 3600000) return JSON.parse(await readFile(cacheFile, 'utf8'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let json;
  for (let attempt = 0; attempt <= 3; attempt++) {
    const wait = 500 - (Date.now() - lastRequest);
    if (wait > 0) await delay(wait);
    lastRequest = Date.now();
    let response;
    // A shell without network access fails DNS (ENOTFOUND); resets and timeouts are retried like a 503.
    try { response = await fetch(url, { signal: AbortSignal.timeout(30000) }); }
    catch (cause) {
      if (attempt === 3) {
        const code = cause.cause?.code ?? cause.name;
        throw new Error(`ESPN unreachable: ${url} (${code}, 4 attempts). Check that this shell has network access.`, { cause });
      }
      await delay(2000 * (2 ** attempt));
      continue;
    }
    if (response.ok) {
      try { json = await response.json(); break; }
      catch (cause) {
        if (attempt === 3) throw new Error(`ESPN invalid JSON: ${url} (HTTP ${response.status}, 4 attempts): ${cause.message}`, { cause });
      }
    } else {
      await response.body?.cancel();
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) throw new Error(`ESPN request failed: ${url} (${response.status})`);
    }
    await delay(2000 * (2 ** attempt));
  }
  if (cacheFile) {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(json, null, 2));
  }
  return json;
}
