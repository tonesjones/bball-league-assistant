import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPriors } from "../scripts/import-draftlab.mjs";

test("buildPriors merges pool, minutes and per-game lines by name", () => {
  const players = buildPriors({
    pool: [["Pool Only", ["C"], "SA"], ["Both", ["PG", "SG"], "GS"]],
    pdata: { Both: { mpg: 33.1, cv: [1] }, "Pool Only": { mpg: null } },
    averages: {
      players: {
        Both: { g: 70, pts: 20, threes: 2.5 },
        "Averages Only": { g: 10, pts: 4, threes: 0.1 },
      },
    },
  });
  assert.deepEqual(
    players.map((p) => p.name),
    ["Averages Only", "Both", "Pool Only"],
  );
  const both = players.find((p) => p.name === "Both");
  assert.equal(both.team, "GSW");
  assert.deepEqual(both.positions, ["PG", "SG"]);
  assert.equal(both.mpg, 33.1);
  assert.deepEqual(both.perGame, { g: 70, pts: 20, fg3m: 2.5 });
  assert.equal("cv" in both, false);
  const poolOnly = players.find((p) => p.name === "Pool Only");
  assert.equal(poolOnly.team, "SAS");
  assert.equal(poolOnly.perGame, null);
  const avgOnly = players.find((p) => p.name === "Averages Only");
  assert.equal(avgOnly.team, null);
  assert.equal(avgOnly.positions, null);
});

test("committed priors have the expected shape", () => {
  const players = JSON.parse(readFileSync(new URL("../data/priors/players.json", import.meta.url)));
  assert.ok(players.length > 500);
  const keys = ["fga", "fgm", "fta", "ftm", "fg3m", "pts", "reb", "ast", "stl", "blk", "to", "g"];
  for (const p of players) {
    assert.equal(typeof p.name, "string");
    if (p.perGame) for (const k of keys) assert.equal(typeof p.perGame[k], "number", `${p.name} ${k}`);
  }
  const weeks = JSON.parse(readFileSync(new URL("../data/priors/playoff-weeks.json", import.meta.url)));
  for (const counts of Object.values(weeks.teams)) assert.equal(counts.length, weeks.weeks.length);
});
