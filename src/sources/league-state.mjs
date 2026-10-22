// The league snapshot the engine reads. Built by yahoo-pages/index.mjs, checked by validate().
//
// {
//   asOf,                              ISO time of the refresh
//   settings: { scoringType, categories, rosterPositions: [{slot, count}], maxAddsPerWeek|null,
//               maxGamesPerWeek|null, waiverType, playoffs: {teams, weeks, endsOn}, raw },
//   team: { name, rank: integer|null, record: {wins, losses, ties}, faabBalance, addsUsedThisWeek, roster: [player] },
//   matchup: { week, start, end (YYYY-MM-DD), opponentName, totals: {mine, opponent}, volume: {mine, opponent},
//              score: {mine, opponent}, opponentRoster: [player] },
//   freeAgents: [{ rank, name, nbaTeam, positions, status, waiverClears|null }],
//   transactions: [{ team, time, moves: [{ player, nbaTeam, type: add|drop|trade, faab: number|null }] }]
// }
// player = { name, nbaTeam, positions: [], status|null, slot }

import { CATEGORIES } from './yahoo-pages/common.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validate(s) {
  const bad = [];
  const need = (ok, msg) => { if (!ok) bad.push(msg); };

  const players = (list, where) => {
    if (!Array.isArray(list) || !list.length) return need(false, `${where} is missing or empty`);
    list.forEach((p, i) => {
      const w = `${where}[${i}]`;
      if (!isObj(p)) return need(false, `${w} is not an object`);
      need(isStr(p.name), `${w}.name is missing`);
      need(isStr(p.nbaTeam), `${w}.nbaTeam is missing`);
      need(Array.isArray(p.positions) && p.positions.length > 0, `${w}.positions is empty`);
      need(p.status === null || isStr(p.status), `${w}.status must be a string or null`);
      need(isStr(p.slot), `${w}.slot is missing`);
    });
  };

  if (!isObj(s)) throw new Error('invalid snapshot:\n- not an object');
  need(isStr(s.asOf) && !Number.isNaN(Date.parse(s.asOf)), 'asOf must be an ISO timestamp');

  const st = s.settings;
  if (!isObj(st)) need(false, 'settings is missing');
  else {
    need(isStr(st.scoringType), 'settings.scoringType is missing');
    need(Array.isArray(st.categories) && st.categories.length > 0, 'settings.categories is empty');
    for (const c of st.categories ?? []) need(CATEGORIES.includes(c), `settings.categories has unknown "${c}"`);
    need(Array.isArray(st.rosterPositions) && st.rosterPositions.length > 0, 'settings.rosterPositions is empty');
    for (const p of st.rosterPositions ?? []) {
      need(isStr(p?.slot) && Number.isInteger(p.count) && p.count > 0, 'settings.rosterPositions has a bad entry');
    }
    need(st.maxAddsPerWeek === null || Number.isInteger(st.maxAddsPerWeek), 'settings.maxAddsPerWeek must be a number or null');
    need(st.maxGamesPerWeek === null || Number.isInteger(st.maxGamesPerWeek), 'settings.maxGamesPerWeek must be a number or null');
    need(isStr(st.waiverType), 'settings.waiverType is missing');
    need(isObj(st.playoffs) && Array.isArray(st.playoffs.weeks), 'settings.playoffs is missing');
    need(isObj(st.raw), 'settings.raw is missing');
  }

  const t = s.team;
  if (!isObj(t)) need(false, 'team is missing');
  else {
    need(isStr(t.name), 'team.name is missing');
    need(t.rank === undefined || t.rank === null || Number.isInteger(t.rank), 'team.rank must be an integer or null');
    need(isObj(t.record), 'team.record is missing');
    need(isNum(t.faabBalance), 'team.faabBalance must be a number');
    need(Number.isInteger(t.addsUsedThisWeek) && t.addsUsedThisWeek >= 0, 'team.addsUsedThisWeek must be a count');
    players(t.roster, 'team.roster');
  }

  const m = s.matchup;
  if (!isObj(m)) need(false, 'matchup is missing');
  else {
    need(Number.isInteger(m.week), 'matchup.week is missing');
    for (const k of ['start', 'end']) need(/^\d{4}-\d{2}-\d{2}$/.test(m[k] ?? ''), `matchup.${k} must be YYYY-MM-DD`);
    need(isStr(m.opponentName), 'matchup.opponentName is missing');
    for (const side of ['mine', 'opponent']) {
      const tot = m.totals?.[side];
      if (!isObj(tot)) need(false, `matchup.totals.${side} is missing`);
      else for (const c of CATEGORIES) need(tot[c] === null || isNum(tot[c]), `matchup.totals.${side}.${c} must be a number or null`);
    }
    players(m.opponentRoster, 'matchup.opponentRoster');
  }

  need(Array.isArray(s.freeAgents), 'freeAgents is missing');
  (s.freeAgents ?? []).forEach((p, i) => {
    need(Number.isInteger(p?.rank), `freeAgents[${i}].rank is missing`);
    need(isStr(p?.name) && isStr(p?.nbaTeam), `freeAgents[${i}] needs name and nbaTeam`);
  });
  need(Array.isArray(s.transactions), 'transactions is missing');
  (s.transactions ?? []).forEach((t, i) => {
    need(isObj(t) && isStr(t.team) && isStr(t.time) && Array.isArray(t.moves) && t.moves.length > 0, `transactions[${i}] has a bad shape`);
    for (const m of t.moves ?? []) need(isObj(m) && isStr(m.player) && isStr(m.nbaTeam) && ['add', 'drop', 'trade'].includes(m.type) && (m.faab === null || isNum(m.faab)), `transactions[${i}] has a bad move`);
  });

  if (bad.length) throw new Error(`invalid snapshot:\n- ${bad.join('\n- ')}`);
  return s;
}
