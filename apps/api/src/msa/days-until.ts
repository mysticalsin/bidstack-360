/**
 * Whole UTC calendar days until a renewal or expiry. Today is 0.
 * Rounding the clock from UTC midnight turns a 30-day afternoon expiry into 31,
 * which moves it out of the 30-day urgency bucket the agreements list shows.
 * Same rule as the worker's renewalDaysOut.
 */
const DAY_MS = 86_400_000;

export function daysUntil(d: Date | null, now = new Date()): number | null {
  if (!d) return null;
  const due = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (due - today) / DAY_MS;
}
