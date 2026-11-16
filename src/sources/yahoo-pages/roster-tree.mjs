// A team page's roster table read through Chrome's read_page (accessibility-tree text). Chrome's
// plain page text of a team page holds only the header (seen 2026-11-15), so the capture saves the
// roster table element as <page>-tree.txt. Layouts seen:
// - Tony's page: each row starts with a hidden textbox (a starter; the slot is not shown) or a
//   combobox whose value is the slot ("BN", "IL"). Starters are listed in the league's slot order.
// - Another team's page: no slot at all; the player lines follow each other.
// A player is: image "<name>", link "<name>", optional status word, a notes link ending in the
// name (with one child line), then "TEAM - POS,POS".
import { TEAMPOS_RE } from './common.mjs';

const LINE_RE = /^(\s*)(\w+)(?: "([^"]*)")?/;
const CAPTION_RE = /^(.+)'s Players roster for (\d{4}-\d{2}-\d{2})\.$/;
const STATUS = { Out: 'O', Questionable: 'Q' };
const fits = (positions, slot) => slot === 'Util' || positions.includes(slot)
  || slot === 'G' && positions.some((p) => p === 'PG' || p === 'SG') || slot === 'F' && positions.some((p) => p === 'SF' || p === 'PF');

const fail = (page, n, why) => new Error(`${page}: line ${n}: ${why}`);

// activeSlots: the league's starting slots in order (PG, SG, G, ...), to place starters whose slot
// the tree hides. Without it, or on a page with no slot controls, slot is null.
export function parseRosterTree(text, page = 'team-tree', { activeSlots = null } = {}) {
  const L = String(text).split(/\r?\n/).map((s, i) => {
    const m = LINE_RE.exec(s);
    return m ? { n: i + 1, depth: m[1].length, role: m[2], text: m[3] ?? null } : { n: i + 1, depth: -1, role: '', text: null };
  });
  const caption = L.map((l) => l.role === 'generic' && CAPTION_RE.exec(l.text ?? '')).find(Boolean);
  if (!caption) throw fail(page, 1, 'roster caption ("<team>\'s Players roster for <date>.") not found');
  const roster = [];
  let rowSlot, starter = 0;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (l.role === 'textbox') rowSlot = 'hidden';
    else if (l.role === 'combobox') rowSlot = l.text;
    if (!(l.role === 'image' && l.text && L[i + 1]?.role === 'link' && L[i + 1].text === l.text)) continue;
    const name = l.text;
    let j = i + 2, status = null;
    if (L[j]?.role === 'generic' && L[j].text && !TEAMPOS_RE.test(L[j].text)) {
      status = STATUS[L[j].text];
      if (!status) throw fail(page, L[j].n, 'unknown status word after the player name');
      j++;
    }
    if (!(L[j]?.role === 'link' && L[j].text?.endsWith(name) && L[j].text !== name)) throw fail(page, L[j]?.n ?? l.n, 'expected the player notes link');
    const depth = L[j].depth;
    for (j++; L[j] && L[j].depth > depth; j++);
    const t = TEAMPOS_RE.exec(L[j]?.text ?? '');
    if (L[j]?.role !== 'generic' || !t) throw fail(page, L[j]?.n ?? l.n, 'expected "TEAM - POS,POS" after the notes link');
    const positions = t[2].split(',');
    let slot = null;
    if (rowSlot === 'hidden' && activeSlots) {
      slot = activeSlots[starter++];
      if (!slot) throw fail(page, l.n, 'more starters than starting slots');
      if (!fits(positions, slot)) throw fail(page, l.n, `starter order does not fit slot ${slot}`);
    } else if (rowSlot && rowSlot !== 'hidden') slot = rowSlot;
    roster.push({ name, nbaTeam: t[1], positions, status, slot });
    rowSlot = undefined;
    i = j;
  }
  if (!roster.length) throw fail(page, L.length, 'no player rows');
  return { name: caption[1], date: caption[2], roster };
}
