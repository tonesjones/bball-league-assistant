import { standardCode } from './espn.mjs';

export function parseTeams(json) {
  return (json.sports ?? []).flatMap((sport) => (sport.leagues ?? []).flatMap((league) =>
    (league.teams ?? []).map(({ team }) => ({ espnId: String(team.id), code: standardCode(team.abbreviation) }))));
}

function easternDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
}

export function parseSchedule(json) {
  const games = [];
  const skipped = [];
  for (const event of json.events ?? []) {
    const competitors = event.competitions?.[0]?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === 'home')?.team?.abbreviation;
    const away = competitors.find((c) => c.homeAway === 'away')?.team?.abbreviation;
    if (!home || !away || /TBD/i.test(home + away)) {
      skipped.push({ espnEventId: String(event.id), reason: 'missing or TBD opponent' });
      continue;
    }
    const { year, month, day } = easternDate(event.date);
    games.push({ espnEventId: String(event.id), date: `${year}-${month}-${day}`, home: standardCode(home), away: standardCode(away) });
  }
  return { games, skipped };
}

export function parseRoster(json, code = json.team?.abbreviation) {
  return (json.athletes ?? []).map((athlete) => ({
    espnId: String(athlete.id), name: athlete.fullName ?? athlete.displayName,
    team: standardCode(code), positions: athlete.position?.abbreviation ? [athlete.position.abbreviation] : [],
  }));
}
