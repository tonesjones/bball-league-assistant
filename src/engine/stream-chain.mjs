import { assignLineup, BLOCKED } from './needs.mjs';
import { pickupStart, normalizeRoles } from './advice-common.mjs';
import { normalizeName, findPlayer } from './names.mjs';
import { seasonValues } from './season-value.mjs';
import { minutesCase } from './projections.mjs';
import { addDays } from './weeks.mjs';

const active = (p) => !BLOCKED.includes(p.status) && !['IL', 'IL+'].includes(p.slot);
const date = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') && Number.isFinite(Date.parse(d))
  && new Date(d).toISOString().slice(0, 10) === d;

export function planStreamChains({ snapshot, schedule, projections, advice, ids, slotPlayer,
  fromDate, toDate = snapshot.matchup.end, addsWeek = 'effective',
  protectRank = advice?.options?.protectRank ?? 120, addsLeft }) {
  if (!date(fromDate) || !date(toDate) || fromDate > toDate) throw new Error('invalid planning dates');
  if (!['effective', 'transaction'].includes(addsWeek)) throw new Error('invalid adds-week');
  // Week 0 is the snapshot's matchup, whatever its length; later weeks run 7 days from its end.
  const week = (d) => d <= snapshot.matchup.end ? 0 : 1 + Math.floor((Date.parse(d) - Date.parse(addDays(snapshot.matchup.end, 1))) / (7 * 86400000));
  const chargeDate = (d) => addsWeek === 'transaction' ? addDays(d, -1) : d;
  const firstWeek = week(chargeDate(fromDate)), maxAdds = snapshot.settings.maxAddsPerWeek;
  addsLeft ??= firstWeek === 0 ? Math.max(0, maxAdds - snapshot.team.addsUsedThisWeek) : maxAdds;
  if (snapshot.settings.maxGamesPerWeek != null) throw new Error('stream planner requires a league without a games cap');
  const roles = normalizeRoles(advice?.options?.roles);
  const stream = slotPlayer === 'empty' ? null : snapshot.team.roster.find((p) => normalizeName(p.name) === normalizeName(slotPlayer ?? ''));
  if (slotPlayer !== 'empty' && !stream) throw new Error(`stream slot player not found: ${slotPlayer}`);
  const has = (names, name) => names.some((n) => normalizeName(n) === normalizeName(name));
  if (stream && has(roles.core, stream.name)) throw new Error(`${stream.name} is a core player`);
  if (stream && !has(roles.stream, stream.name)) throw new Error(`${stream.name} must be marked stream`);
  const priors = projections?.players ?? [], valueOptions = { poolSize: advice?.options?.poolSize ?? 150 };
  const values = seasonValues(priors, valueOptions), byName = new Map(priors.map((p) => [p.name, p]));
  const projection = (p) => {
    const name = ids ? findPlayer(ids.players, p.name, p.nbaTeam).player?.priorName : p.name;
    return byName.get(name);
  };
  const other = snapshot.team.roster.filter((p) => p !== stream).map((p) => ({ ...p, prior: projection(p) }));
  const games = new Set(schedule.games.flatMap((g) => [`${g.date}/${g.home}`, `${g.date}/${g.away}`]));
  const dates = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) dates.push(d);
  const slots = snapshot.settings.rosterPositions;
  const daily = dates.map((d) => {
    const playing = other.filter((p) => active(p) && games.has(`${d}/${p.nbaTeam}`));
    const lineup = assignLineup(playing, slots), starters = lineup.map((x) => x.player);
    const openSlots = slots.filter((s) => !['BN', 'IL', 'IL+'].includes(s.slot)).flatMap((s) =>
      Array(s.count - lineup.filter((x) => x.slot === s.slot).length).fill(s.slot));
    return { date: d, playing, starters, openSlots, benched: playing.filter((p) => !starters.includes(p)) };
  });
  const starts = (p) => daily.map((d) => active(p) && games.has(`${d.date}/${p.nbaTeam}`)
    && assignLineup([...d.starters, p], slots, [], [p.name]).length === d.starters.length + 1);
  const available = snapshot.freeAgents.filter((p) => active(p) && p.nbaTeam && p.nbaTeam !== 'FA'
    && !snapshot.team.roster.some((r) => normalizeName(r.name) === normalizeName(p.name))
    && pickupStart(p, fromDate, snapshot.matchup, fromDate) <= toDate
    && (!Object.hasOwn(p, 'returnTimeline') || Boolean(p.returnTimeline)));
  const decisionPair = advice?.decision?.action === 'move' ? advice.decision.pair
    : ['insufficient', 'insufficient evidence'].includes(advice?.decision?.action) ? advice.decision.best : null;
  const holds = available.flatMap((p) => {
    const projected = projection(p), cases = [];
    if (projected?.perGame) for (const minutes of ['prior', 'season']) for (const rate of ['prior', 'season']) {
      const players = priors.map((x) => x === projected ? minutesCase(x, minutes, rate) : x);
      const value = seasonValues(players, valueOptions).get(projected.name);
      cases.push({ minutes, rate, ...value });
    }
    const pair = decisionPair?.pickup.name === p.name ? decisionPair : null;
    if (!pair && !cases.some((c) => c.rank <= protectRank)) return [];
    return [{ name: p.name, team: p.nbaTeam, evidence: pair ?? advice?.topPairs?.find((x) => x.pickup.name === p.name) ?? null,
      games: starts(p).filter(Boolean).length, minutes: projected?.minutes ?? null, rates: projected?.rates ?? null, cases,
      rank: Math.min(...cases.map((c) => c.rank)), recommended: Boolean(pair) }];
  }).sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.rank - b.rank || a.name.localeCompare(b.name));
  const reserved = holds.length ? 1 : 0, addsAvailable = Math.max(0, addsLeft - reserved);
  const pool = available.filter((p) => !holds.some((h) => h.name === p.name)).sort((a, b) => a.name.localeCompare(b.name));
  const players = [...(stream ? [stream] : []), ...pool];
  const playable = players.map(starts);
  const dayTable = daily.map((d) => ({ date: d.date, games: d.playing.map((p) => p.name),
    starters: d.starters.map((p) => p.name), benched: d.benched.map((p) => p.name), openSlots: d.openSlots }));
  const report = { asOf: snapshot.asOf, scheduleFetchedAt: schedule.fetchedAt,
    fromDate, toDate, addsWeek, holds, reservedAdds: reserved, addsLeft, addsAvailable, dayTable,
    noMoveGames: stream ? playable[0].filter(Boolean).length : 0, plans: [] };
  const slotHold = stream && holds.find((h) => h.evidence?.drop?.name === stream.name);
  if (slotHold) return { ...report, slotGoesTo: slotHold.name,
    reason: `The stream slot goes to ${slotHold.name}; the hold move drops ${stream.name}.` };
  const ready = (p, d) => pickupStart(p, fromDate, snapshot.matchup, fromDate) <= d;
  const better = (a, b) => a.totalGames - b.totalGames || a.projectedGames - b.projectedGames
    || a.seasonValue - b.seasonValue || b.names.localeCompare(a.names)
    || b.addsUsed - a.addsUsed || b.timing.localeCompare(a.timing);
  const empty = () => ({ links: [], totalGames: 0, projectedGames: 0, seasonValue: 0, addsUsed: 0, names: '', timing: '' });
  const meta = players.map((p) => ({ projected: Boolean(projection(p)?.perGame), value: values.get(projection(p)?.name)?.value ?? 0 }));
  // A chain has at most 5 links, so some player among a run's top 5 is always unused elsewhere in it
  // and starts at least as well; keeping only those keeps the search exact on a 500-player pool.
  const top = dates.map((_, day) => dates.map((_, end) => end < day ? [] : players.map((p, i) => ({ i,
    games: dates.slice(day, end + 1).filter((_, n) => playable[i][day + n]).length }))
    .filter((c) => c.games && players[c.i] !== stream && ready(players[c.i], dates[day]))
    .sort((a, b) => b.games - a.games || Number(meta[b.i].projected) - Number(meta[a.i].projected)
      || meta[b.i].value - meta[a.i].value || players[a.i].name.localeCompare(players[b.i].name))
    .slice(0, 5).map((c) => c.i)));
  const capacity = [...new Set(dates.map((d) => week(chargeDate(d))))].reduce((n, w) => n + (w === firstWeek ? addsAvailable : maxAdds), 0);
  for (const budget of [2, 3, 4]) {
    if (budget > capacity) { report.plans.push({ budget, status: 'not available' }); continue; }
    const memo = new Map();
    const search = (day, remaining, usedMask, counts) => {
      if (day >= dates.length) return empty();
      const key = `${day}/${remaining}/${usedMask}/${JSON.stringify(counts)}`;
      if (memo.has(key)) return memo.get(key);
      let best = empty();
      const w = week(chargeDate(dates[day])), addCounts = { ...counts, [w]: (counts[w] ?? 0) + 1 };
      const canAdd = remaining && addCounts[w] <= (w === firstWeek ? addsAvailable : maxAdds);
      for (let end = day; end < dates.length; end++) for (const i of [...(stream && usedMask === 0n ? [0] : []), ...(canAdd ? top[day][end] : [])]) {
        const p = players[i], bit = 1n << BigInt(i), current = p === stream;
        if (usedMask & bit) continue;
        const nextCounts = current ? counts : addCounts;
        const played = dates.slice(day, end + 1).filter((_, n) => playable[i][day + n]);
        if (!played.length) continue;
        const tail = search(end + 1, remaining - Number(!current), usedMask | bit, nextCounts);
        const { projected, value } = meta[i];
        const link = { player: p, team: p.nbaTeam, start: dates[day], end: dates[end], dates: played,
          daily: dates.slice(day, end + 1).map((d) => ({ date: d, startedGames: Number(played.includes(d)) })),
          startedGames: played.length, projected, unprojected: !projected, usesAdd: !current,
          addsWeek: current ? null : w, transactionDate: current ? null : addDays(dates[day], -1) };
        const result = { links: [link, ...tail.links], totalGames: played.length + tail.totalGames,
          projectedGames: (projected ? played.length : 0) + tail.projectedGames,
          seasonValue: value * played.length + tail.seasonValue, addsUsed: Number(!current) + tail.addsUsed,
          names: [p.name, tail.names].filter(Boolean).join('\0'), timing: `${dates[day]}/${dates[end]}/${tail.timing}` };
        if (better(result, best) > 0) best = result;
      }
      // Waiting before the first pickup must not force a useless add.
      const wait = usedMask === 0n ? search(day + 1, remaining, usedMask, counts) : empty();
      if (better(wait, best) > 0) best = wait;
      memo.set(key, best);
      return best;
    };
    const best = search(0, budget, 0n, {});
    const dropped = new Set(stream ? [stream.name] : []);
    for (const link of best.links) {
      link.alternatives = pool.filter((p) => p.name !== link.player.name && !dropped.has(p.name) && ready(p, link.start)
        && JSON.stringify(dates.filter((d, n) => d >= link.start && d <= link.end && starts(p)[n])) === JSON.stringify(link.dates))
        .slice(0, 3).map((p) => ({ name: p.name, team: p.nbaTeam, unprojected: !projection(p)?.perGame }));
      dropped.add(link.player.name);
    }
    report.plans.push({ budget, status: 'planned', ...best });
  }
  return report;
}

