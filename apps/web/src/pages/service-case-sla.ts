/**
 * UTC calendar days from today until a service-case SLA. Today is 0.
 * The case header used to compare the deadline instant to now, so an SLA
 * dated today turned red after UTC midnight. toLocaleDateString without a
 * zone follows America/Sao_Paulo, so 02:00Z on the next UTC day still prints
 * as the day before. The rest of the bid clock uses the UTC calendar day.
 */
const DAY_MS = 86_400_000;

export function slaCalendarDays(
  iso: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!iso) return null;
  const dueDate = new Date(iso);
  if (Number.isNaN(dueDate.getTime())) return null;
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (due - today) / DAY_MS;
}

/** True when the SLA's UTC calendar day is already past. Due today is not past due. */
export function isSlaPastDue(iso: string | null | undefined, now: Date = new Date()): boolean {
  const days = slaCalendarDays(iso, now);
  return days !== null && days < 0;
}

/** The SLA's UTC calendar day, in the viewer's locale. */
export function formatSlaDate(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, { timeZone: 'UTC' });
}
