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
