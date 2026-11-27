/**
 * Day count the lead-rot settings field can save.
 *
 * New is 7 when the org has no override. Clearing the field used to become
 * 0, and 400 used to clamp to 365. Neither count was typed. An empty field
 * is not zero. A value outside 0 to 365, or one that is not a whole number,
 * is not saved.
 */
export type LeadRotDaysDraft =
  | { ok: true; days: number; changed: boolean }
  | { ok: false; reason: 'empty' | 'invalid' };

const WHOLE_DAYS = /^(?:0|[1-9]\d{0,2})$/;

export function leadRotDaysDraft(raw: string, saved: number): LeadRotDaysDraft {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  if (!WHOLE_DAYS.test(trimmed)) return { ok: false, reason: 'invalid' };
  const days = Number(trimmed);
  if (!Number.isInteger(days) || days > 365) return { ok: false, reason: 'invalid' };
  return { ok: true, days, changed: days !== saved };
}
