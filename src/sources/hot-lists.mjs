// Free-agent rankings over recent windows ("hot lists"). Yahoo's players page re-ranks available
// players by the stat window in its `stat1` filter, so a player hot in the last 7 or 14 days shows
// near the top even when his season rank is low. Averages favor strong games in a short sample;
// totals favor players who have also played the most games. See docs/update-league.md.

export const HOT_WINDOWS = [
  { key: 'l7a', stat: 'S_AL7', label: 'L7 avg' },
  { key: 'l7t', stat: 'S_L7', label: 'L7 tot' },
  { key: 'l14a', stat: 'S_AL14', label: 'L14 avg' },
  { key: 'l14t', stat: 'S_L14', label: 'L14 tot' },
];

// Pages of 25 read per window: the top 50.
export const HOT_PAGES = 2;

export const HOT_FILE = /^hot-(l7a|l7t|l14a|l14t)-(\d+)$/;

// 1-based rank of each player (name|team) across a window's pages, in page order.
export function rankMap(pages) {
  const ranks = new Map();
  let n = 0;
  for (const page of pages) {
    if (!page.ok) continue;
    for (const p of page.value) {
      n++;
      const key = `${p.name}|${p.nbaTeam}`;
      if (!ranks.has(key)) ranks.set(key, n);
    }
  }
  return ranks;
}
