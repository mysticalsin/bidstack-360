/**
 * UTC calendar days from today to a task due date. Today is 0.
 * Due dates are calendar dates (YYYY-MM-DD). Counting elapsed milliseconds
 * from UTC midnight marks a task due today as yesterday after 12:00 UTC.
 * A local getDate/getMonth day would follow America/Sao_Paulo midnight
 * instead of the UTC day the rest of the bid clock uses.
 */
const DAY_MS = 86_400_000;

export function taskDueCalendarDays(
  dueDate: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!dueDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const due = Date.UTC(year, month - 1, day);
  const check = new Date(due);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (due - today) / DAY_MS;
}

/** Open task whose due date is today's UTC calendar day. Done tasks stay out of Today. */
export function isOpenTaskDueToday(
  task: { dueDate: string | null; status: string },
  now: Date,
): boolean {
  if (task.status === 'done') return false;
  return taskDueCalendarDays(task.dueDate, now) === 0;
}

/** Open task whose due date is a previous UTC calendar day. Due today is not past due. */
export function isOpenTaskPastDue(
  task: { dueDate: string | null; status: string },
  now: Date,
): boolean {
  if (task.status === 'done') return false;
  const days = taskDueCalendarDays(task.dueDate, now);
  return days !== null && days < 0;
}
