const text = (v) => v == null || v === '' ? 'unknown' : String(v);
const mpg = (v) => Number.isFinite(v) ? v.toFixed(1) : 'unknown';
const CATEGORIES = 'PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, TO (fewer turnovers wins)';

// Context questions: dependsOn players first, then runner-up pickups, one per player, input order.
// The planner's action, steps and gains are never shown.
function questionPlayers(plan) {
  const seen = new Set(), out = [];
  const add = (player) => {
    if (!player?.name || seen.has(player.name)) return;
    seen.add(player.name);
    out.push(player);
  };
  for (const d of plan.dependsOn ?? []) add(d.player);
  for (const r of plan.runnersUp ?? []) add(r.step?.pickup);
  return out;
}

// Formats a saved planner decision as a context-check brief. Every number comes from the decision
// and its snapshot; nothing here scores or ranks.
export function buildBrief({ record, snapshot, prompt, promptVersion }) {
  const r = record.report, end = r.window.end;
  const slots = (snapshot.settings?.rosterPositions ?? []).map((s) => `${s.slot} x${s.count}`).join(', ') || 'unknown';

  const lines = [prompt.trim(), '', `# Context check, week ${text(r.week)}`, '',
    `Data as of: ${r.asOf}`,
    `Brief prompt version: ${promptVersion}`,
    '', '## League rules', '',
    `- Categories: ${CATEGORIES}`,
    `- Roster slots: ${slots}`,
    `- Adds left this week: ${text(r.addsLeft)}`,
    `- Week: ${r.window.start} to ${end}`,
    '', '## Context questions', ''];

  const questions = questionPlayers(r);
  for (const player of questions) {
    const m = player.minutes;
    const prior = !m ? 'unknown' : m.prior == null ? 'none' : mpg(m.prior);
    lines.push(`${player.name} (${text(player.nbaTeam)}): ${text(m?.games)} games played, season ${mpg(m?.season)} MPG, prior ${prior} MPG.`,
      `Will this role last through ${end}?`, '');
  }
  if (!questions.length) lines.push('None.', '');

  lines.push('## Roster facts', '', 'My players:', '');
  for (const p of snapshot.team.roster) lines.push(`- ${p.name} (${text(p.nbaTeam)}): ${p.status ?? 'healthy'}`);
  lines.push('', 'Days with open lineup slots:', '');
  const open = (r.startsByDay ?? []).filter((d) => d.openSlots > 0);
  for (const d of open) lines.push(`- ${d.date}: ${d.openSlots} open`);
  if (!open.length) lines.push('None.');
  return lines.join('\n') + '\n';
}
