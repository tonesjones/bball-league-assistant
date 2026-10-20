import { findPlayer } from '../engine/names.mjs';

export function matchSnapshot(snapshot, ids) {
  const { players } = ids;
  const matched = [], unmatched = [];
  const add = ({ name, nbaTeam }, where) => {
    const { player } = findPlayer(players, name, nbaTeam);
    if (player) matched.push({ name, nbaTeam, espnId: player.espnId, where });
    else unmatched.push({ name, nbaTeam, where });
  };
  (snapshot.team?.roster ?? []).forEach((p) => add(p, 'roster'));
  (snapshot.matchup?.opponentRoster ?? []).forEach((p) => add(p, 'opponent'));
  (snapshot.freeAgents ?? []).forEach((p) => add(p, 'freeAgent'));
  return { matched, unmatched };
}
