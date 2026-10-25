import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { advise } from '../src/engine/v0-advice.mjs';
import { projectPlayers } from '../src/engine/projections.mjs';
import { loadProjectionLogs } from '../src/sources/gamelogs.mjs';
import { estimateVolume } from '../src/engine/shooting-volume.mjs';
import { findPlayer } from '../src/engine/names.mjs';
import { addDays, tomorrow } from '../src/engine/weeks.mjs';
import { planStreamChains } from '../src/engine/stream-chain.mjs';
import { readRoles, snapshotFreshness } from './advise.mjs';

const read = async (f) => JSON.parse(await readFile(f, 'utf8'));
const caseRange = (pair) => {
  const scores = [...(pair.minuteScenarios ?? []), ...(pair.rateScenarios ?? [])].flatMap((s) => s.scoreRange);
  return scores.length ? `${Math.min(...scores).toFixed(3)} to ${Math.max(...scores).toFixed(3)}` : 'none';
};
export function formatStreamPlan(r) {
  const out = [`Stream plan: ${r.fromDate} to ${r.toDate}`, `Snapshot: ${r.asOf} | Schedule fetched: ${r.scheduleFetchedAt ?? 'unknown'}`,
    `Adds week: ${r.addsWeek} (transaction date is the day before effective date)`,
    `Adds left in the first adds week ${r.addsLeft}; reserved for hold ${r.reservedAdds}; available for chains ${r.addsAvailable}.`,
    'Day | Games | Starters | Benched | Open'];
  if (r.freshness?.stale) out.push(`STALE: snapshot is ${r.freshness.ageHours.toFixed(2)} hours old.`);
  for (const d of r.dayTable) out.push(`${d.date} | ${d.games.join(', ') || 'none'} | ${d.starters.join(', ') || 'none'} | ${d.benched.length} (${d.benched.join(', ') || 'none'}) | ${d.openSlots.join(', ') || 'none'}`);
  if (r.holds.length) out.push('', 'Long-term pickups first:', ...r.holds.map((h) => [`${h.name} (${h.team}): ${h.recommended ? 'advice pickup' : 'inside protect rank'}`,
    `${h.games} starts in window`, h.cases.length ? `season rank ${h.cases.map((c) => `#${c.rank} (${c.minutes} minutes, ${c.rate} rates)`).join(', ')}` : 'no projection',
    h.evidence ? `advice gain ${h.evidence.score.toFixed(3)} (minutes and rate cases ${caseRange(h.evidence)})` : null].filter(Boolean).join('; ')));
  if (r.reason) out.push(r.reason);
  for (const p of r.plans) {
    out.push('', `${p.budget} adds: ${p.status}`);
    for (const [i, l] of (p.links ?? []).entries()) out.push(
      `${i + 1}. ${l.player.name} (${l.team}) ${l.start} to ${l.end}: ${l.startedGames} starts${l.unprojected ? ' (unprojected)' : ''}${i === 0 ? l.usesAdd ? ' [recommendation: add]' : ' [recommendation: keep current player]' : ' [illustrative only]'}`,
      `   ${l.daily.map((d) => `${d.date}: ${d.startedGames}`).join(' | ')}`,
      `   Alternatives: ${l.alternatives.map((a) => `${a.name} (${a.team})${a.unprojected ? ' (unprojected)' : ''}`).join(', ') || 'none'}`);
    if (p.status === 'planned') out.push(`Total ${p.totalGames} started games; adds used ${p.addsUsed}. No move: ${r.noMoveGames} starts.`);
  }
  out.push('', 'Only the first link is a recommendation. If it is the current player, keep them; otherwise make that add. Refresh and rerun before the next link.');
  return out.join('\n');
}

async function main(args) {
  let snapshotPath, slot, fromDate, toDate, addsWeek = 'effective';
  const freshnessOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slot') slot = args[++i];
    else if (args[i] === '--from') fromDate = args[++i];
    else if (args[i] === '--to') toDate = args[++i];
    else if (args[i] === '--adds-week') addsWeek = args[++i];
    else if (args[i] === '--allow-stale') freshnessOptions.allowStale = true;
    else if (args[i] === '--max-age-hours') freshnessOptions.maxAgeHours = Number(args[++i]);
    else if (args[i].startsWith('-') || snapshotPath) throw new Error(`unexpected argument: ${args[i]}`);
    else snapshotPath = args[i];
  }
  if (!slot) throw new Error('--slot is required (stream player name or empty)');
  if (!['effective', 'transaction'].includes(addsWeek)) throw new Error('--adds-week must be effective or transaction');
  if (!snapshotPath) {
    const dir = 'local/snapshots';
    const files = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.json')).map(async (f) => ({ file: path.join(dir, f), time: (await stat(path.join(dir, f))).mtimeMs })));
    files.sort((a, b) => b.time - a.time || a.file.localeCompare(b.file));
    snapshotPath = files[0]?.file;
    if (!snapshotPath) throw new Error('no local/snapshots/*.json snapshots found');
  }
  const snapshot = await read(snapshotPath);
  const freshness = snapshotFreshness(snapshot.asOf, freshnessOptions);
  const [ids, priors, schedule, roles] = await Promise.all([
    ...['data/ids.json', 'data/priors/players.json', 'data/schedule-2026-27.json'].map(read), readRoles(),
  ]);
  const { logs, coverage } = await loadProjectionLogs(schedule.season ?? '2026-27', { asOf: snapshot.asOf,
    from: schedule.games.map((g) => g.date).sort()[0] });
  const projections = projectPlayers(priors, ids, logs, { asOf: coverage.checkedAt });
  const from = fromDate ?? tomorrow(snapshot.asOf), end = toDate ?? snapshot.matchup.end;
  const volumeStatus = {}, bankedThrough = [addDays(from, -1), snapshot.matchup.end].sort()[0];
  if (bankedThrough >= snapshot.matchup.start) {
    snapshot.matchup.volume ??= {};
    const slots = snapshot.settings.rosterPositions.filter((p) => !['BN', 'IL', 'IL+'].includes(p.slot))
      .reduce((sum, p) => sum + p.count, 0);
    for (const [side, players] of [['mine', snapshot.team.roster], ['opponent', snapshot.matchup.opponentRoster]]) {
      if (['fgm', 'fga', 'ftm', 'fta'].every((k) => Number.isFinite(snapshot.matchup.volume[side]?.[k]))) {
        volumeStatus[side] = { status: 'reported' };
        continue;
      }
      const roster = players.map((p) => ({ ...p, espnId: findPlayer(ids.players, p.name, p.nbaTeam).player?.espnId }));
      const result = estimateVolume({ roster, totals: snapshot.matchup.totals?.[side], logs,
        from: snapshot.matchup.start, to: bankedThrough, slots });
      volumeStatus[side] = result;
      if (result.status === 'matched') snapshot.matchup.volume[side] = Object.fromEntries(
        ['fgm', 'fga', 'ftm', 'fta'].map((k) => [k, result[k]]));
    }
  }
  const advice = advise(snapshot, { ids, priors, schedule, roles, projections, fromDate: from, volumeStatus });
  const report = planStreamChains({ snapshot, schedule, projections, advice, ids, slotPlayer: slot,
    fromDate: from, toDate: end, addsWeek });
  console.log(formatStreamPlan({ ...report, freshness }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
