/**
 * Calendar days for the public booking list.
 *
 * The list used to add a local day and then read the UTC date of that
 * instant. At 20:00 in Toronto on 25 Nov 2026, UTC is already 26 Nov, so
 * tomorrow became 27 Nov. The button and the availability request both
 * used that date. The day a guest hears is the calendar day in their zone.
 */

export function calendarDayKey(now: Date, timeZone: string, offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const shifted = new Date(Date.UTC(pick('year'), pick('month') - 1, pick('day') + offsetDays));
  return shifted.toISOString().slice(0, 10);
}

/** Speak a YYYY-MM-DD as that calendar day, not the previous local day. */
export function speakCalendarDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, date)));
}
