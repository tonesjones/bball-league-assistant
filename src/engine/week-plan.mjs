import { normalizeName } from './names.mjs';
import { addDays, tomorrow } from './weeks.mjs';
import { gamesLeft } from './games-left.mjs';
import { BLOCKED, STAT, projectTeam, needs, strongLine, openRosterSpots } from './needs.mjs';
import { monthDay, pickupStart, normalizeRoles, matchPlayers, dropBlock, identity } from './advice-common.mjs';
import { minutesCase } from './projections.mjs';
import { seasonValues } from './season-value.mjs';
import { applyPreferences } from './preferences.mjs';

const EPSILON = 1e-9;
const INACTIVE = ['BN', 'IL', 'IL+'];
const gainKey = (gain) => Math.round(gain * 1e9);
const text = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const stepTuple = (s) => [s.start, String(identity(s.pickup)), s.drop ? String(identity(s.drop)) : ''];
const planKey = (steps) => steps.map((s) => stepTuple(s).join('|')).join(';');

// Best gain first; ties go to fewer steps, then to each step's (start, pickup, drop) in order.
function comparePlans(a, b) {
  const byGain = gainKey(b.gain) - gainKey(a.gain) || a.steps.length - b.steps.length;
  if (byGain) return byGain;
  for (let i = 0; i < a.steps.length; i++) {
    const [x, y] = [stepTuple(a.steps[i]), stepTuple(b.steps[i])];
    for (let j = 0; j < 3; j++) if (x[j] !== y[j]) return text(x[j], y[j]);
  }
  return 0;
}

function checkOptions(o) {
  for (const k of ['candidates', 'beam', 'dropsPerPickup']) {
    if (!(Number.isInteger(o[k]) || k === 'beam' && o[k] === Infinity) || o[k] < 1) throw new Error(`${k} must be a positive integer`);
  }
  if (!Number.isInteger(o.maxSteps) || o.maxSteps < 0) throw new Error('maxSteps must be a nonnegative integer');
  for (const k of ['dropBar', 'addBar', 'seasonMargin']) {
    if (!Number.isFinite(o[k]) || o[k] < 0) throw new Error(`${k} must be a nonnegative finite number`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.fromDate)) throw new Error('fromDate must be YYYY-MM-DD');
  if (o.fromDate < o.window.start) throw new Error(`fromDate ${o.fromDate} is before the matchup starts (${o.window.start})`);
}

