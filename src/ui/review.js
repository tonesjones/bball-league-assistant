const token = location.hash.slice(1);
const $ = (id) => document.getElementById(id);
const names = { tool: 'Engine advice', chatbot: 'Isolated chatbot', none: 'Make no move' };
let state, dirty = false;
const el = (tag, text, className) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (className) n.className = className; return n; };
const dateTime = (v) => new Date(v).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
function message(text = '') { $('message').textContent = text; }
async function api(route, data) {
  const response = await fetch(route, { headers: { Authorization: `Bearer ${token}`, ...(data && { 'Content-Type': 'application/json' }) },
    ...(data && { method: 'POST', body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Could not load the review.');
  return result;
}
function answer(arm, selected) {
  const e = arm.entry;
  if (!e) return 'This answer has not been recorded yet. Finish the pilot step in Codex, then reload saved data.';
  if (arm.source === 'chatbot') return e.note || (e.invalidReason ? `Invalid answer: ${e.invalidReason}` : 'No raw explanation was saved.');
  if (arm.source === 'none') return 'Keep the roster as it is. Make no add or drop for this decision.';
  const d = selected.decision;
  if (d.action !== 'move') return `${d.action === 'insufficient' ? 'Insufficient evidence' : 'Hold'}. ${d.reason ?? ''}`;
  const p = d.pair;
  return `Add ${p.pickup.name}. ${p.drop ? `Drop ${p.drop.name}.` : 'Use the open roster spot.'}\nEffective ${p.pickupStart}.\nApproximate category gain: ${p.score.toFixed(3)}.\nScenario range: ${p.scoreRange.map((n) => n.toFixed(3)).join(' to ')}.`;
}
function render() {
  const s = state.selected;
  $('decision').replaceChildren(...state.decisions.map((d) => { const o = el('option', `${dateTime(d.asOf)} · Week ${d.week} · ${d.id.slice(0, 8)}`); o.value = d.id; return o; }));
  $('empty').hidden = !!s; $('content').hidden = !s; $('decision').disabled = !s;
  if (!s) { $('meta').textContent = ''; return; }
  $('decision').value = s.id;
  $('meta').textContent = `Captured ${dateTime(s.asOf)} Pacific · Model ${s.modelVersion ?? 'unknown'} · Matchup ${s.window.start} to ${s.window.end} · Decision ${s.id}`;
  $('progress').replaceChildren(...[
    ['League data', 'Captured; see timestamp above'], ['ChatGPT brief', s.brief ? (s.copiedAt ? 'Copy recorded' : 'Ready to copy') : 'Not created'],
    ['Pilot answers', s.pilotComplete ? '3 of 3 recorded' : 'Incomplete'], ['Your ratings', `${s.ratingsSaved} of 3 saved`],
    ['Results', s.closed ? (s.arms.every((a) => a.outcome.status === 'scored') ? 'Scored from saved lineups' : 'Evidence incomplete') : 'Waiting for matchup end']
  ].map(([label, status]) => { const li = el('li'); li.append(el('strong', label), el('span', status)); return li; }));
  $('copy').disabled = !s.brief;
  $('copy-status').textContent = s.copiedAt ? `Brief copy recorded ${dateTime(s.copiedAt)} Pacific. Pasting and reading in ChatGPT are not tracked.` : 'Copying does not submit anything to ChatGPT.';
  $('pilot-status').textContent = s.pilotComplete ? 'The isolated chatbot used the shared evidence packet. It is separate from your regular ChatGPT chat.' : 'Pilot answers are incomplete. Ratings become available once all three answers are recorded; your brief can still be copied.';
  $('arms').replaceChildren(...s.arms.map((arm) => {
    const card = el('article', null, 'card'); card.dataset.source = arm.source;
    card.append(el('h3', names[arm.source]), el('p', arm.source === 'chatbot' ? (arm.entry?.chatbot ?? 'COMPARISON ANSWER') : arm.source === 'none' ? 'BASELINE' : 'SAVED ENGINE DECISION', 'badge'), el('p', answer(arm, s), 'answer'));
    if (arm.entry?.invalidReason) card.append(el('p', `Invalid; retained as hold: ${arm.entry.invalidReason}`, 'muted'));
    const fieldset = el('fieldset', null, 'stars'); fieldset.append(el('legend', 'Your rating · 1 poor, 5 excellent'));
    for (let value = 1; value <= 5; value++) {
      const label = el('label'), input = el('input'); input.type = 'radio'; input.name = arm.source; input.value = value;
      input.required = true; input.checked = arm.review?.rating === value; input.disabled = s.closed || !s.pilotComplete;
      input.setAttribute('aria-label', `${names[arm.source]}: ${value} out of 5`); label.append(input, el('span', String(value))); fieldset.append(label);
    }
    const noteLabel = el('label', 'Optional comment'); noteLabel.htmlFor = `note-${arm.source}`;
    const note = el('textarea'); note.id = noteLabel.htmlFor; note.maxLength = 2000; note.value = arm.review?.note ?? ''; note.disabled = s.closed || !s.pilotComplete;
    const reasonLabel = el('label', 'If rejecting, why?'); reasonLabel.htmlFor = `reason-${arm.source}`;
    const reason = el('select'); reason.id = reasonLabel.htmlFor; reason.disabled = s.closed || !s.pilotComplete;
    for (const [value, label] of [['', 'No rejection reason'], ['wrong-role', 'Wrong role'], ['core-player', 'Core player'], ['bad-data', 'Bad data'], ['injury', 'Injury'], ['timing', 'Timing'], ['other', 'Other']]) { const o = el('option', label); o.value = value; reason.append(o); }
    reason.value = arm.review?.rejectReason ?? '';
    card.append(fieldset, noteLabel, note, reasonLabel, reason); return card;
  }));
  $('save').disabled = s.closed || !s.pilotComplete;
  $('rating-status').textContent = s.closed ? 'Ratings closed: this matchup has ended.' : s.ratingsSaved === 3 ? 'All three ratings are saved.' : 'Choose one rating for each answer.';
  $('results-status').textContent = s.closed ? 'Computed from the game logs currently saved on this computer.' : `Results will be available after ${s.window.end}, once complete game logs are saved.`;
  $('outcomes').replaceChildren(...s.arms.map((a) => el('div', `${names[a.source]}: ${a.outcome.status === 'scored' ? `helped ${a.outcome.changes.helped.join(', ') || 'no categories'}; hurt ${a.outcome.changes.hurt.join(', ') || 'no categories'}` : a.outcome.status === 'pending' ? 'pending' : `unscored — ${a.outcome.reasons.join('; ')}`}`, 'result-row')));
  $('notes').replaceChildren(...s.notes.map((n) => el('li', n)));
  if (s.lateReviews) message('Some older ratings were recorded after the matchup ended and are excluded.');
  dirty = false;
}
async function load(id) {
  message();
  try {
    state = await api(`/api/state${id ? `?decision=${encodeURIComponent(id)}` : ''}`); render();
    if (state.selected) { const url = new URL(location.href); url.searchParams.set('decision', state.selected.id); history.replaceState(null, '', url); }
  } catch (e) { message(e.message); }
}
$('ratings').addEventListener('input', () => { dirty = true; $('rating-status').textContent = 'You have unsaved changes.'; });
$('ratings').addEventListener('submit', async (event) => {
  event.preventDefault(); $('save').disabled = true;
  const ratings = state.selected.arms.map((a) => ({ source: a.source, rating: Number(document.querySelector(`input[name="${a.source}"]:checked`)?.value),
    note: $(`note-${a.source}`).value, rejectReason: $(`reason-${a.source}`).value }));
  try { await api('/api/ratings', { decisionId: state.selected.id, ratings }); await load(state.selected.id); message('All three ratings saved. You can close this screen.'); }
  catch (e) { message(e.message); $('save').disabled = false; }
});
$('copy').addEventListener('click', async () => {
  $('copy').disabled = true;
  try {
    await navigator.clipboard.writeText(state.selected.brief);
    try {
      const result = await api('/api/copied', { decisionId: state.selected.id });
      state.selected.copiedAt = result.copiedAt;
      $('copy-status').textContent = `Brief copy recorded ${dateTime(result.copiedAt)} Pacific. Pasting and reading in ChatGPT are not tracked.`;
      $('progress').children[1].querySelector('span').textContent = 'Copy recorded';
      message('Brief copied. Open your ChatGPT chat and paste it.');
    }
    catch (e) { message(`The brief was copied, but the copy record could not be saved: ${e.message}`); }
  } catch { message('Clipboard access was blocked. Allow clipboard access in this browser and try again.'); }
  finally { $('copy').disabled = !state.selected?.brief; }
});
$('decision').addEventListener('change', () => {
  if (!dirty || confirm('Discard unsaved rating changes?')) load($('decision').value); else $('decision').value = state.selected.id;
});
$('reload').addEventListener('click', () => { if (!dirty || confirm('Discard unsaved rating changes?')) load(state?.selected?.id); });
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
load(new URL(location.href).searchParams.get('decision'));
