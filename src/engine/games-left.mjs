export function gameDates(player, schedule, fromDate, endDate) {
  return schedule.games.filter((g) => g.date >= fromDate && g.date <= endDate
    && (g.home === player.nbaTeam || g.away === player.nbaTeam)).map((g) => g.date).sort();
}

export function gamesLeft(player, schedule, fromDate, endDate) {
  return gameDates(player, schedule, fromDate, endDate).length;
}