// The week planner: the best sequence of pickups (each with its start date and drop) for the rest
// of this matchup, then one action: add now, wait for a later start, or hold. Pure and seeded by
// nothing: the same input gives the same output.
export function planWeek({ snapshot, schedule, projections, ids, roles = {}, protectedNames = [],
  preferences = null, volumeStatus = {}, options = {} }) {
  let preferenceNotes = [];
  if (preferences) ({ snapshot, notes: preferenceNotes } = applyPreferences(snapshot, preferences));
  const priors = projections.players;
  const window = { start: snapshot.matchup.start, end: snapshot.matchup.end };
  const fromDate = options.fromDate ?? tomorrow(snapshot.asOf);
  const { candidates: candidateLimit = 20, beam: beamWidth = 50, dropsPerPickup = 6, dropBar = 0.15, addBar = 0.05,
    protectRank = 120, seasonMargin = 0, poolSize = 150, phi } = options;

  // Budget, as advise() counts it. Pending claims are assumed to go through.
  const pendingClaims = (snapshot.team.pending?.waivers ?? []).map((w) => ({ ...w, date: monthDay(w.date, window, 'pending claim date') }));
  const claimed = new Set(pendingClaims.map((w) => normalizeName(w.add)));
  const pendingDrops = new Set(pendingClaims.filter((w) => w.drop).map((w) => normalizeName(w.drop)));
  const reservedAdds = pendingClaims.filter((w) => w.date <= window.end).length;
  const spotsBefore = openRosterSpots(snapshot.settings, snapshot.team.roster);
  const addOnlyClaims = pendingClaims.filter((w) => !w.drop).length;
  const addsBefore = Math.max(0, (snapshot.settings.maxAddsPerWeek ?? 4) - snapshot.team.addsUsedThisWeek);
  const openSpots = Math.max(0, spotsBefore - addOnlyClaims);
  const addsLeft = Math.max(0, addsBefore - reservedAdds);
  const maxSteps = Math.min(options.maxSteps ?? addsLeft, addsLeft);
  checkOptions({ candidates: candidateLimit, beam: beamWidth, dropsPerPickup, maxSteps: options.maxSteps ?? addsLeft,
    dropBar, addBar, seasonMargin, fromDate, window });

  // Banked shooting volume and counting totals that are unknown leave their categories out of every plan.
  const banked = fromDate > window.start;
  const shootingVolume = Object.fromEntries(['mine', 'opponent'].map((side) => [side,
    !banked ? { status: 'matched', reason: 'no banked days' }
      : !['fgm', 'fga', 'ftm', 'fta'].every((k) => Number.isFinite(snapshot.matchup.volume?.[side]?.[k]))
        ? { ...volumeStatus[side], status: 'unknown', reason: volumeStatus[side]?.reason ?? 'banked makes and attempts unavailable' }
        : volumeStatus[side] ?? { status: 'reported' }]));
  const unknownVolume = Object.entries(shootingVolume).filter(([, v]) => v.status === 'unknown');
  const unknownCounting = banked ? Object.keys(STAT).filter((c) =>
    ['mine', 'opponent'].some((side) => snapshot.matchup.totals?.[side]?.[c] === null)) : [];
  const scoring = { shootingKnown: !unknownVolume.length, unknownCategories: unknownCounting };

  const { match, unscored } = matchPlayers({ ids, priors, poolSize });
  const roster = match(snapshot.team.roster, 'roster');
  const opponentRoster = match(snapshot.matchup.opponentRoster, 'opponent');
  const freeAgents = match(snapshot.freeAgents, 'freeAgent');

  // projectTeam rebuilds a date map from the whole schedule on every call, so give it only the window.
  const days = [];
  for (let d = fromDate; d <= window.end; d = addDays(d, 1)) days.push(d);
  const windowSchedule = { ...schedule, games: schedule.games.filter((g) => g.date >= fromDate && g.date <= window.end) };
  const project = (players, side, swaps = null, fillLine = null, preferPickups = false) => projectTeam(players,
    snapshot.matchup.totals?.[side], snapshot.matchup.volume?.[side], snapshot.settings, windowSchedule, fromDate, window.end,
    swaps, fillLine, { preferPickups });
  let strong;
  const priorBacked = (p) => p.source !== 'season-only';
  const fill = () => (strong ??= strongLine(priors, { poolSize, poolFilter: priorBacked }));

  const opponent = project(opponentRoster, 'opponent');
  const opponentScenarios = [opponent, opponent.unknownGames ? project(opponentRoster, 'opponent', null, fill()) : opponent];
  const outlooks = (mineScenarios) => mineScenarios.flatMap((m) => opponentScenarios.map((o) => needs(m, o, phi, scoring)));

  // Scores plans for one version of Tony's roster. gain = worst of the four (his lineup x opponent) pairs.
  const makeScorer = (team) => {
    const lineups = (steps) => {
      if (!steps.length) {
        const zero = project(team, 'mine');
        return { zero, scenarios: [zero, zero.unknownGames ? project(team, 'mine', null, fill()) : zero] };
      }
      const pickups = new Set(steps.map((s) => String(identity(s.pickup))));
      const pickupStarts = (lineup) => lineup.started.filter((g) => pickups.has(String(identity(g)))).length;
      const automatic = project(team, 'mine', steps);
      const preferred = project(team, 'mine', steps, null, true);
      const prefer = pickupStarts(preferred) > pickupStarts(automatic);
      const zero = prefer ? preferred : automatic;
      return { zero, scenarios: [zero, zero.unknownGames ? project(team, 'mine', steps, fill(), prefer) : zero] };
    };
    const none = lineups([]);
    const baselines = outlooks(none.scenarios);
    const run = (steps) => {
      const { zero, scenarios } = lineups(steps);
      const results = outlooks(scenarios);
      const diffs = results.map((r, i) => r.expectedCategories - baselines[i].expectedCategories);
      return { gain: Math.min(...diffs), gainRange: [Math.min(...diffs), Math.max(...diffs)], results, after: zero };
    };
    const cache = new Map();
    const gainOf = (steps) => {
      const key = planKey(steps);
      if (!cache.has(key)) {
        const { gain, gainRange } = run(steps);
        cache.set(key, { gain, gainRange });
      }
      return cache.get(key);
    };
    return { none: none.zero, baseline: baselines[0], run, gainOf };
  };
  const scorer = makeScorer(roster);
  const { baseline } = scorer;
  const mine = scorer.none;

  // Guardrails.
  const roleNames = normalizeRoles(roles, protectedNames);
  const coreSet = new Set(roleNames.core.map(normalizeName)), streamSet = new Set(roleNames.stream.map(normalizeName));
  const isNormal = (p) => !coreSet.has(normalizeName(p.name)) && !streamSet.has(normalizeName(p.name));
  const seasonOnly = (p) => p?.prior?.source === 'season-only';
  const blockedByRule = { core: 0, ilCapacity: 0, lineupLock: 0, noPrior: 0, rank: 0, seasonValue: 0 };
  const guardrail = { blockedByRule,
    protectedByRank: roster.filter((p) => isNormal(p) && p.season && !seasonOnly(p) && p.season.rank <= protectRank)
      .map((p) => ({ name: p.name, ...p.season })).sort((a, b) => a.rank - b.rank),
    protectedNoPrior: roster.filter((p) => isNormal(p) && (!p.season || seasonOnly(p)))
      .map((p) => ({ name: p.name, nbaTeam: p.nbaTeam, reason: seasonOnly(p) ? 'season-only line, no prior' : p.unscoredReason })) };

  const describe = (p, from) => ({ name: p.name, nbaTeam: p.nbaTeam, status: p.status ?? null,
    espnId: p.espnId, games: gamesLeft(p, windowSchedule, from, window.end),
    minutes: p.minutes, rates: p.rates,
    seasonValue: p.season?.value ?? null, seasonRank: p.season?.rank ?? null });
  const publicStep = (s) => ({ pickup: describe(s.pickup, s.start), drop: s.drop && describe(s.drop, fromDate), start: s.start });

  // Candidates (step 5): eligible pickups and the date an add made now can first count.
  const effectiveStarts = new Map();
  const effectiveStart = (p) => effectiveStarts.get(String(identity(p)));
  const eligible = [];
  for (const p of freeAgents) {
    if (!p.prior || BLOCKED.includes(p.status) || claimed.has(normalizeName(p.name))) continue;
    const start = pickupStart(p, fromDate, window, fromDate);
    if (start > window.end) continue;
    effectiveStarts.set(String(identity(p)), start);
    eligible.push(p);
  }
  const isNow = (s) => s.start === effectiveStart(s.pickup);

  // Drop options (step 6). Roster drops depend only on (pickup, start), so remember them.
  const droppable = roster.filter((p) => !pendingDrops.has(normalizeName(p.name)));
  const dropGroups = new Map();
  const rosterDrops = (pickup, start) => {
    const key = `${identity(pickup)}|${start}`;
    if (!dropGroups.has(key)) {
      const groups = { blocked: [], stream: [], normal: [] };
      for (const drop of droppable) {
        const rule = dropBlock(drop, pickup, start, { coreSet, streamSet, openSpots: 0, protectRank, seasonMargin });
        if (rule) groups.blocked.push(rule);
        else groups[streamSet.has(normalizeName(drop.name)) ? 'stream' : 'normal'].push(drop);
      }
      const byId = (a, b) => text(String(identity(a)), String(identity(b)));
      groups.stream.sort(byId);
      groups.normal.sort((a, b) => a.season.value - b.season.value || byId(a, b));
      dropGroups.set(key, groups);
    }
    return dropGroups.get(key);
  };
  const dropOptions = (steps, pickup, start) => {
    if (openSpots - steps.filter((s) => !s.drop).length > 0) return [null];
    const dropped = new Set(steps.filter((s) => s.drop).map((s) => String(identity(s.drop))));
    const { stream, normal } = rosterDrops(pickup, start);
    const planPickups = steps.map((s) => s.pickup);
    const earlier = planPickups.filter((d) => !dropBlock(d, pickup, start,
      { coreSet, streamSet, openSpots: 0, protectRank, seasonMargin, planPickups }));
    return [...earlier, ...stream, ...normal]
      .filter((d) => !dropped.has(String(identity(d)))).slice(0, dropsPerPickup);
  };

  const scored = (steps) => ({ steps, key: planKey(steps), ...scorer.gainOf(steps) });
  const barOf = (plan) => (plan.steps.some((s) => s.drop && rosterIds.has(String(identity(s.drop)))) ? dropBar : addBar);
  const rosterIds = new Set(roster.map((p) => String(identity(p))));
  const clears = (plan) => plan.steps.length > 0 && plan.gain >= barOf(plan) - EPSILON;

  const empty = scored([]);
  let oneSteps = [], beam = [empty];
  if (maxSteps > 0) {
    // Step 5: each candidate's best one-step plan at his effective start.
    for (const pickup of eligible) {
      const start = effectiveStart(pickup);
      if (openSpots <= 0) for (const rule of rosterDrops(pickup, start).blocked) blockedByRule[rule]++;
      const plans = dropOptions([], pickup, start).map((drop) => scored([{ pickup, drop, start }]));
      if (plans.length) oneSteps.push(plans.sort(comparePlans)[0]);
    }
    oneSteps.sort((a, b) => gainKey(b.gain) - gainKey(a.gain)
      || text(String(identity(a.steps[0].pickup)), String(identity(b.steps[0].pickup))));
    const shortlist = oneSteps.slice(0, candidateLimit).map((p) => p.steps[0].pickup);

    // Step 8: beam search over days.
    for (const date of days) {
      const children = [];
      for (const plan of beam) {
        if (plan.steps.length >= maxSteps) continue;
        for (const pickup of shortlist) {
          if (effectiveStart(pickup) > date || plan.steps.some((s) => identity(s.pickup) === identity(pickup))) continue;
          for (const drop of dropOptions(plan.steps, pickup, date)) {
            children.push(scored([...plan.steps, { pickup, drop, start: date }]));
          }
        }
      }
      beam = [...beam, ...children].sort(comparePlans).slice(0, beamWidth);
    }
  }

  // Step 9: the action.
  const best = beam[0];
  const todayBest = beam.find((p) => p.steps.length && isNow(p.steps[0])) ?? oneSteps[0] ?? null;
  let action = 'hold', drivingPlan = best, proposed = null;
  if (clears(best)) {
    if (isNow(best.steps[0])) [action, drivingPlan, proposed] = ['add', best, best.steps[0]];
    else if (todayBest && clears(todayBest) && best.gain - todayBest.gain < barOf(best) - EPSILON) {
      [action, drivingPlan, proposed] = ['add', todayBest, todayBest.steps[0]];
    } else [action, drivingPlan, proposed] = ['wait', best, best.steps[0]];
  }

  // Step 10: the cautious case. The pickup takes his lowest-value case and the drop his highest.
  const valueOf = (prior, line) => seasonValues(priors.map((x) => (x === prior ? line : x)), { poolSize, poolFilter: priorBacked }).get(prior.name)?.value;
  const extremeCase = (prior, better) => {
    if (!prior?.original || !prior.perGame) return prior;
    let chosen = null;
    for (const minutes of ['prior', 'season']) for (const rate of ['prior', 'season']) {
      const line = minutesCase(prior, minutes, rate), value = valueOf(prior, line);
      if (!chosen || better(value, chosen.value)) chosen = { line, value };
    }
    return chosen.line;
  };
  const zeroLine = (prior) => ({ ...prior, perGame: Object.fromEntries(Object.entries(prior.perGame).map(([k, v]) => [k, k === 'g' ? v : 0])) });
  const cautiousGain = (plan, { pickupCase, dropCase }) => {
    const first = plan.steps[0];
    const pickup = pickupCase ? { ...first.pickup, prior: pickupCase } : first.pickup;
    const drop = dropCase && first.drop ? { ...first.drop, prior: dropCase } : first.drop;
    const team = drop === first.drop ? roster : roster.map((p) => (identity(p) === identity(first.drop) ? drop : p));
    return makeScorer(team).run([{ ...first, pickup, drop }, ...plan.steps.slice(1)]).gain;
  };
  const dependsOn = [];
  let cautiousAction = action;
  if (action === 'add') {
    const first = proposed;
    const onlyPickup = seasonOnly(first.pickup);
    const cases = { pickupCase: onlyPickup ? zeroLine(first.pickup.prior) : extremeCase(first.pickup.prior, (v, c) => v < c),
      dropCase: first.drop ? extremeCase(first.drop.prior, (v, c) => v > c) : null };
    const fails = (gain) => gain < barOf(drivingPlan) - EPSILON;
    if (fails(cautiousGain(drivingPlan, cases))) cautiousAction = 'hold';
    const flipped = cautiousAction !== action;
    // Name the player whose line flips the call; if only both together do, name both.
    const pickupFlips = flipped && fails(cautiousGain(drivingPlan, { pickupCase: cases.pickupCase }));
    const dropFlips = flipped && Boolean(first.drop) && fails(cautiousGain(drivingPlan, { dropCase: cases.dropCase }));
    const both = flipped && !pickupFlips && !dropFlips;
    const entry = (p, from) => ({ player: describe(p, from), games: p.prior?.minutes?.games ?? 0,
      seasonMpg: p.prior?.minutes?.season ?? null,
      priorMpg: seasonOnly(p) ? null : p.prior?.minutes?.prior ?? p.prior?.mpg ?? null, cautiousAction });
    if (onlyPickup || pickupFlips || both) dependsOn.push(entry(first.pickup, first.start));
    if (dropFlips || both && first.drop) dependsOn.push(entry(first.drop, fromDate));
  }

  // The one-step plan of the proposed step, for the category and starts-by-day detail.
  const shown = proposed ? [{ pickup: proposed.pickup, drop: proposed.drop, start: proposed.start }] : [];
  const detail = shown.length ? scorer.run(shown) : null;
  const afterLineup = detail?.after ?? mine, afterResult = detail?.results[0] ?? baseline;
  const categories = Object.fromEntries(Object.keys(baseline.categories).filter((c) => baseline.categories[c].label !== 'unknown')
    .map((c) => [c, { before: baseline.categories[c].pWin, after: afterResult.categories[c].pWin,
      change: afterResult.categories[c].pWin - baseline.categories[c].pWin,
      total: afterLineup.totals[c] - mine.totals[c] }]));
  const slotCount = snapshot.settings.rosterPositions.filter((p) => !INACTIVE.includes(p.slot)).reduce((n, p) => n + p.count, 0);
  const startsByDay = days.map((date) => {
    const before = mine.started.filter((g) => g.date === date), after = afterLineup.started.filter((g) => g.date === date);
    const step = shown[0];
    return { date, openSlots: Math.max(0, slotCount - before.length),
      pickupStarts: step ? after.filter((g) => String(identity(g)) === String(identity(step.pickup))).length : 0,
      displaced: before.filter((g) => !after.some((x) => x.name === g.name)
        && !(step?.drop && date >= step.start && g.name === step.drop.name)).map((g) => g.name) };
  });

  // Runners-up: the best plan behind each distinct first step, from the final beam and step 5.
  const byFirst = new Map();
  for (const plan of [...beam, ...oneSteps]) {
    if (!plan.steps.length) continue;
    const key = stepTuple(plan.steps[0]).join('|');
    if (!byFirst.has(key) || comparePlans(plan, byFirst.get(key)) < 0) byFirst.set(key, plan);
  }
  const proposedKey = proposed && stepTuple(proposed).join('|');
  const runnersUp = [...byFirst].filter(([key]) => key !== proposedKey).map(([, plan]) => plan).sort(comparePlans).slice(0, 3)
    .map((plan) => ({ step: publicStep(plan.steps[0]), gain: plan.gain,
      whyLost: !clears(plan) ? 'below-bar' : !isNow(plan.steps[0]) ? 'later-start' : 'lower-gain' }));

  // Unknowns: categories left out of every plan, and players whose starts have no projection.
  const unknowns = Object.entries(baseline.categories).filter(([, c]) => c.label === 'unknown').map(([category]) => ({
    category, reason: category === 'FG%' || category === 'FT%'
      ? unknownVolume.map(([side, v]) => `${side}: ${v.reason}`).join('; ') : 'banked counting total unknown for at least one team' }));
  const unknownStarts = new Map();
  for (const [side, players, lineups] of [['mine', roster, [mine, afterLineup]], ['opponent', opponentRoster, [opponent]]]) {
    for (const lineup of lineups) for (const g of lineup.unknownStarts) {
      const key = `${side}\0${g.name}`;
      if (!unknownStarts.has(key)) unknownStarts.set(key, { side, name: g.name, dates: new Set(), players });
      unknownStarts.get(key).dates.add(g.date);
    }
  }
  for (const { side, name, dates, players } of [...unknownStarts.values()].sort((a, b) => text(a.side + a.name, b.side + b.name))) {
    unknowns.push({ player: name, side, starts: dates.size, reason: players.find((p) => p.name === name)?.unscoredReason ?? 'no projection' });
  }

  const step = action === 'add' ? publicStep(proposed) : null;
  return { asOf: snapshot.asOf, week: snapshot.matchup.week, window, fromDate, addsFrom: fromDate,
    action, step,
    waitFor: action === 'wait' ? { pickup: describe(proposed.pickup, proposed.start), start: proposed.start } : null,
    plan: best.steps.map(publicStep),
    gain: drivingPlan.gain, gainRange: drivingPlan.gainRange, bar: barOf(drivingPlan),
    baseline: { categories: baseline.categories, expectedCategories: baseline.expectedCategories },
    categories, startsByDay, runnersUp, unknowns, dependsOn, guardrail, preferenceNotes,
    baselineLineups: { mine: mine.started, opponent: opponent.started },
    banked: Object.fromEntries(['mine', 'opponent'].map((side) => [side, {
      ...Object.fromEntries(Object.entries(STAT).map(([c, k]) => [k, !banked ? 0 : snapshot.matchup.totals?.[side]?.[c] ?? null])),
      ...Object.fromEntries(['fgm', 'fga', 'ftm', 'fta'].map((k) => [k,
        !banked ? 0 : scoring.shootingKnown ? snapshot.matchup.volume?.[side]?.[k] : null])),
    }])),
    addsLeft, openSpots, volumeStatus: shootingVolume, unscored,
    projection: { version: projections.version ?? null, k: projections.k ?? null, asOf: projections.asOf ?? null },
    options: { roles: roleNames, preferences, fromDate, addsFrom: fromDate, candidates: candidateLimit, beam: beamWidth,
      dropsPerPickup, maxSteps, dropBar, addBar, protectRank, seasonMargin, poolSize, phi: phi ?? null },
    decision: action === 'add'
      ? { action: 'move', pair: { pickup: step.pickup, drop: step.drop, pickupStart: step.start } }
      : { action: 'hold', pair: null } };
}
