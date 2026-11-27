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
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { useCalendarDeadlines } from '@/hooks/useCalendarDeadlines';

import { DeadlineChip, DeadlineJump, jumpTarget } from './DeadlineJump';
import { toLocalIsoDate } from './dateUtils';

const LANE_GRID = 'grid border-b border-[var(--border-subtle)]';

// Same column template as the calendar grid so lane cells align with day columns.
function laneColumns(count: number): CSSProperties {
  return { gridTemplateColumns: `56px repeat(${count}, minmax(0, 1fr))` };
}
const FULL_ROW: CSSProperties = { gridColumn: '2 / -1' };

export function DeadlinesRow({
  days,
  onJumpToDay,
}: {
  days: Date[];
  /** Opens the calendar on a day outside this range. */
  onJumpToDay?: (day: string) => void;
}) {
  const { t } = useTranslation('crm');
  const first = days[0] ?? new Date();
  const last = days[days.length - 1] ?? first;
  const from = toLocalIsoDate(first);
  // API window is [from, to) — pass the day after the last visible column.
  const to = toLocalIsoDate(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));

  const { data, isLoading, isError, refetch } = useCalendarDeadlines(from, to);

  const laneLabel = (
    <div className="flex items-start justify-end pr-2 pt-2 text-xs font-semibold text-[var(--fg-tertiary)]">
      {t('calendar.deadlinesLane', 'Due')}
    </div>
  );

  if (isLoading) {
    return (
      <div
        className={LANE_GRID}
        style={laneColumns(days.length)}
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
      <div className={LANE_GRID} style={laneColumns(days.length)}>
        {laneLabel}
        <div role="alert" style={FULL_ROW} className="flex items-center gap-3 px-2 py-1">
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
    const outside = jumpTarget(data?.nearestAfter, data?.nearestBefore);
    return (
      <div className={LANE_GRID} style={laneColumns(days.length)}>
        {laneLabel}
        <div style={FULL_ROW} className="flex items-center px-2 py-2">
          {outside && onJumpToDay ? (
            <DeadlineJump
              nearestAfter={data?.nearestAfter}
              nearestBefore={data?.nearestBefore}
              onJump={onJumpToDay}
            />
          ) : (
            <span className="text-xs text-[var(--fg-muted)]">
              {t('calendar.deadlinesEmptyRange', 'No deadlines')}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={LANE_GRID} style={laneColumns(days.length)}>
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
