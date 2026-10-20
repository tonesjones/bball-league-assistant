export function gamesPerWeek(games, weeks) {
  const result = {};
  for (const [team, counts] of Object.entries(weeks.teams)) result[team] = counts.map((_, i) => {
    const week = weeks.weeks[i];
    return games.filter((g) => g.date >= week.start && g.date <= week.end && (g.home === team || g.away === team)).length;
  });
  return result;
}

export function checkPlayoffWeeks(games, playoffWeeks) {
  const actual = gamesPerWeek(games, playoffWeeks);
  return Object.entries(playoffWeeks.teams).flatMap(([team, counts]) => counts.flatMap((expected, i) =>
    actual[team][i] === expected ? [] : [{ team, week: playoffWeeks.weeks[i].week, expected, actual: actual[team][i] }]));
}
