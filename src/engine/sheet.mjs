// The facts sheet: the numbers the league playbook's decision steps 1 to 7 lean on. Numbers only:
// no recommendation, no value ranking, no category labels. Pure: parsed pages and logs in, markdown out.
import { addDays, isoDay } from './weeks.mjs';
import { assignLineup, openRosterSpots } from './needs.mjs';
import { findPlayer } from './names.mjs';
import { estimateVolume } from './shooting-volume.mjs';
import { roleChangeReport } from './role-change.mjs';

export const SHEET_VERSION = 1;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IL_SLOTS = ['IL', 'IL+'];
const BENCH_SLOTS = ['BN', 'IL', 'IL+', 'NA'];
// Out: contributes nothing. Doubtful: also left out of the cautious figure.
export const OUT = ['O', 'INJ', 'SUSP', 'NA'];
export const DOUBTFUL = ['Q', 'GTD', 'DTD', 'D', 'P'];
const IL_OK = ['O', 'INJ', 'NA'];
const COUNTING = { PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', '3PM': 'fg3m', TO: 'to' };
const ORDER = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO'];
const SHOOTING = { 'FG%': ['fgm', 'fga'], 'FT%': ['ftm', 'fta'] };
const LINE_KEYS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'fgm', 'fga', 'ftm', 'fta', 'to'];

