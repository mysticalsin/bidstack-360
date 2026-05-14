import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { daysUntil } from '@/lib/format';

import type { Task } from '@bidstack/shared';

interface TaskCalendarProps {
  tasks: Task[];
}

export function TaskCalendar({ tasks }: TaskCalendarProps) {
  const [month, setMonth] = useState(() => new Date());

  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const startOffset = firstDay.getDay(); // 0 = Sunday
  const daysInMonth = lastDay.getDate();

  const prevMonth = () => setMonth(new Date(year, monthIndex - 1, 1));
  const nextMonth = () => setMonth(new Date(year, monthIndex + 1, 1));

  const tasksByDay = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const d = new Date(task.dueDate);
      if (d.getFullYear() === year && d.getMonth() === monthIndex) {
        const day = d.getDate();
        const list = map.get(day) ?? [];
        list.push(task);
        map.set(day, list);
      }
    }
    return map;
  }, [tasks, year, monthIndex]);

  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const cells: Array<{ day: number | null; tasks: Task[]; isToday: boolean }> = [];
  // Empty cells before the 1st
  for (let i = 0; i < startOffset; i++) {
    cells.push({ day: null, tasks: [], isToday: false });
  }
  const today = new Date();
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      day: d,
      tasks: tasksByDay.get(d) ?? [],
      isToday:
        today.getDate() === d && today.getMonth() === monthIndex && today.getFullYear() === year,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--fg-primary)]">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={prevMonth} className="iconbtn" aria-label="Previous month">
            <Icon name="arrow" size={14} className="rotate-90" ariaHidden />
          </button>
          <button type="button" onClick={nextMonth} className="iconbtn" aria-label="Next month">
            <Icon name="arrow" size={14} className="-rotate-90" ariaHidden />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px rounded-xl border border-[var(--border-subtle)] bg-[var(--border-subtle)] overflow-hidden">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="bg-[var(--surface-card)] px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]"
          >
            {d}
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
                    cell.isToday ? 'text-[var(--brand-primary)]' : 'text-[var(--fg-secondary)]',
                  )}
                >
                  {cell.day}
                </div>
                <div className="space-y-1">
                  {cell.tasks.map((t) => (
                    <Link
                      key={t.id}
                      to={`/tasks?search=${encodeURIComponent(t.title)}`}
                      className="block truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-[var(--surface-hover)]"
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
