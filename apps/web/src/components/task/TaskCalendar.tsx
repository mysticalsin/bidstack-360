import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { daysUntil } from '@/lib/format';

import type { Task } from '@bidstack/shared';

import { calendarFocusMonth, taskDueUtcDay, taskRecordHref } from './task-calendar-focus';

interface TaskCalendarProps {
  tasks: Task[];
  /** Clock for the open month and the today cell. Defaults to now. */
  now?: Date;
}

export function TaskCalendar({ tasks, now }: TaskCalendarProps) {
  const { t } = useTranslation('crm');
  const [clock] = useState(() => now ?? new Date());
  const focus = calendarFocusMonth(tasks, clock);
  const [cursor, setCursor] = useState(() => ({ year: focus.year, monthIndex: focus.monthIndex }));

  const { year, monthIndex } = cursor;
  const startOffset = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const prevMonth = () =>
    setCursor((current) =>
      current.monthIndex === 0
        ? { year: current.year - 1, monthIndex: 11 }
        : { year: current.year, monthIndex: current.monthIndex - 1 },
    );
  const nextMonth = () =>
    setCursor((current) =>
      current.monthIndex === 11
        ? { year: current.year + 1, monthIndex: 0 }
        : { year: current.year, monthIndex: current.monthIndex + 1 },
    );

  const tasksByDay = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const task of tasks) {
      const due = taskDueUtcDay(task.dueDate);
      if (!due || due.year !== year || due.monthIndex !== monthIndex) continue;
      const list = map.get(due.day) ?? [];
      list.push(task);
      map.set(due.day, list);
    }
    return map;
  }, [tasks, year, monthIndex]);

  const monthLabel = new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const todayUtc = {
    year: clock.getUTCFullYear(),
    monthIndex: clock.getUTCMonth(),
  };
  const showingFocus = year === focus.year && monthIndex === focus.monthIndex;
  const focusIsCurrent = focus.year === todayUtc.year && focus.monthIndex === todayUtc.monthIndex;
  const focusBeforeCurrent =
    focus.year < todayUtc.year ||
    (focus.year === todayUtc.year && focus.monthIndex < todayUtc.monthIndex);

  const cells: Array<{ day: number | null; tasks: Task[]; isToday: boolean }> = [];
  // Empty cells before the 1st
  for (let i = 0; i < startOffset; i++) {
    cells.push({ day: null, tasks: [], isToday: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      day: d,
      tasks: tasksByDay.get(d) ?? [],
      isToday: clock.getUTCDate() === d && year === todayUtc.year && monthIndex === todayUtc.monthIndex,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">{monthLabel}</h2>
          {showingFocus && !focusIsCurrent ? (
            <p className="text-xs text-[var(--fg-secondary)]">
              {focusBeforeCurrent
                ? t(
                    'taskCalendar.lateMonth',
                    'The latest open follow-up in this list is in this month.',
                  )
                : t(
                    'taskCalendar.upcomingMonth',
                    'The next open follow-up in this list is in this month.',
                  )}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            className="iconbtn"
            aria-label={t('taskCalendar.previousMonth', 'Previous month')}
          >
            <Icon name="arrow" size={14} className="rotate-90" ariaHidden />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="iconbtn"
            aria-label={t('taskCalendar.nextMonth', 'Next month')}
          >
            <Icon name="arrow" size={14} className="-rotate-90" ariaHidden />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px rounded-xl border border-[var(--border-subtle)] bg-[var(--border-subtle)] overflow-hidden">
        {[
          { key: 'sun', label: t('taskCalendar.weekdaySun', 'Sun') },
          { key: 'mon', label: t('taskCalendar.weekdayMon', 'Mon') },
          { key: 'tue', label: t('taskCalendar.weekdayTue', 'Tue') },
          { key: 'wed', label: t('taskCalendar.weekdayWed', 'Wed') },
          { key: 'thu', label: t('taskCalendar.weekdayThu', 'Thu') },
          { key: 'fri', label: t('taskCalendar.weekdayFri', 'Fri') },
          { key: 'sat', label: t('taskCalendar.weekdaySat', 'Sat') },
        ].map((d) => (
          <div
            key={d.key}
            className="bg-[var(--surface-card)] px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]"
          >
            {d.label}
          </div>
        ))}
        {cells.map((cell, i) => (
          <div
            key={i}
            className={cn(
              'min-h-[100px] bg-[var(--surface-card)] p-1.5 transition-colors',
              cell.isToday && 'bg-[var(--brand-primary-tint)]',
            )}
          >
            {cell.day !== null && (
              <>
                <div
                  className={cn(
                    'mb-1 text-right text-xs font-medium',
                    cell.isToday ? 'text-[var(--brand-primary)] dark:text-[var(--brand-deep)]' : 'text-[var(--fg-secondary)]',
                  )}
                >
                  {cell.day}
                </div>
                <div className="space-y-1">
                  {cell.tasks.map((t) => (
                    <Link
                      key={t.id}
                      to={taskRecordHref(t.id)}
                      className="block truncate rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors hover:bg-[var(--surface-hover)]"
                      style={{
                        backgroundColor:
                          t.status === 'done'
                            ? 'var(--tag-jade-bg)'
                            : t.status === 'blocked'
                              ? 'var(--tag-tomato-bg)'
                              : daysUntil(t.dueDate) !== null && daysUntil(t.dueDate)! < 0
                                ? 'var(--tag-tomato-bg)'
                                : 'var(--tag-blue-bg)',
                        color:
                          t.status === 'done'
                            ? 'var(--tag-jade-fg)'
                            : t.status === 'blocked'
                              ? 'var(--tag-tomato-fg)'
                              : daysUntil(t.dueDate) !== null && daysUntil(t.dueDate)! < 0
                                ? 'var(--tag-tomato-fg)'
                                : 'var(--tag-blue-fg)',
                      }}
                      title={t.title}
                    >
                      {t.title}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