export const weekday = (date) => DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const dayLabel = (date) => `${weekday(date)} ${date.slice(5)}`;
const isIL = (slot) => IL_SLOTS.includes(slot);
const one = (n) => (n == null ? 'unknown' : Number.isInteger(n) ? String(n) : n.toFixed(1));
const dec = (n) => (n == null ? 'unknown' : n.toFixed(1));
const pct = (made, att) => (made == null || att == null ? 'unknown' : att ? (made / att).toFixed(3) : 'no attempts');
const shot = (made, att, f = dec) => (made == null || att == null ? 'unknown' : `${pct(made, att)} (${f(made)}/${f(att)})`);
const signed = (n, digits = 1) => (n == null ? 'unknown' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}`);
const unavailable = (file, reason) => `UNAVAILABLE: ${file} (${reason})`;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
const dateList = (dates) => (dates.length ? dates.map(dayLabel).join(', ') : 'none');

// "Nov 9, 1:26 am" or "Nov 17" to YYYY-MM-DD, with the year taken from the capture date.
export function monthDayIso(text, captureDate) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2})\b/.exec(text ?? '');
  const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
  return month ? isoDay(`${month}/${m[2]}`, `${captureDate}T12:00:00Z`) : null;
}

// Played games (minutes > 0) up to the capture date, oldest first, by ESPN id.
export function indexLogs(logs, captureDate) {
  const byId = new Map();
  for (const r of logs) {
    if (r.didNotPlay || !(r.min > 0) || r.date > captureDate) continue;
    const id = String(r.espnId);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(r);
  }
  for (const rows of byId.values()) rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.espnEventId).localeCompare(String(b.espnEventId)));
  return byId;
}

export function lastLine(rows, n = 5) {
  const last = rows.slice(-n);
  if (!last.length) return null;
  return { games: last.length, ...Object.fromEntries(LINE_KEYS.map((k) => [k, last.reduce((s, r) => s + (r[k] ?? 0), 0) / last.length])) };
}

function makeContext({ ids, logs, schedule, captureDate }) {
  const byId = indexLogs(logs, captureDate);
  const teamsByDate = new Map();
  for (const g of schedule.games) {
    if (!teamsByDate.has(g.date)) teamsByDate.set(g.date, new Set());
    teamsByDate.get(g.date).add(g.home).add(g.away);
  }
  const enrich = (p) => {
    const id = findPlayer(ids.players, p.name, p.nbaTeam).player?.espnId;
    const rows = id == null ? [] : byId.get(String(id)) ?? [];
    return { ...p, espnId: id == null ? null : String(id), line: lastLine(rows),
      seasonMpg: rows.length ? rows.reduce((s, r) => s + r.min, 0) / rows.length : null };
  };
  return { enrich, teamsByDate };
}

// One day's lineup by the existing slot assignment. Recent minutes set the order; no log counts as 24.
function starters(players, slots, teams, out) {
  const eligible = players.filter((p) => !isIL(p.slot) && !out.includes(p.status) && teams?.has(p.nbaTeam));
  return assignLineup(eligible.map((p) => ({ ...p, prior: p.line ? { mpg: p.line.min } : undefined })), slots);
}

function projectSide(players, slots, days, teamsByDate, out) {
  const sum = Object.fromEntries(LINE_KEYS.map((k) => [k, 0]));
  let starts = 0;
  const noLog = [];
  for (const date of days) {
    for (const { player } of starters(players, slots, teamsByDate.get(date), out)) {
      starts++;
      if (!player.line) { noLog.push(`${player.name} ${date.slice(5)}`); continue; }
      for (const k of LINE_KEYS) sum[k] += player.line[k];
    }
  }
  return { sum, starts, noLog };
}

const lineCells = (p) => {
  if (!p.line) return ['no log', '', '', '', '', '', '', '', '', '', ''];
  const l = p.line;
  return [l.min.toFixed(1), l.pts.toFixed(1), l.reb.toFixed(1), l.ast.toFixed(1), l.stl.toFixed(1), l.blk.toFixed(1), l.fg3m.toFixed(1),
    `${l.fgm.toFixed(1)}/${l.fga.toFixed(1)}`, `${l.ftm.toFixed(1)}/${l.fta.toFixed(1)}`, l.to.toFixed(1), l.games < 5 ? String(l.games) : ''];
};
const LINE_HEAD = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FGM/FGA', 'FTM/FTA', 'TO', 'G if <5'];
const mpg = (p) => (p.seasonMpg == null ? 'no log' : p.seasonMpg.toFixed(1));

export function buildSheet({ folder, captureDate, captureTime, pages, ids, schedule, logs, coverage = null, scoreboard = null, warnings = [] }) {
  const ctx = makeContext({ ids, logs, schedule, captureDate });
  const claimDate = addDays(captureDate, 1);
  const monday = addDays(claimDate, -((new Date(`${claimDate}T00:00:00Z`).getUTCDay() + 6) % 7));
  const sunday = addDays(monday, 6);
  const days = [];
  for (let d = claimDate; d <= sunday; d = addDays(d, 1)) days.push(d);
  // A Sunday-night claim processes Monday: the processing week is after the matchup page's week.
  const later = weekday(captureDate) === 'Sun';
  const asOf = `${captureDate}T12:00:00Z`;

  const P = pages;
  const settings = P.settings.ok ? P.settings.value : null;
  const team = P.team.ok ? P.team.value : null;
  const matchup = P.matchup.ok ? P.matchup.value : null;
  const matchupStart = matchup ? isoDay(matchup.days[0], asOf) : null;
  const matchupEnd = matchup ? isoDay(matchup.days.at(-1), asOf) : null;
  const week = matchup ? matchup.week + (later ? 1 : 0) : null;
  const slots = settings?.rosterPositions.filter((p) => !BENCH_SLOTS.includes(p.slot)) ?? null;

  // A header-only team page (Chrome) leaves the roster to team-tree.txt.
  const tree = P['team-tree']?.ok ? P['team-tree'].value : null;
  const rosterSource = team ? 'team.txt' : tree ? 'team-tree.txt' : matchup ? 'matchup.txt' : null;
  const rosterMissing = [unavailable('team.txt', P.team.reason ?? ''), ...(P['team-tree'] ? [unavailable('team-tree.txt', P['team-tree'].reason)] : []),
    unavailable('matchup.txt', P.matchup.reason ?? '')].join('; ');
  const tonyName = team?.name ?? tree?.name ?? matchup?.teamName ?? null;
  const tony = (team?.roster ?? tree?.roster ?? matchup?.roster ?? null)?.map(ctx.enrich) ?? null;

  // The opponent for the processing week.
  let opp = null, oppMissing = null;
  if (!later) {
    if (matchup) opp = { name: matchup.opponentName, roster: matchup.opponentRoster.map(ctx.enrich), source: 'matchup.txt' };
    else oppMissing = unavailable('matchup.txt', P.matchup.reason);
  } else if (!P['matchup-next'].ok) oppMissing = unavailable('matchup-next.txt', P['matchup-next'].reason);
  else if (week != null && P['matchup-next'].value.week !== week) oppMissing = unavailable('matchup-next.txt', `week ${P['matchup-next'].value.week}, expected week ${week}`);
  else {
    const n = P['matchup-next'].value;
    opp = { name: n.opponentName, roster: n.opponentRoster.map(ctx.enrich), source: 'matchup-next.txt' };
  }

  const status = [];
  const out = [];
  const section = (title, lines) => {
    out.push(`## ${title}`, '', ...lines, '');
    status.push(`${title}: ${lines.some((l) => l.includes('UNAVAILABLE')) ? (lines.every((l) => !l || l.startsWith('UNAVAILABLE')) ? 'UNAVAILABLE' : 'partial') : 'ok'}`);
  };

  // 1. Header
  {
    const L = [];
    L.push(`- Sheet version: ${SHEET_VERSION}`);
    L.push(`- Capture as of: ${captureDate} ${captureTime} (${weekday(captureDate)}), folder ${folder}`);
    if (coverage?.through) {
      L.push(`- Game-log coverage: through ${coverage.through} (checked ${coverage.checkedAt}); logs used through ${[coverage.through, captureDate].sort()[0]}`);
    } else L.push('- Game-log coverage: unknown (no _coverage.json)');
    for (const w of warnings) L.push(`- WARNING: ${w}`);
    L.push(`- Games on ${captureDate}: ${scoreboard ? `${scoreboard.final} final, ${scoreboard.notFinal} not final` : 'unknown (no scoreboard)'}`);
    L.push(`- First date a claim placed tonight can play: ${claimDate} (${weekday(claimDate)})`);
    const weekText = week != null ? `week ${week}` : `week number unknown (${unavailable('matchup.txt', P.matchup.reason)})`;
    L.push(`- Processing week: ${weekText}, ${monday} to ${sunday}${later ? ' (the week after the matchup page\'s week)' : ''}`);
    if (matchup && !later && matchupStart !== monday) L.push(`- WARNING: the matchup page's week runs ${matchupStart} to ${matchupEnd}, not ${monday} to ${sunday}`);
    L.push(`- Remaining days: ${days.length ? `${claimDate} to ${sunday} (${days.length})` : 'none'}`);
    section('1. Header', L);
  }

  // 2. Budget and slots
  {
    const L = [];
    if (!settings) L.push(unavailable('settings.txt', P.settings.reason));
    const max = settings?.maxAddsPerWeek;
    const maxText = max == null ? (settings ? 'no maximum' : 'unknown') : String(max);
    if (later) {
      L.push(`- Adds used in week ${week ?? '?'} (${monday} to ${sunday}): 0 of ${maxText}; adds left: ${max == null ? maxText : max}`);
    } else if (team) {
      L.push(`- Adds used this week (team page): ${team.addsUsedThisWeek} of ${maxText}; adds left: ${max == null ? maxText : max - team.addsUsedThisWeek}`);
    } else if (P.transactions.ok && tonyName) {
      const tx = P.transactions.value;
      const mine = tx.filter((t) => t.team === tonyName && t.moves.some((m) => m.type === 'add'))
        .map((t) => monthDayIso(t.time, captureDate)).filter((d) => d >= monday && d <= sunday);
      const oldest = tx.map((t) => monthDayIso(t.time, captureDate)).sort()[0];
      const minimum = tx.length > 0 && oldest >= monday;
      const used = mine.length;
      L.push(`- Adds used this week (counted on transactions.txt, ${monday} on): ${used}${minimum ? ' minimum (the page does not reach back to ' + monday + ')' : ''} of ${maxText}; adds left: ${max == null ? maxText : `${max - used}${minimum ? ' at most, not confirmed' : ''}`}`);
    } else {
      L.push(`- Adds used this week: ${unavailable('team.txt', P.team.reason)}; ${unavailable('transactions.txt', P.transactions.reason)}`);
    }
    L.push(team ? `- FAAB left: $${team.faabBalance}` : `- FAAB left: ${unavailable('team.txt', P.team.reason)}`);
    if (tony && settings) {
      const ilSlots = settings.rosterPositions.filter((p) => isIL(p.slot)).reduce((n, p) => n + p.count, 0);
      const inIL = tony.filter((p) => isIL(p.slot));
      L.push(`- Roster source: ${rosterSource}`);
      L.push(`- Open roster spots (non-IL): ${openRosterSpots(settings, tony)}`);
      L.push(`- Open IL slots: ${ilSlots - inIL.length} of ${ilSlots}`);
      const bad = inIL.filter((p) => !IL_OK.includes(p.status));
      L.push(`- IL check (in an IL slot with status other than O, INJ or NA): ${bad.length ? bad.map((p) => `${p.name} (${p.slot}, status ${p.status ?? 'none'})`).join('; ') : 'none'}`);
    } else if (!tony) L.push(`- Roster spots, IL slots, IL check: ${rosterMissing}`);
    section('2. Budget and slots', L);
  }

  // 3. Matchup by category
  {
    const L = [];
    if (!settings) L.push(unavailable('settings.txt', P.settings.reason));
    if (!tony) L.push(rosterMissing);
    if (!later && !matchup) L.push(unavailable('matchup.txt', P.matchup.reason));
    if (oppMissing) L.push(`Opponent: ${oppMissing}`);
    if (settings && tony && (later || matchup)) {
      const banked = { mine: null, opponent: null };
      const volumeNote = [];
      if (later) {
        const zero = { ...Object.fromEntries(Object.values(COUNTING).map((k) => [k, 0])), fgm: 0, fga: 0, ftm: 0, fta: 0 };
        banked.mine = { ...zero }; banked.opponent = opp ? { ...zero } : null;
        volumeNote.push('Banked totals are zero: no game of the processing week has been played.');
      } else {
        const t = P['matchup-totals'];
        const same = t.ok && t.value.week === matchup.week && t.value.teamName === matchup.teamName && t.value.opponentName === matchup.opponentName;
        for (const side of ['mine', 'opponent']) {
          const totals = matchup.totals[side];
          // Yahoo shows "-" in every cell until the week's first game: banked totals are zero then.
          const noStats = ORDER.every((c) => totals[c] == null);
          const b = Object.fromEntries(Object.entries(COUNTING).map(([c, k]) => [k, noStats ? 0 : totals[c]]));
          const known = (v) => v && ['fgm', 'fga', 'ftm', 'fta'].every((k) => Number.isFinite(v[k]));
          let vol = null, how = null;
          if (noStats) { vol = { fgm: 0, fga: 0, ftm: 0, fta: 0 }; how = 'zero (the page shows no stats yet this week)'; }
          else if (same && known(t.value.volume[side])) { vol = t.value.volume[side]; how = 'matchup-totals.txt'; }
          else if (known(matchup.volume[side])) { vol = matchup.volume[side]; how = 'matchup.txt'; }
          else {
            const roster = side === 'mine' ? tony : opp.roster;
            const active = slots.reduce((n, s) => n + s.count, 0);
            for (const to of [captureDate, addDays(captureDate, -1)].filter((d) => d >= matchupStart)) {
              const r = estimateVolume({ roster, totals, logs, from: matchupStart, to, slots: active });
              if (r.status === 'matched') { vol = r; how = `estimated from box scores ${matchupStart} to ${to} (the only lineup combination that matches the counting totals)`; break; }
              how = `unknown (${r.reason})`;
            }
          }
          volumeNote.push(`${side === 'mine' ? 'Tony' : 'Opponent'} banked makes and attempts: ${vol ? how : how ?? 'unknown'}${!t.ok && side === 'mine' ? `; matchup-totals.txt: ${t.reason}` : ''}`);
          for (const k of ['fgm', 'fga', 'ftm', 'fta']) b[k] = vol ? vol[k] : null;
          banked[side] = b;
        }
      }
      for (const [label, outList] of [['Projection (players listed O, INJ, SUSP or NA contribute nothing)', OUT], ['Cautious (also leaves out Q, GTD, DTD, D and P)', [...OUT, ...DOUBTFUL]]]) {
        const mine = projectSide(tony, slots, days, ctx.teamsByDate, outList);
        const theirs = opp ? projectSide(opp.roster, slots, days, ctx.teamsByDate, outList) : null;
        const final = (b, r, k) => (b?.[k] == null ? null : b[k] + r.sum[k]);
        const rows = ORDER.map((c) => {
          if (SHOOTING[c]) {
            const [m, a] = SHOOTING[c];
            const cell = (b, r) => [shot(b?.[m], b?.[a], one), shot(r.sum[m], r.sum[a]), shot(final(b, r, m), final(b, r, a))];
            const mineCells = cell(banked.mine, mine);
            const theirCells = theirs ? cell(banked.opponent, theirs) : ['unavailable', 'unavailable', 'unavailable'];
            const fm = final(banked.mine, mine, m), fa = final(banked.mine, mine, a);
            const om = theirs ? final(banked.opponent, theirs, m) : null, oa = theirs ? final(banked.opponent, theirs, a) : null;
            const gap = fm == null || om == null || !fa || !oa ? (theirs ? 'unknown' : 'unavailable') : signed(fm / fa - om / oa, 3);
            return [c, ...mineCells, ...theirCells, gap];
          }
          const k = COUNTING[c];
          const mf = final(banked.mine, mine, k), of = theirs ? final(banked.opponent, theirs, k) : null;
          return [c, one(banked.mine?.[k]), dec(mine.sum[k]), dec(mf),
            ...(theirs ? [one(banked.opponent?.[k]), dec(theirs.sum[k]), dec(of)] : ['unavailable', 'unavailable', 'unavailable']),
            theirs ? (mf == null || of == null ? 'unknown' : signed(mf - of)) : 'unavailable'];
        });
        L.push(`### ${label}`, '');
        L.push(...table(['Cat', 'Tony banked', 'Tony remaining', 'Tony final', 'Opp banked', 'Opp remaining', 'Opp final', 'Gap (Tony - Opp)'], rows));
        L.push('');
        const starts = (name, r) => `${name}: ${r.starts} starts${r.noLog.length ? `, ${r.noLog.length} by players with no log, not counted (${r.noLog.join(', ')})` : ''}`;
        L.push(`- ${starts('Tony', mine)}`);
        if (theirs) L.push(`- ${starts(`Opponent (${opp.name}, roster from ${opp.source})`, theirs)}`);
        L.push('');
      }
      L.push('- TO: fewer wins, so a negative gap favors Tony.');
      L.push('- Remaining = each player\'s last-5 line for each remaining day he gets a lineup slot (lineup filled by recent minutes).');
      for (const n of volumeNote) L.push(`- ${n}`);
    }
    section('3. Matchup by category', L);
  }

  // Tony's lineup by remaining day: starters and open slots.
  const grid = tony && settings ? days.map((date) => {
    const teams = ctx.teamsByDate.get(date);
    const base = starters(tony, slots, teams, OUT);
    const cautious = starters(tony, slots, teams, [...OUT, ...DOUBTFUL]);
    const open = slots.flatMap((s) => Array(s.count - base.filter((b) => b.slot === s.slot).length).fill(s.slot));
    return { date, teams, base, cautious, open };
  }) : null;
  const total = slots?.reduce((n, s) => n + s.count, 0);

  // 4. Open-day grid
  {
    const L = [];
    if (!grid) L.push(...(settings ? [] : [unavailable('settings.txt', P.settings.reason)]), ...(tony ? [] : [rosterMissing]));
    else {
      L.push(...table(['Date', 'Tony\'s players with a game', 'Slots filled', 'Open slots', 'Open slots, cautious'], grid.map((g) => {
        const playing = tony.filter((p) => !isIL(p.slot) && g.teams?.has(p.nbaTeam)).map((p) => `${p.name}${p.status ? ` (${p.status})` : ''}`);
        return [dayLabel(g.date), playing.join(', ') || 'none', `${g.base.length} of ${total}`, g.open.join(', ') || 'none', String(total - g.cautious.length)];
      })));
      L.push('', '- Players in IL slots are left out. O, INJ, SUSP and NA players fill no slot; the cautious count also leaves Q, GTD, DTD, D and P players out.');
    }
    section('4. Open-day grid', L);
  }

  // 5. Roster lines
  {
    const L = [];
    const rosterTable = (list) => table(['Player', 'Slot', 'Status', 'Pos', ...LINE_HEAD, 'Season MPG', `Games ${claimDate.slice(5)} to ${sunday.slice(5)}`],
      list.map((p) => [p.name, p.slot ?? '', p.status ?? '', p.positions.join(','), ...lineCells(p), mpg(p), (() => {
        const dates = days.filter((d) => ctx.teamsByDate.get(d)?.has(p.nbaTeam));
        return `${dates.length}: ${dateList(dates)}`;
      })()]));
    L.push(`### Tony${tonyName ? ` (${tonyName})` : ''}`, '');
    if (tony) L.push(`Roster from ${rosterSource}.`, '', ...rosterTable(tony)); else L.push(rosterMissing);
    L.push('', `### Opponent${opp ? ` (${opp.name})` : ''}`, '');
    if (opp) L.push(`Roster from ${opp.source}.`, '', ...rosterTable(opp.roster)); else L.push(oppMissing);
    L.push('', '- Last-5 line: mean of the player\'s last 5 games with minutes > 0 through the capture date. Season MPG uses the same games.');
    section('5. Roster lines', L);
  }

  // 6. Candidates
  {
    const L = [];
    if (!P.fa.length) L.push(unavailable('fa-*.txt', 'missing'));
    if (!grid && P.fa.length) L.push(`Usable starts: ${settings ? rosterMissing : unavailable('settings.txt', P.settings.reason)}`);
    const seen = new Set();
    const rows = [];
    for (const page of P.fa) {
      if (!page.ok) { L.push(unavailable(page.file, page.reason)); continue; }
      for (const raw of page.value) {
        const key = `${raw.name}|${raw.nbaTeam}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = ctx.enrich({ ...raw, slot: 'BN' });
        const games = days.filter((d) => ctx.teamsByDate.get(d)?.has(p.nbaTeam));
        const waiver = raw.waiverClears ? monthDayIso(raw.waiverClears, captureDate) : null;
        let usable = 'unknown';
        if (grid) {
          const dates = grid.filter((g) => games.includes(g.date) && (!waiver || g.date >= waiver)
            && starters([...tony, p], slots, g.teams, OUT).length > g.base.length).map((g) => g.date);
          usable = `${dates.length}: ${dateList(dates)}`;
        }
        rows.push([page.file.replace('.txt', ''), p.name, p.nbaTeam, p.status ?? '', p.positions.join(','), raw.waiverClears ? `W (${raw.waiverClears})` : '',
          `${games.length}: ${dateList(games)}`, usable, p.line ? p.line.min.toFixed(1) : 'no log', mpg(p), ...lineCells(p).slice(1)]);
      }
    }
    if (rows.length) {
      L.push(...table(['Page', 'Player', 'Team', 'Status', 'Pos', 'Waiver', `Games ${claimDate.slice(5)} to ${sunday.slice(5)}`, 'Usable starts', 'L5 MIN', 'Season MPG',
        ...LINE_HEAD.slice(1)], rows));
      L.push('', '- Usable start: a game on a day when adding him to Tony\'s lineup (O, INJ, SUSP and NA left out) fills one more slot. A date before his waiver date does not count.');
    }
    section('6. Candidates', L);
  }

  // 7. Role-change watch list
  {
    const L = [];
    const badTeams = P.teams.filter((t) => !t.ok);
    if (!settings) L.push(unavailable('settings.txt', P.settings.reason));
    else if (!tony) L.push(rosterMissing);
    else if (badTeams.length) L.push(...badTeams.map((t) => unavailable(t.file, t.reason)));
    else {
      const teams = P.teams.filter((t) => t.value.name !== tonyName).map((t) => ({ teamNumber: t.teamNumber, roster: t.value.roster }));
      const snapshot = { asOf: `${captureDate}T23:59:00Z`, settings, team: { roster: tony }, matchup: { opponentRoster: matchup?.opponentRoster ?? [] },
        ...(teams.length ? { league: { teams } } : {}) };
      const capped = logs.filter((r) => r.date <= captureDate);
      const rc = roleChangeReport({ snapshot, ids, logs: capped, options: { limit: Infinity } });
      if (rc.status === 'skipped') L.push(`Skipped: ${rc.reason}`);
      else if (!rc.players.length) L.push(`Night of ${rc.date}: none`);
      else {
        const n = (v) => v.toFixed(1);
        L.push(`Night of ${rc.date}. Every player listed is on no team roster.`, '');
        L.push(...table(['Player', 'Team', 'Flags', 'MIN', 'Earlier MPG', 'Jump', 'Started (last games)', 'Earlier starts', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FGM/FGA', 'FTM/FTA', 'TO'],
          [...rc.players].sort((a, b) => b.jump - a.jump || Number(a.espnId) - Number(b.espnId)).map((p) => [p.name, p.team, p.flags.join(', '), n(p.minutes), n(p.earlierMpg), signed(p.jump, 1),
            `${p.recentStarts} of ${p.recentGames}`, String(p.earlierStarts), ...['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m'].map((k) => String(p.box[k])),
            `${p.box.fgm}/${p.box.fga}`, `${p.box.ftm}/${p.box.fta}`, String(p.box.to)])));
      }
    }
    section('7. Role-change watch list', L);
  }

  // 8. Transactions
  {
    const L = [];
    if (!P.transactions.ok) L.push(unavailable('transactions.txt', P.transactions.reason));
    else {
      const tx = P.transactions.value;
      if (!tonyName) L.push(`Tony's moves: ${rosterMissing}`);
      else {
        const mine = tx.filter((t) => t.team === tonyName).flatMap((t) => t.moves.map((m) => [monthDayIso(t.time, captureDate) ?? '', t.time, m.type, m.player, m.nbaTeam, m.faab == null ? '' : `$${m.faab}`]));
        L.push('### Tony\'s adds and drops', '');
        L.push(...(mine.length ? table(['Date', 'Time', 'Move', 'Player', 'Team', 'Bid'], mine) : ['none on the page']));
        L.push('');
      }
      const bids = tx.filter((t) => t.team !== tonyName).flatMap((t) => t.moves.filter((m) => m.type === 'add' && m.faab != null)
        .map((m) => [monthDayIso(t.time, captureDate) ?? '', t.time, `$${m.faab}`, m.player, m.nbaTeam, t.team]));
      L.push('### Other managers\' winning bids', '');
      L.push(...(bids.length ? table(['Date', 'Time', 'Bid', 'Player', 'Team', 'Manager team'], bids) : ['none on the page']));
      const oldest = tx.map((t) => monthDayIso(t.time, captureDate)).filter(Boolean).sort()[0];
      L.push('', `- The page lists ${tx.length} transactions${oldest ? `, oldest ${oldest}` : ''}.`);
    }
    section('8. Transactions', L);
  }

  return { markdown: [`# Facts sheet ${folder}`, '', ...out].join('\n').replace(/\n+$/, '\n'), status };
}
