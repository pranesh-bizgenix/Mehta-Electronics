// Business-hours due-time calculation in the policy's timezone.
// Pure functions: given a start instant, a turnaround in business minutes and
// the owner's SLA policy, return the due instant (UTC Date).

const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function zoned(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    weekday: parts.weekday.toUpperCase().slice(0, 3)
  };
}

function offsetMs(date, timeZone) {
  const z = zoned(date, timeZone);
  return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock time in timeZone -> UTC Date. */
export function fromZoned({ year, month, day, hour, minute }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let utc = guess - offsetMs(new Date(guess), timeZone);
  utc = guess - offsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const isoDay = (z) => `${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`;

function nextDayStart(z, startMinutes, timeZone) {
  const noonUtc = Date.UTC(z.year, z.month - 1, z.day, 12) + 24 * 3600 * 1000;
  const next = new Date(noonUtc);
  return fromZoned({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: Math.floor(startMinutes / 60), minute: startMinutes % 60 }, timeZone);
}

export function addBusinessMinutes(start, minutes, policy) {
  const { timezone, businessDays, businessHours, holidays = [] } = policy;
  const open = toMinutes(businessHours.start), close = toMinutes(businessHours.end);
  const days = new Set(businessDays), holidaySet = new Set(holidays);
  let cursor = new Date(start);
  let remaining = minutes;
  for (let guard = 0; guard < 4000; guard++) {
    const z = zoned(cursor, timezone);
    const nowMinutes = z.hour * 60 + z.minute;
    if (!days.has(z.weekday) || holidaySet.has(isoDay(z)) || nowMinutes >= close) { cursor = nextDayStart(z, open, timezone); continue; }
    if (nowMinutes < open) { cursor = fromZoned({ ...z, hour: Math.floor(open / 60), minute: open % 60 }, timezone); continue; }
    const available = close - nowMinutes;
    if (remaining <= available) return new Date(cursor.getTime() + remaining * 60000);
    remaining -= available;
    cursor = nextDayStart(z, open, timezone);
  }
  throw new Error('SLA policy has no business time; check business days and hours.');
}

export { DAY_KEYS };
