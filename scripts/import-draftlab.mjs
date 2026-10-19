#!/usr/bin/env node
// Import last season's priors from a local Draft Lab checkout.
//
//   node scripts/import-draftlab.mjs --from ../fantasy-basketball-mock-draft
//
// Writes data/priors/players.json, data/priors/playoff-weeks.json and
// data/priors/PROVENANCE.json. Draft Lab's data files are browser scripts, so
// they are evaluated in an isolated vm context with a stub `window`; nothing
// else from Draft Lab is loaded. Re-running with the same Draft Lab commit
// produces byte-identical output.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const FILES = ["player-pool.js", "player-data.js", "player-averages.js", "playoff-data.js"];

// Draft Lab uses Yahoo-style team codes; normalize to standard NBA codes.
const TEAM_ALIASES = { GS: "GSW", NO: "NOP", NOR: "NOP", NY: "NYK", PHO: "PHX", SA: "SAS", WAS: "WSH" };
const team = (code) => (code ? TEAM_ALIASES[code] || code : null);

function parseArgs(argv) {
  const i = argv.indexOf("--from");
  if (i < 0 || !argv[i + 1]) {
    console.error("usage: node scripts/import-draftlab.mjs --from <draft-lab-checkout> [--out <dir>]");
    process.exit(2);
  }
  const o = argv.indexOf("--out");
  return { from: resolve(argv[i + 1]), out: resolve(o >= 0 ? argv[o + 1] : "data/priors") };
}

export function loadDraftLab(dir) {
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // Top-level `var` declarations become context properties; exposing them
  // explicitly keeps this working if a file switches to `const`.
  const expose =
    "\n;this.__PLAYERS=typeof PLAYERS!=='undefined'?PLAYERS:undefined;" +
    "this.__PDATA=typeof PDATA!=='undefined'?PDATA:undefined;";
  for (const f of FILES) {
    vm.runInContext(readFileSync(join(dir, f), "utf8") + expose, ctx, { filename: f, timeout: 5000 });
  }
  const pool = ctx.__PLAYERS;
  const pdata = ctx.__PDATA;
  const averages = ctx.PlayerAverages;
  const playoff = ctx.PlayoffData;
  if (!Array.isArray(pool) || !pdata || !averages?.players || !playoff?.teams) {
    throw new Error("Draft Lab data files did not load the expected globals");
  }
  return { pool, pdata, averages, playoff };
}

export function buildPriors({ pool, pdata, averages }) {
  const byName = new Map();
  const entry = (name) => {
    if (!byName.has(name)) {
      byName.set(name, { name, team: null, positions: null, mpg: null, perGame: null });
    }
    return byName.get(name);
  };
  for (const [name, positions, code] of pool) {
    const p = entry(name);
    p.team = team(code);
    p.positions = [...positions];
    p.mpg = pdata[name]?.mpg ?? null;
  }
  for (const [name, line] of Object.entries(averages.players)) {
    const { threes, ...rest } = line;
    entry(name).perGame = { ...rest, fg3m: threes };
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const { from, out } = parseArgs(process.argv.slice(2));
  const data = loadDraftLab(from);
  const players = buildPriors(data);
  let commit = null;
  try {
    commit = execFileSync("git", ["-C", from, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Not a git checkout; provenance records null.
  }
  const provenance = {
    draftLabCommit: commit,
    files: FILES,
    season: data.averages.season,
    perGameSource: data.averages.source,
    perGameCaptured: data.averages.captured,
    playoffScheduleChecked: data.playoff.checked,
    playoffScheduleSource: data.playoff.source,
    counts: {
      players: players.length,
      withPerGame: players.filter((p) => p.perGame).length,
      withPositions: players.filter((p) => p.positions).length,
      withMpg: players.filter((p) => p.mpg != null).length,
    },
    notes:
      "Last season's priors only. Dropped on purpose: ADP, rank, cv z-scores, roleDelta, vacated usage, INJ badges.",
  };
  mkdirSync(out, { recursive: true });
  const write = (f, v) => writeFileSync(join(out, f), JSON.stringify(v, null, 2) + "\n");
  write("players.json", players);
  write("playoff-weeks.json", { weeks: data.playoff.weeks, teams: data.playoff.teams });
  write("PROVENANCE.json", provenance);
  console.log(JSON.stringify(provenance.counts));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
