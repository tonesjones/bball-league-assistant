import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readDecision, validDecisionId } from './decisions.mjs';
import { loadGameLogs } from './gamelogs.mjs';
import { validateReview, applyReviews, realizedGain, flips } from '../engine/bakeoff.mjs';
import { addDays, tomorrow } from '../engine/weeks.mjs';

export const SOURCES = ['tool', 'chatbot', 'none'];
const today = (now) => addDays(tomorrow(now), -1);
async function optionalText(file) {
  try { return await readFile(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
}
const jsonLines = async (file) => (await optionalText(file)).split(/\r?\n/).filter((s) => s.trim()).map(JSON.parse);
const local = (root, ...parts) => path.join(root, 'local', ...parts);

async function linkedArms(root, record) {
  const entries = (await jsonLines(local(root, 'bakeoff.jsonl'))).filter((e) => e.decisionId === record.id);
  if (new Set(entries.map((e) => e.source)).size !== entries.length || entries.some((e) =>
    !SOURCES.includes(e.source) || e.week !== record.report.week || e.asOf !== record.report.asOf)) {
    throw new Error('Pilot entries do not match this decision. Review the saved pilot records.');
  }
  return entries;
}

export async function reviewState(root, id, { now = new Date().toISOString() } = {}) {
  const dir = local(root, 'decisions');
  let files;
  try { files = await readdir(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; files = []; }
  const records = await Promise.all(files.filter((f) => f.endsWith('.json') && validDecisionId(f.slice(0, -5)))
    .map((f) => readDecision(f.slice(0, -5), dir)));
  records.sort((a, b) => (b.createdAt ?? b.report.asOf).localeCompare(a.createdAt ?? a.report.asOf));
  if (!records.length && !id) return { decisions: [], selected: null };
  if (id && !validDecisionId(id)) throw new Error('Invalid decision ID');
  const record = id ? await readDecision(id, dir) : records[0];
  const entries = await linkedArms(root, record);
  const reviews = await jsonLines(local(root, 'pilot-reviews.jsonl'));
  const r = record.report, closed = today(now) > r.window.end;
  const applied = applyReviews(entries.map((entry) => ({ entry, windowEnd: r.window.end })), reviews);
  const brief = await optionalText(local(root, 'briefs', `${record.id}.md`));
  const events = (await jsonLines(local(root, 'review-ui', 'events.jsonl'))).filter((e) => e.decisionId === record.id);
  const outcomes = new Map();
  if (closed && entries.length) {
    const logs = await loadGameLogs('2026-27', r.window.start, r.window.end, { root: local(root, 'gamelogs') });
    for (const entry of entries) {
      const replay = realizedGain(entry, logs, { to: r.window.end });
      outcomes.set(entry.source, { status: replay.status, reasons: replay.reasons,
        changes: replay.status === 'scored' ? flips(replay.gain, replay.finalTotals, replay.finalVolume, { taken: false }) : null });
    }
  }
  const arms = SOURCES.map((source) => {
    const entry = applied.results.find((row) => row.entry.source === source)?.entry;
    const latest = reviews.filter((v) => v.decisionId === record.id && v.source === source && today(v.recordedAt) <= r.window.end).at(-1);
    return { source, entry: entry ?? null, review: entry ? { rating: entry.rating, note: latest?.note ?? '', rejectReason: latest?.rejectReason ?? '' } : null,
      outcome: outcomes.get(source) ?? { status: 'pending', reasons: [], changes: null } };
  });
  return { decisions: records.map((v) => ({ id: v.id, asOf: v.report.asOf, week: v.report.week, modelVersion: v.provenance.modelVersion })),
    selected: { id: record.id, asOf: r.asOf, week: r.week, window: r.window, modelVersion: record.provenance.modelVersion,
      decision: r.decision, notes: r.notes ?? [], brief, closed, pilotComplete: entries.length === 3,
      ratingsSaved: arms.filter((a) => a.entry?.rating != null).length, lateReviews: applied.late,
      copiedAt: events.filter((e) => e.type === 'brief-copied').at(-1)?.recordedAt ?? null, arms } };
}

export async function saveRatings(root, id, ratings, { now = new Date().toISOString() } = {}) {
  const record = await readDecision(id, local(root, 'decisions'));
  if (today(now) > record.report.window.end) throw new Error('This matchup has ended. Ratings are closed to avoid hindsight.');
  const entries = await linkedArms(root, record);
  if (entries.length !== 3) throw new Error('Record all three pilot answers before saving ratings.');
  if (!Array.isArray(ratings) || ratings.length !== 3 || new Set(ratings.map((r) => r?.source)).size !== 3) {
    throw new Error('Choose a rating for each of the three answers.');
  }
  const rows = ratings.map((r) => {
    if (typeof r.note !== 'undefined' && (typeof r.note !== 'string' || r.note.length > 2000)) throw new Error('Notes must be text up to 2000 characters.');
    return validateReview({ decisionId: id, recordedAt: now, source: r.source, rating: r.rating,
      note: r.note ?? '', ...(r.rejectReason && { rejectReason: r.rejectReason }) });
  });
  const previous = await jsonLines(local(root, 'pilot-reviews.jsonl'));
  const changed = rows.filter((r) => {
    const last = previous.filter((v) => v.decisionId === id && v.source === r.source).at(-1);
    return !last || last.rating !== r.rating || (last.note ?? '') !== r.note || (last.rejectReason ?? '') !== (r.rejectReason ?? '');
  });
  if (changed.length) {
    await mkdir(local(root), { recursive: true });
    await appendFile(local(root, 'pilot-reviews.jsonl'), changed.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return { saved: true, changed: changed.length };
}

export async function recordBriefCopy(root, id, { now = new Date().toISOString() } = {}) {
  await readDecision(id, local(root, 'decisions'));
  if (!(await optionalText(local(root, 'briefs', `${id}.md`)))) throw new Error('The brief is not ready yet.');
  await mkdir(local(root, 'review-ui'), { recursive: true });
  await appendFile(local(root, 'review-ui', 'events.jsonl'), JSON.stringify({ decisionId: id, type: 'brief-copied', recordedAt: now }) + '\n');
  return { copiedAt: now };
}
