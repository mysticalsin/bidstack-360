export interface UtcDay {
  year: number;
  monthIndex: number;
  day: number;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The due day a follow-up belongs on. A date-only value is that UTC calendar
 * day. A timestamp uses its UTC date. Local midnight must not move the day.
 */
export function taskDueUtcDay(iso: string | null | undefined): UtcDay | null {
  if (!iso) return null;
  const dateOnly = DATE_ONLY.exec(iso);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const monthIndex = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
    return { year, monthIndex, day };
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    monthIndex: parsed.getUTCMonth(),
    day: parsed.getUTCDate(),
  };
}

function dayKey(day: UtcDay): number {
  return day.year * 10_000 + day.monthIndex * 100 + day.day;
}

/**
 * Month the calendar should open on. This month wins when it holds an open
 * follow-up. Otherwise the latest month that still has one, then the next
 * month that has one. Done follow-ups do not pull the grid into the past.
 * The list is the loaded page, not every task in the tenant.
 */
export function calendarFocusMonth(
  tasks: ReadonlyArray<{ dueDate: string | null; status: string }>,
  now: Date,
): { year: number; monthIndex: number } {
  const today: UtcDay = {
    year: now.getUTCFullYear(),
    monthIndex: now.getUTCMonth(),
    day: now.getUTCDate(),
  };
  const open = tasks
    .filter((task) => task.status !== 'done')
    .map((task) => taskDueUtcDay(task.dueDate))
    .filter((day): day is UtcDay => day !== null);
  const currentMonthHasWork = open.some(
    (day) => day.year === today.year && day.monthIndex === today.monthIndex,
  );
  if (currentMonthHasWork || open.length === 0) {
    return { year: today.year, monthIndex: today.monthIndex };
  }
  const todayKey = dayKey(today);
  const overdue = open.filter((day) => dayKey(day) < todayKey);
  const pick = overdue.length
    ? overdue.reduce((latest, day) => (dayKey(day) > dayKey(latest) ? day : latest))
    : open.reduce((soonest, day) => (dayKey(day) < dayKey(soonest) ? day : soonest));
  return { year: pick.year, monthIndex: pick.monthIndex };
}

/** The task record. The list row uses this path. A `?search=` query is ignored. */
export function taskRecordHref(id: string): string {
  return `/tasks/${encodeURIComponent(id)}`;
}
