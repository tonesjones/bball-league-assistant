// Usage: node scripts/capture-public.mjs [--tz America/Los_Angeles] [--sunday | --no-sunday]
// Reads the league's public Yahoo pages signed out, in a headless browser, and saves each page's
// text unchanged to local/raw/<YYYY-MM-DD-HHmm>/. No sign-in, no cookies, no clicks or typing.
// Only GET requests to Yahoo are allowed, and only URLs on the read-only list in
// src/sources/yahoo-urls.mjs are opened. See docs/update-league.md, "Cloud capture".
//
// Needs Playwright with Chromium, which cloud sessions have preinstalled. It is not a package
// dependency: the rest of the repo runs without it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { checkUrl } from '../src/sources/yahoo-urls.mjs';
import { firstPages, laterPages, takenPages, takenWindowDone, teamCount, matchupWeek, stamp, PUBLIC_MODE_LINE } from '../src/sources/public-capture.mjs';
import { parseOtherTeam } from '../src/sources/yahoo-pages/team.mjs';
import { parseRankRows } from '../src/sources/yahoo-pages/ranks.mjs';

const SPACING_MS = 2000; // between page loads
const RETRY_MS = 60000; // one retry per page, a minute later (docs/update-league.md)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(\\S+)\\s*$`, 'm'));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function args(argv) {
  const out = { tz: 'America/Los_Angeles', sunday: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tz') out.tz = argv[++i];
    else if (argv[i] === '--sunday') out.sunday = true;
    else if (argv[i] === '--no-sunday') out.sunday = false;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return out;
}

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    throw new Error('Playwright is not installed here. Cloud sessions have it; on a desktop, use the Chrome capture (docs/update-league.md).');
  }
}

async function main() {
  const opts = args(process.argv.slice(2));
  const league = env('YAHOO_LEAGUE_ID'), team = env('YAHOO_TEAM_ID');
  if (!/^\d+$/.test(league ?? '') || !/^\d+$/.test(team ?? '')) throw new Error('set YAHOO_LEAGUE_ID and YAHOO_TEAM_ID (environment or .env)');
  const { folder, weekday } = stamp(new Date(), opts.tz);
  const sunday = opts.sunday ?? weekday === 'Sun';
  const dir = join('local', 'raw', folder);
  if (existsSync(dir)) throw new Error(`${dir} already exists; wait a minute and run again`);
  mkdirSync(join(dir, 'teams'), { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Read only: no request to Yahoo other than GET, and no Yahoo page off the read-only list.
  await context.route('**/*', (route) => {
    const req = route.request();
    const host = new URL(req.url()).hostname;
    const yahoo = host === 'yahoo.com' || host.endsWith('.yahoo.com');
    if (yahoo && req.method() !== 'GET') return route.abort();
    if (yahoo && req.isNavigationRequest() && req.frame() === page.mainFrame() && checkUrl(req.url(), league)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();

  const log = [PUBLIC_MODE_LINE];
  const texts = {};
  async function read({ file, url }) {
    const blocked = checkUrl(url, league);
    if (blocked) {
      log.push(`${file} ${url} skipped: ${blocked}`);
      return;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2500);
        if (!res || res.status() >= 400) throw new Error(`HTTP ${res ? res.status() : 'no response'}`);
        if (/login\.yahoo\.com|signin/.test(new URL(page.url()).hostname + new URL(page.url()).pathname)) throw new Error('sent to a sign-in page');
        const text = await page.innerText('body');
        const out = join(dir, file);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, text);
        texts[file] = text;
        log.push(`${file} ${url} ok`);
        await sleep(SPACING_MS);
        return;
      } catch (err) {
        if (attempt === 2) log.push(`${file} ${url} skipped: ${err.message.split('\n')[0]}`);
        else await sleep(RETRY_MS);
      }
    }
  }

  try {
    for (const p of firstPages(league, team)) await read(p);
    const week = matchupWeek(texts['matchup.txt']);
    const teams = teamCount(texts['settings.txt']);
    for (const p of laterPages(league, team, { week, teams, sunday })) await read(p);
    // Taken-player pages: stop each window once all of Tony's rostered players are found.
    let rosterKeys = [];
    try {
      rosterKeys = parseOtherTeam(texts['team.txt'] ?? '', 'team', { publicView: true }).roster.map((p) => `${p.name}|${p.nbaTeam}`);
    } catch {
      log.push('taken pages: Tony\'s roster not read from team.txt, so every taken page is read');
    }
    for (const w of takenPages(league)) {
      const seen = new Set();
      for (const p of w.pages) {
        await read(p);
        let rows = null;
        try {
          const parsed = parseRankRows(texts[p.file] ?? '', p.file, { publicView: true });
          rows = parsed.length;
          for (const r of parsed) seen.add(`${r.name}|${r.nbaTeam}`);
        } catch { /* a skipped or unreadable page: keep reading the window */ }
        if (takenWindowDone(rosterKeys, seen, rows)) break;
      }
    }
  } finally {
    writeFileSync(join(dir, '_log.txt'), log.join('\n') + '\n');
    await browser.close();
  }
  const bad = log.filter((l) => /\bskipped\b/.test(l));
  console.log(dir);
  for (const l of bad) console.log(l.replace(/https?:\/\/\S+/, '<url>'));
  if (!texts['settings.txt'] || !texts['matchup.txt']) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
