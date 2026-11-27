/** calendarPage/AgendaList.tsx — upcoming events grouped by day. */
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';

import { EmptyState } from '@/components/ui/StateMessages';
import type { CalendarDeadline } from '@/hooks/useCalendarDeadlines';
import { cn } from '@/lib/cn';

import { DeadlineChip } from './DeadlineJump';
import { formatDayLabel, formatTime, groupAgenda } from './layout';
import { eventFill } from './eventFill';
import type { CalendarEvent } from './types';

interface AgendaListProps {
  keys: string[];
  tz: string;
  events: CalendarEvent[];
  todayKey: string;
  onSelect: (ev: CalendarEvent) => void;
  /** Shown when this range has no bid deadlines but one sits outside it. */
  deadlineJump?: ReactNode;
  deadlines?: CalendarDeadline[];
  deadlinesState?: 'loading' | 'error' | 'ready';
  onRetryDeadlines?: () => void;
}

export function AgendaList({
  keys,
  tz,
  events,
  todayKey,
  onSelect,
  deadlineJump,
  deadlines,
  deadlinesState = 'ready',
  onRetryDeadlines,
}: AgendaListProps) {
  const { t } = useTranslation('crm');
  const days = useMemo(() => groupAgenda(events, keys, tz), [events, keys, tz]);
  const deadlineItems = deadlines ?? [];

  if (days.length === 0 && deadlinesState === 'loading') {
    return (
      <div
        role="status"
        aria-label={t('calendar.deadlinesLoading', 'Loading deadlines…')}
        className="flex-1 px-4 py-3"
        data-testid="calendar-agenda"
      >
        <span aria-hidden className="bs-shimmer block h-10" />
      </div>
    );
  }

  const deadlineError =
    deadlinesState === 'error' ? (
      <div role="alert" className="mx-auto mb-3 flex max-w-3xl items-center gap-3">
        <span className="text-sm text-[var(--danger)]">
          {t('calendar.deadlinesError', 'Could not load deadlines.')}
        </span>
        {onRetryDeadlines ? (
          <button
            type="button"
            onClick={onRetryDeadlines}
            className="min-h-11 rounded-lg px-3 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {t('calendar.deadlinesRetry', 'Retry')}
          </button>
        ) : null}
      </div>
    ) : null;

  const deadlineList =
    deadlineItems.length > 0 ? (
      <section aria-label={t('calendar.deadlinesLane', 'Due')} className="mx-auto mb-5 max-w-3xl">
        <h2 className="mb-2 text-xs font-semibold text-[var(--fg-secondary)]">
          {t('calendar.deadlinesLane', 'Due')}
        </h2>
        <ul className="space-y-2">
          {deadlineItems.map((deadline) => (
            <li key={`${deadline.kind}-${deadline.id}`} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs tabular-nums text-[var(--fg-secondary)]">
                {formatDayLabel(deadline.dueDate, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <DeadlineChip deadline={deadline} />
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  if (days.length === 0) {
    return (
      <div className="flex-1 overflow-auto p-6" data-testid="calendar-agenda">
        {deadlineError}
        {deadlineList}
        {deadlineItems.length === 0 && deadlinesState !== 'error' ? (
          <EmptyState title={t('calendar.agendaEmpty', 'No events')} action={deadlineJump} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-4 py-3" data-testid="calendar-agenda">
      {deadlineJump ? <div className="mx-auto mb-3 max-w-3xl">{deadlineJump}</div> : null}
      {deadlineError}
      {deadlineList}
      <ol className="mx-auto max-w-3xl space-y-5">
        {days.map((day) => (
          <li key={day.key}>
            <h2
              className={cn(
                'mb-2 text-xs font-semibold',
                day.key === todayKey ? 'text-[var(--fg-primary)]' : 'text-[var(--fg-secondary)]',
              )}
            >
              {day.key === todayKey ? `${t('calendar.today', 'Today')}, ` : ''}
              {formatDayLabel(day.key, { weekday: 'long', month: 'long', day: 'numeric' })}
            </h2>
            <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]">
              {day.events.map((ev) => {
                const when = ev.isAllDay
                  ? t('calendar.allDay', 'All day')
                  : t('calendar.timeRange', '{{start}} to {{end}}', {
                      start: formatTime(ev.startAt, tz),
                      end: formatTime(ev.endAt, tz),
                    });
                return (
                  <li key={ev.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(ev)}
                      title={`${ev.subject}, ${when}`}
                      className="flex min-h-11 w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--border-focus)]"
                    >
                      <span
                        aria-hidden="true"
                        className={cn('h-8 w-1 shrink-0 rounded-full', eventFill(ev))}
                      />
                      <span className="w-28 shrink-0 text-xs tabular-nums text-[var(--fg-secondary)]">
                        {when}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--fg-primary)]">
                          {ev.subject}
                        </span>
                        {ev.location ? (
                          <span className="block truncate text-xs text-[var(--fg-tertiary)]">
                            {ev.location}
                          </span>
                        ) : null}
                      </span>
                      {ev.companyId ? (
                        <Building2
                          size={14}
                          aria-label={t('calendar.linkedAccount', 'Linked to an account')}
                          className="shrink-0 text-[var(--fg-tertiary)]"
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
