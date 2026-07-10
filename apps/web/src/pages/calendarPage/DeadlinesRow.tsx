/**
 * calendarPage/DeadlinesRow.tsx — all-day "Deadlines" lane under the day
 * headers.
 *
 * WHY: bid teams live by submission deadlines, but the calendar only showed
 * synced meetings — an RFP due Thursday was invisible while a 1:1 was not.
 * Opportunity and proposal due dates render as outline chips with a diamond
 * marker (deliberately unlike the solid meeting bars) and deep-link to their
 * record. Urgency follows DueDateChip semantics so every surface agrees on
 * the bid clock: overdue = danger, due today = amber emphasis.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { dueDateUrgency } from '@/components/ui/DueDateChip';
import { useCalendarDeadlines, type CalendarDeadline } from '@/hooks/useCalendarDeadlines';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';

import { toLocalIsoDate } from './dateUtils';

// Same column template as the calendar grid so lane cells align with day columns.
const LANE_GRID = 'grid grid-cols-[56px_repeat(7,1fr)] border-b border-[var(--border-subtle)]';

interface ChipTone {
  className: string;
  /** Filled diamond = needs attention (shape + fill, not hue alone — WCAG 1.4.1). */
  filled: boolean;
  overdue: boolean;
  dueToday: boolean;
}

function chipTone(dueDate: string): ChipTone {
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

function DeadlineChip({ deadline }: { deadline: CalendarDeadline }) {
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

  return (
    <Link
      to={isOpp ? `/opportunities/${deadline.id}` : `/proposals/${deadline.id}`}
      title={`${kindLabel}: ${label}`}
      aria-label={
        `${kindLabel}: ${label}, ` +
        t('calendar.deadlineDue', 'due {{date}}', { date: formatDate(deadline.dueDate) }) +
        stateSuffix
      }
      className={cn(
        // min-h-[44px] keeps the tap target compliant even in the dense lane.
        'flex min-h-[44px] w-full items-center gap-1.5 rounded-md border bg-transparent px-1.5 text-[11px] font-medium leading-tight',
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

export function DeadlinesRow({ days }: { days: Date[] }) {
  const { t } = useTranslation('crm');
  const first = days[0] ?? new Date();
  const last = days[days.length - 1] ?? first;
  const from = toLocalIsoDate(first);
  // API window is [from, to) — pass the day after the last visible column.
  const to = toLocalIsoDate(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));

  const { data, isLoading, isError, refetch } = useCalendarDeadlines(from, to);

  const laneLabel = (
    <div className="flex items-start justify-end pr-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
      {t('calendar.deadlinesLane', 'Due')}
    </div>
  );

  if (isLoading) {
    return (
      <div
        className={LANE_GRID}
        role="status"
        aria-label={t('calendar.deadlinesLoading', 'Loading deadlines…')}
      >
        {laneLabel}
        {days.map((day) => (
          <div key={toLocalIsoDate(day)} className="border-l border-[var(--border-subtle)] p-1">
            <div className="h-9 animate-pulse rounded-md bg-[var(--surface-sunken)]" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className={LANE_GRID}>
        {laneLabel}
        <div role="alert" className="col-span-7 flex items-center gap-3 px-2 py-1">
          <span className="text-xs text-[var(--danger)]">
            {t('calendar.deadlinesError', 'Could not load deadlines.')}
          </span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="min-h-[44px] rounded-lg px-3 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {t('calendar.deadlinesRetry', 'Retry')}
          </button>
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className={LANE_GRID}>
        {laneLabel}
        <div className="col-span-7 flex items-center px-2 py-2">
          <span className="text-xs text-[var(--fg-muted)]">
            {t('calendar.deadlinesEmpty', 'No bid or proposal deadlines this week.')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={LANE_GRID}>
      {laneLabel}
      {days.map((day) => {
        const iso = toLocalIsoDate(day);
        const dayItems = items.filter((d) => d.dueDate === iso);
        return (
          <div
            key={iso}
            data-date={iso}
            className="flex min-h-[28px] flex-col gap-1 border-l border-[var(--border-subtle)] p-1"
          >
            {dayItems.map((d) => (
              <DeadlineChip key={`${d.kind}-${d.id}`} deadline={d} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
