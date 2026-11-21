/**
 * Due dates are `@db.Date`. Overdue is the UTC calendar day, the same cut the
 * task summary uses (`due_date < today::date`). Comparing the date to `now`
 * marks a task due today as overdue for the rest of that UTC day, including
 * 2026-11-21 02:00 UTC, which is still the evening of 20 Nov in São Paulo.
 */
export function taskOverdueBefore(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** True when a `YYYY-MM-DD` due date is before the UTC day of `now`. */
export function isTaskOverdue(dueDate: string | null | undefined, now = new Date()): boolean {
  if (!dueDate) return false;
  return dueDate < taskOverdueBefore(now).toISOString().slice(0, 10);
}
