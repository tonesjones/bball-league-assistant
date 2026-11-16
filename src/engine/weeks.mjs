export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function tomorrow(asOf) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(asOf));
  const part = (type) => parts.find((p) => p.type === type).value;
  return addDays(`${part('year')}-${part('month')}-${part('day')}`, 1);
}

export const easternDate = (asOf) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf));

// Yahoo shows M/D without a year. The year is asOf's, moved by one when the dates cross New Year.
export function isoDay(md, asOf) {
  const [m, d] = md.split('/').map(Number);
  const ref = new Date(asOf), refMonth = ref.getUTCMonth() + 1;
  const year = ref.getUTCFullYear() + (m < refMonth - 6 ? 1 : m > refMonth + 6 ? -1 : 0);
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
