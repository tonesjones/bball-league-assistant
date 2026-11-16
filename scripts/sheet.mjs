// Usage: node scripts/sheet.mjs <capture folder> [--no-fetch]
// Writes the facts sheet to local/sheets/<folder>.md. Paths for data/ and local/ resolve from the
// current directory, like fetch-gamelogs, so run it from the checkout that holds local/.
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { buildSheet } from '../src/engine/sheet.mjs';
import { parsePages, shortReason } from '../src/sources/sheet-pages.mjs';
import { parseScoreboard } from '../src/sources/espn-boxscore.mjs';
import { loadGameLogs, refreshGameLogs } from '../src/sources/gamelogs.mjs';
import { addDays } from '../src/engine/weeks.mjs';
import { loadInjuries } from '../src/sources/espn-injuries-load.mjs';

const FOLDER = /^(\d{4}-\d\d-\d\d)-(\d\d)(\d\d)$/;
const PAGE = /^(settings|team|team-tree|team-values|matchup|matchup-totals|matchup-next|transactions|fa-\d+)\.txt$/;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// Pages the capture log marks as skipped or sign-in count as missing, with that reason.
function readPages(dir) {
  const texts = {};
  for (const f of readdirSync(dir)) if (PAGE.test(f)) texts[f.slice(0, -4)] = readFileSync(join(dir, f), 'utf8');
  const teams = join(dir, 'teams');
  if (existsSync(teams)) for (const f of readdirSync(teams)) if (/^\d+(-tree)?\.txt$/.test(f)) texts[`teams/${f.slice(0, -4)}`] = readFileSync(join(teams, f), 'utf8');
  const log = join(dir, '_log.txt');
  if (existsSync(log)) {
    const status = {};
    for (const line of readFileSync(log, 'utf8').split(/\r?\n/)) {
      const m = /^(\S+\.txt)[\s|]+https?:\/\/\S+[\s|]*(.*)$/.exec(line.trim());
      if (m) status[m[1]] = m[2];
    }
    for (const [file, s] of Object.entries(status)) {
      if (/^(skipped|sign-in)\b/i.test(s)) texts[file.slice(0, -4)] = { reason: `capture log: ${s.split(/[\s:;]/)[0]}` };
    }
  }
  return texts;
}

async function main(args) {
  const noFetch = args.includes('--no-fetch');
  const rest = args.filter((a) => a !== '--no-fetch');
  if (rest.length !== 1 || rest[0].startsWith('-')) throw new Error('usage: npm run sheet -- <capture folder> [--no-fetch]');
  const dir = resolve(rest[0]);
  const folder = basename(dir);
  const m = FOLDER.exec(folder);
  if (!m) throw new Error(`folder name ${folder} is not YYYY-MM-DD-HHmm`);
  const [, captureDate, hh, mm] = m;

  const schedule = readJson('data/schedule-2026-27.json');
  const ids = readJson('data/ids.json');
  const priors = readJson('data/priors/players.json');
  const season = schedule.season ?? '2026-27';
  const logRoot = join('local', 'gamelogs');
  const warnings = [];
  if (!noFetch) {
    try {
      await refreshGameLogs({ season, from: addDays(captureDate, -6), to: captureDate, root: logRoot });
    } catch (err) {
      warnings.push(`ESPN refresh failed (${shortReason(err)}); using cached game logs`);
    }
  }
  const coverageFile = join(logRoot, season, '_coverage.json');
  const coverage = existsSync(coverageFile) ? readJson(coverageFile) : null;
  const seasonStart = schedule.games.map((g) => g.date).sort()[0];
  const logs = await loadGameLogs(season, seasonStart, captureDate, { root: logRoot });
  const boardFile = join('local', 'cache', 'espn', `scoreboard-${captureDate.replaceAll('-', '')}.json`);
  let scoreboard = null;
  if (existsSync(boardFile)) {
    const events = parseScoreboard(readJson(boardFile));
    const final = events.filter((e) => e.status === 'STATUS_FINAL').length;
    scoreboard = { final, notFinal: events.length - final };
  }

  const injuries = await loadInjuries({ noFetch });

  const { markdown, status } = buildSheet({ folder, captureDate, captureTime: `${hh}:${mm}`, pages: parsePages(readPages(dir)),
    ids, schedule, logs, priors, coverage, scoreboard, injuries, warnings });
  const out = join('local', 'sheets', `${folder}.md`);
  mkdirSync(join('local', 'sheets'), { recursive: true });
  writeFileSync(out, markdown);
  console.log(resolve(out));
  for (const w of warnings) console.log(`WARNING: ${w}`);
  for (const s of status) console.log(s);
}

main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exitCode = 1; });
