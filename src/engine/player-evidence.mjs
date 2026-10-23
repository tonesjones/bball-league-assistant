import { findPlayer } from './names.mjs';

const STATS = ['pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fg3m', 'fgm', 'fga', 'ftm', 'fta'];
const sumKnown = (rows, key) => rows.length && rows.every((r) => Number.isFinite(r[key]))
  ? rows.reduce((sum, row) => sum + row[key], 0) : null;
const ratio = (a, b) => a != null && b > 0 ? a / b : null;

export function summarizePerformance(logs) {
  const rows = logs.filter((r) => !r.didNotPlay).sort((a, b) => a.date.localeCompare(b.date) || String(a.espnEventId).localeCompare(String(b.espnEventId)));
  const games = rows.length, minutes = sumKnown(rows, 'min');
  const totals = Object.fromEntries(STATS.map((key) => [key, sumKnown(rows, key)]));
  let used = 0, exposure = 0, usageCoveredGames = 0;
  for (const r of rows) {
    const t = r.teamContext;
    if (!t || ![r.fga, r.fta, r.to, r.min, t.minutes, t.fga, t.fta, t.to].every((n) => Number.isFinite(n) && n >= 0)
      || r.min <= 0 || t.minutes <= 0 || t.fga + .44 * t.fta + t.to <= 0) continue;
    used += r.fga + .44 * r.fta + r.to;
    exposure += r.min / (t.minutes / 5) * (t.fga + .44 * t.fta + t.to);
    usageCoveredGames++;
  }
  const shootingAttempts = totals.fga != null && totals.fta != null ? totals.fga + .44 * totals.fta : null;
  return { games, dnps: logs.filter((r) => r.didNotPlay).length,
    starts: rows.every((r) => typeof r.starter === 'boolean') ? rows.filter((r) => r.starter).length : null,
    mpg: ratio(minutes, games),
    perGame: Object.fromEntries(STATS.map((key) => [key, ratio(totals[key], games)])),
    per36: Object.fromEntries(STATS.map((key) => [key, minutes > 0 && totals[key] != null ? totals[key] * 36 / minutes : null])),
    fgPct: ratio(totals.fgm, totals.fga), ftPct: ratio(totals.ftm, totals.fta),
    trueShootingPct: ratio(totals.pts, shootingAttempts == null ? null : 2 * shootingAttempts),
    estimatedUsgPct: games && usageCoveredGames === games && exposure > 0 ? 100 * used / exposure : null,
    usageCoveredGames, lastGame: rows.at(-1) ?? null };
}

export function playerEvidence(snapshot, ids, logs) {
  const through = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(snapshot.asOf));
  const recentStart = new Date(`${through}T00:00:00Z`); recentStart.setUTCDate(recentStart.getUTCDate() - 6);
  const recentFrom = recentStart.toISOString().slice(0, 10);
  const match = (players) => players.map((p) => {
    const { player, reason } = findPlayer(ids.players, p.name, p.nbaTeam);
    const rows = player ? logs.filter((r) => String(r.espnId) === String(player.espnId) && r.date <= through) : [];
    return { name: p.name, nbaTeam: p.nbaTeam, status: p.status ?? null, slot: p.slot ?? null,
      availability: p.availability ?? null, waiverClears: p.waiverClears ?? null, yahooRank: p.rank ?? null,
      espnId: player?.espnId ?? null, matchIssue: reason ?? null,
      season: summarizePerformance(rows), last7Days: summarizePerformance(rows.filter((r) => r.date >= recentFrom)) };
  });
  return { asOf: snapshot.asOf, through, recentFrom, roster: match(snapshot.team.roster),
    opponent: match(snapshot.matchup.opponentRoster), available: match(snapshot.freeAgents) };
}
