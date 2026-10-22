import { load, fail, indexOf, rejectSignedOut } from './common.mjs';

const MOVE_RE = /^(.+?)\s+([A-Z]{2,3}) - ([A-Z]{1,2}(?:,[A-Z]{1,2})*)(?:\s+(INJ|GTD|DTD|SUSP|NA|O|P|Q|D))?$/;
const TIME_RE = /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (?:am|pm)$/;

export function parseTransactions(text, page = 'transactions') {
  rejectSignedOut(text, page);
  const L = load(text);
  const h = indexOf(page, L, (s) => s === 'Recent Transactions', 'the "Recent Transactions" heading');
  const f = indexOf(page, L, (s) => s === 'FAB Offers', 'the "FAB Offers" tab', h);
  if (L[f + 1]?.s === 'No recent transactions') {
    for (let i = f + 2; i < L.length && !/^Yahoo Sports - NBC/.test(L[i].s); i++) throw fail(page, L[i], 'transactions layout not seen yet');
    return [];
  }

  const transactions = [];
  let i = f + 1;
  while (i < L.length && !/^Yahoo Sports - NBC/.test(L[i].s)) {
    const moves = [];
    let m;
    while (i < L.length && (m = MOVE_RE.exec(L[i].s))) {
      const line = L[i++];
      const action = L[i++];
      if (!action) throw fail(page, line, 'transactions layout not seen yet');
      let type, faab = null;
      const waiver = /^\$(\d+(?:\.\d+)?) Waiver$/.exec(action.s);
      if (waiver) { type = 'add'; faab = Number(waiver[1]); }
      else if (action.s === 'To Waivers') type = 'drop';
      else throw fail(page, action, 'transactions layout not seen yet');
      moves.push({ player: m[1], nbaTeam: m[2], type, faab });
    }
    if (!moves.length) throw fail(page, L[i] ?? L.at(-1), 'transactions layout not seen yet');
    const team = L[i++];
    if (!team || TIME_RE.test(team.s) || /^Yahoo Sports - NBC/.test(team.s)) throw fail(page, team ?? L.at(-1), 'transactions layout not seen yet');
    const time = L[i++];
    if (!time || !TIME_RE.test(time.s)) throw fail(page, time ?? L.at(-1), 'transactions layout not seen yet');
    transactions.push({ team: team.s, time: time.s, moves });
  }
  return transactions;
}
