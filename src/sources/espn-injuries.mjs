import { standardCode } from './espn.mjs';

const athleteId = (links) => {
  for (const link of links ?? []) {
    const m = /\/id\/(\d+)\//.exec(link?.href ?? '');
    if (m) return m[1];
  }
  return null;
};

// ESPN's injuries feed: { timestamp, injuries: [{ displayName, injuries: [{ status, date, shortComment,
// athlete: { displayName, links, team: { abbreviation } }, details: { returnDate } }] }] }.
// The ESPN athlete ID is only in the player-card link. returnDate is null when the feed gives none.
export function parseInjuries(json) {
  if (!Array.isArray(json?.injuries)) throw new Error('injuries feed has no injuries array');
  const entries = [];
  for (const team of json.injuries) {
    for (const item of team.injuries ?? []) {
      const athlete = item.athlete ?? {};
      if (!athlete.displayName) continue;
      entries.push({
        espnId: athleteId(athlete.links),
        name: athlete.displayName,
        team: athlete.team?.abbreviation ? standardCode(athlete.team.abbreviation) : null,
        status: item.status ?? null,
        date: item.date ?? null,
        returnDate: item.details?.returnDate ?? null,
        comment: String(item.shortComment ?? '').replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return { fetchedAt: json.timestamp ?? null, entries };
}

// A comment cut to about `max` characters, with "..." marking the cut.
export function trimComment(text, max = 160) {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}
