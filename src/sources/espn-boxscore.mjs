export function parseScoreboard(json) {
  return (json.events ?? []).map((e) => ({ espnEventId: String(e.id), status: e.status?.type?.name }));
}

export function parseBoxScore(json, { date, standardCode }) {
  const eventId = String(json.header?.id ?? 'unknown');
  const out = [];
  for (const teamData of json.boxscore?.players ?? []) {
    const team = standardCode(teamData.team.abbreviation);
    for (const group of teamData.statistics ?? []) {
      const labels = group.labels ?? [];
      const positions = Object.fromEntries(labels.map((label, i) => [label, i]));
      for (const label of ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK']) {
        if (positions[label] === undefined) throw new Error(`event ${eventId}: missing label ${label}`);
      }
      const playing = (group.athletes ?? []).filter((p) => !p.didNotPlay);
      const teamMinutes = playing.every((p) => p.stats[positions.MIN] !== '' && Number.isFinite(Number(p.stats[positions.MIN])))
        ? playing.reduce((sum, p) => sum + Number(p.stats[positions.MIN]), 0) : null;
      const totalAttempts = (label) => {
        const match = /^(\d+)-(\d+)$/.exec(group.totals?.[positions[label]] ?? '');
        return match ? Number(match[2]) : null;
      };
      const teamFga = totalAttempts('FG'), teamFta = totalAttempts('FT');
      const teamToText = group.totals?.[positions.TO];
      const teamTo = /^\d+$/.test(teamToText ?? '') ? Number(teamToText) : null;
      const playerSum = (label, attempts = false) => playing.reduce((sum, p) => {
        const value = p.stats[positions[label]];
        return sum + (attempts ? Number(/^(\d+)-(\d+)$/.exec(value ?? '')?.[2] ?? NaN) : Number(value));
      }, 0);
      const allTeamTo = json.boxscore.teams?.find((t) => standardCode(t.team.abbreviation) === team)
        ?.statistics?.find((s) => s.name === 'totalTurnovers')?.displayValue;
      const teamContext = teamMinutes > 0 && teamFga != null && teamFta != null && teamTo != null
        && playerSum('FG', true) === teamFga && playerSum('FT', true) === teamFta && playerSum('TO') === teamTo
        ? { minutes: teamMinutes, fga: teamFga, fta: teamFta, to: /^\d+$/.test(allTeamTo ?? '') ? Number(allTeamTo) : teamTo } : null;
      for (const p of group.athletes ?? []) {
        const identity = { espnId: String(p.athlete.id), name: p.athlete.displayName, team, date, espnEventId: eventId,
          starter: p.starter ?? null, didNotPlay: p.didNotPlay ?? false, reason: p.reason ?? null, teamContext };
        if (p.didNotPlay) {
          out.push({ ...identity, min: p.reason === "COACH'S DECISION" ? 0 : null });
          continue;
        }
        const val = (label) => p.stats[positions[label]];
        const pair = (label) => {
          const m = /^(\d+)-(\d+)$/.exec(val(label) ?? '');
          if (!m) throw new Error(`event ${eventId}: invalid ${label} stat`);
          return [+m[1], +m[2]];
        };
        const [fgm, fga] = pair('FG'); const [ftm, fta] = pair('FT');
        const three = /^(\d+)-(\d+)$/.exec(val('3PT') ?? '');
        const fg3m = three ? +three[1] : Number(val('3PT'));
        if (!Number.isFinite(fg3m)) throw new Error(`event ${eventId}: invalid 3PT stat`);
        if (!Number.isFinite(Number(val('MIN'))) || Number(val('MIN')) < 0 || val('MIN') == null || val('MIN') === '') {
          throw new Error(`event ${eventId}: invalid minutes`);
        }
        out.push({ ...identity,
          min: Number(val('MIN')), fgm, fga, ftm, fta, fg3m, pts: Number(val('PTS')), reb: Number(val('REB')),
          ast: Number(val('AST')), stl: Number(val('STL')), blk: Number(val('BLK')), to: Number(val('TO')) });
      }
    }
  }
  return out;
}
