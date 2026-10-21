import { load, fail, indexOf, rejectSignedOut } from './common.mjs';

// Only the empty page has been seen. Anything else fails until a real example exists.
export function parseTransactions(text, page = 'transactions') {
  rejectSignedOut(text, page);
  const L = load(text);
  const h = indexOf(page, L, (s) => s === 'Recent Transactions', 'the "Recent Transactions" heading');
  const f = indexOf(page, L, (s) => s === 'FAB Offers', 'the "FAB Offers" tab', h);
  if (L[f + 1]?.s !== 'No recent transactions') throw fail(page, L[f + 1] ?? L[f], 'transactions layout not seen yet');
  for (let i = f + 2; i < L.length && !/^Yahoo Sports - NBC/.test(L[i].s); i++) {
    throw fail(page, L[i], 'transactions layout not seen yet');
  }
  return [];
}
