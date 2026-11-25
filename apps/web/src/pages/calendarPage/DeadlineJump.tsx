import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { dueDateUrgency } from '@/components/ui/DueDateChip';
import { cn } from '@/lib/cn';
import type { CalendarDeadline } from '@/hooks/useCalendarDeadlines';

import { formatDayLabel } from './layout';

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function jumpTarget(
  nearestAfter?: string | null,
  nearestBefore?: string | null,
): { day: string; edge: 'after' | 'before' } | null {
  if (nearestAfter && CALENDAR_DAY.test(nearestAfter)) return { day: nearestAfter, edge: 'after' };
  if (nearestBefore && CALENDAR_DAY.test(nearestBefore))
    return { day: nearestBefore, edge: 'before' };
  return null;
}

/**
 * Names the deadline just outside the visible range and opens that day.
 * An empty week with no neighbor stays quiet — the caller prints "No deadlines".
 */
export function DeadlineJump({
  nearestAfter,
  nearestBefore,
  onJump,
}: {
  nearestAfter?: string | null;
  nearestBefore?: string | null;
  onJump?: (day: string) => void;
}) {
  const { t } = useTranslation('crm');
  const target = jumpTarget(nearestAfter, nearestBefore);
  if (!target || !onJump) return null;

  const date = formatDayLabel(target.day, { month: 'short', day: 'numeric', year: 'numeric' });
  const label =
    target.edge === 'after'
      ? t('calendar.nextDeadline', 'Next deadline {{date}}', { date })
      : t('calendar.previousDeadline', 'Previous deadline {{date}}', { date });

  return (
    <button
      type="button"
      data-date={target.day}
      onClick={() => onJump(target.day)}
      className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
    >
      {label}
    </button>
  );
}

function chipTone(dueDate: string): {
  className: string;
  filled: boolean;
  overdue: boolean;
  dueToday: boolean;
} {
  const { urgency, days } = dueDateUrgency(dueDate);
  if (urgency === 'danger') {
    // --danger on --danger-tint: 5.31:1 light / dark pair verified in index.css.
    return {
      className:
        'border-[var(--danger)] bg-[var(--danger-tint)] text-[var(--danger)] font-semibold',
      filled: true,
      overdue: true,
      dueToday: false,
    };
  }
  if (days === 0) {
    // Due today — amber emphasis, same tone DueDateChip uses for "Due today".
    // --warning on --warning-tint: 5.28:1 light / dark pair verified in index.css.
    return {
      className:
        'border-[var(--warning)] bg-[var(--warning-tint)] text-[var(--warning)] font-semibold',
      filled: true,
      overdue: false,
      dueToday: true,
    };
  }
  return {
    className: 'border-[var(--border-strong)] text-[var(--fg-secondary)]',
    filled: false,
    overdue: false,
    dueToday: false,
  };
}

/** Outline chip for one bid or proposal deadline. The day is the calendar day in the string. */
export function DeadlineChip({ deadline }: { deadline: CalendarDeadline }) {
  const { t } = useTranslation('crm');
  const { className, filled, overdue, dueToday } = chipTone(deadline.dueDate);
  const isOpp = deadline.kind === 'opportunity';
  const label =
    isOpp && deadline.customer ? `${deadline.customer} · ${deadline.name}` : deadline.name;
  const kindLabel = isOpp
    ? t('calendar.deadlineKindOpportunity', 'Bid deadline')
    : t('calendar.deadlineKindProposal', 'Proposal deadline');
  const stateSuffix = overdue
    ? t('calendar.deadlineOverdueSuffix', ', overdue')
    : dueToday
      ? t('calendar.deadlineDueTodaySuffix', ', due today')
      : '';
  const date = formatDayLabel(deadline.dueDate, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <Link
      to={isOpp ? `/opportunities/${deadline.id}` : `/proposals/${deadline.id}`}
      title={`${kindLabel}: ${label}`}
      aria-label={`${kindLabel}: ${label}, ${t('calendar.deadlineDue', 'due {{date}}', { date })}${stateSuffix}`}
      className={cn(
        'flex min-h-[44px] w-full items-center gap-1.5 rounded-md border bg-transparent px-1.5 text-xs font-medium leading-tight',
        'hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-1.5 w-1.5 shrink-0 rotate-45 border border-current',
          filled && 'bg-current',
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}
