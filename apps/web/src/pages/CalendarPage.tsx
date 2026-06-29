/**
 * CalendarPage — month/week/day view of synced events with two-way sync support.
 *
 * WHY a custom calendar grid instead of FullCalendar: no additional dep to
 * bundle; the week view is sufficient for BidStack's use case and stays within
 * our 400-line file limit.
 *
 * Features:
 *  - Week view (default) with day/hour grid
 *  - Toggle Google/MS overlay by provider
 *  - "Create event" modal that enqueues a push to the connected calendar
 *  - Conflict indicator badge on events in CONFLICT syncState
 *  - Dark mode supported via CSS variables
 */

import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { CalendarEvent, CreateEventBody } from './calendarPage/types';
import { CreateEventModal } from './calendarPage/CreateEventModal';

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useCalendarEvents(from: string, to: string) {
  return useQuery<{ items: CalendarEvent[] }>({
    queryKey: ['calendar-events', from, to],
    queryFn: () =>
      api(`/api/v1/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    staleTime: 60_000,
  });
}

function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEventBody) =>
      api<CalendarEvent>('/api/v1/calendar/events', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-events'] }),
  });
}

// ─── Calendar helpers ──────────────────────────────────────────────────────

function getWeekDays(anchor: Date): Date[] {
  const days: Date[] = [];
  const start = new Date(anchor);
  // Move to Monday
  const dow = start.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  start.setDate(start.getDate() + diff);
  for (let i = 0; i < 7; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return days;
}

function toIso(d: Date): string {
  // Local Y-M-D, NOT toISOString().slice(0,10): the grid renders local days and
  // hours, so day-bucketing must use the local calendar date. toISOString shifts
  // across midnight for any non-UTC offset, which put events on the wrong day.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const PROVIDER_COLORS: Record<string, string> = {
  google_workspace: 'bg-blue-500/80 dark:bg-blue-600/80',
  microsoft_graph: 'bg-purple-500/80 dark:bg-purple-600/80',
};

// ─── Main page ──────────────────────────────────────────────────────────────

export function CalendarPage() {
  const { t } = useTranslation('crm');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [showModal, setShowModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [providerFilter, setProviderFilter] = useState<
    'all' | 'google_workspace' | 'microsoft_graph'
  >('all');

  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);
  const weekStart = weekDays[0] ?? anchor;
  const weekEnd = weekDays[6] ?? weekStart;
  const from = weekStart.toISOString();
  const to = new Date(weekEnd.getTime() + 86_400_000).toISOString();

  const { data, isLoading, isError } = useCalendarEvents(from, to);
  const createEvent = useCreateEvent();

  const events = useMemo(() => {
    const all = data?.items ?? [];
    if (providerFilter === 'all') return all;
    return all.filter((e) => e.provider === providerFilter);
  }, [data, providerFilter]);

  function prevWeek() {
    setAnchor((d) => new Date(d.getTime() - 7 * 86_400_000));
  }
  function nextWeek() {
    setAnchor((d) => new Date(d.getTime() + 7 * 86_400_000));
  }
  function goToday() {
    setAnchor(new Date());
  }

  function getEventsForDayHour(day: Date, hour: number): CalendarEvent[] {
    return events.filter((ev) => {
      const start = new Date(ev.startAt);
      // Local hour — the hour rows are labelled as local time, so an event at
      // 14:00 local must land in the 14:00 row regardless of UTC offset.
      return toIso(start) === toIso(day) && start.getHours() === hour;
    });
  }

  const DAY_LABELS = [
    t('calendar.dayMon', 'Mon'),
    t('calendar.dayTue', 'Tue'),
    t('calendar.dayWed', 'Wed'),
    t('calendar.dayThu', 'Thu'),
    t('calendar.dayFri', 'Fri'),
    t('calendar.daySat', 'Sat'),
    t('calendar.daySun', 'Sun'),
  ];
  const todayStr = toIso(new Date());

  return (
    <div className="flex flex-col h-full bg-(--color-bg) text-(--color-text-primary)">
      {/* Page landmark heading (the visible date label below is a styled span). */}
      <h1 className="sr-only">{t('calendar.title', 'Calendar')}</h1>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-(--color-border)">
        <button
          onClick={prevWeek}
          aria-label={t('calendar.previousWeek', 'Previous week')}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-(--color-surface-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent) text-(--color-text-secondary)"
        >
          ‹
        </button>
        <button
          onClick={goToday}
          className="min-h-[44px] px-3 py-1 rounded-lg text-sm font-medium hover:bg-(--color-surface-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
        >
          {t('calendar.today', 'Today')}
        </button>
        <button
          onClick={nextWeek}
          aria-label={t('calendar.nextWeek', 'Next week')}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-(--color-surface-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent) text-(--color-text-secondary)"
        >
          ›
        </button>

        <span className="flex-1 text-sm font-semibold text-(--color-text-primary)">
          {weekDays[0] && weekDays[6]
            ? `${formatDate(weekDays[0].toISOString())} – ${formatDate(weekDays[6].toISOString())}`
            : ''}
        </span>

        {/* Provider filter */}
        <div role="group" aria-label={t('calendar.filterGroup', 'Calendar filter')} className="flex gap-2">
          {(['all', 'google_workspace', 'microsoft_graph'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProviderFilter(p)}
              aria-pressed={providerFilter === p}
              className={`min-h-[44px] px-3 py-1 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-(--color-accent) transition-colors ${
                providerFilter === p
                  ? 'bg-(--color-accent) text-white'
                  : 'bg-(--color-surface) text-(--color-text-secondary) hover:bg-(--color-surface-hover)'
              }`}
            >
              {p === 'all'
                ? t('calendar.providerAll', 'All')
                : p === 'google_workspace'
                  ? t('calendar.providerGoogle', 'Google')
                  : t('calendar.providerMicrosoft', 'Microsoft')}
            </button>
          ))}
        </div>

        <button
          onClick={() => {
            setSelectedDate(undefined);
            setShowModal(true);
          }}
          className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold bg-(--color-accent) text-white hover:bg-(--color-accent-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-2"
        >
          {t('calendar.newEvent', '+ New event')}
        </button>
      </div>

      {/* Week grid */}
      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="flex-1 flex items-center justify-center text-(--color-text-secondary) text-sm"
        >
          {t('calendar.loading', 'Loading calendar…')}
        </div>
      )}
      {isError && (
        <div role="alert" className="flex-1 flex items-center justify-center text-red-500 text-sm">
          {t('calendar.loadError', 'Failed to load calendar events.')}
        </div>
      )}
      {!isLoading && !isError && (
        <div className="flex-1 overflow-auto">
          {/* Day headers */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-(--color-border) sticky top-0 bg-(--color-bg) z-10">
            <div className="h-12" aria-hidden="true" />
            {weekDays.map((day, i) => {
              const iso = toIso(day);
              const isToday = iso === todayStr;
              return (
                <div
                  key={iso}
                  className={`h-12 flex flex-col items-center justify-center text-xs font-medium
                  ${isToday ? 'text-(--color-accent)' : 'text-(--color-text-secondary)'}`}
                >
                  <span>{DAY_LABELS[i]}</span>
                  <span
                    className={`text-sm font-bold mt-0.5 w-7 h-7 flex items-center justify-center rounded-full
                    ${isToday ? 'bg-(--color-accent) text-white' : ''}`}
                  >
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Hour rows */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)]">
            {HOURS.map((hour) => (
              // WHY: Fragment must carry the key here — inner divs also have keys
              // but React reconciles at the Fragment boundary first.
              <Fragment key={`hour-${hour}`}>
                <div className="text-right pr-2 text-xs text-(--color-text-tertiary) pt-1 border-t border-(--color-border) h-16">
                  {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
                </div>
                {weekDays.map((day) => {
                  const dayHourEvents = getEventsForDayHour(day, hour);
                  const openSlot = () => {
                    const d = new Date(day);
                    // Local hour so the new event starts at the clicked slot's
                    // wall-clock time, matching how the grid is rendered.
                    d.setHours(hour, 0, 0, 0);
                    setSelectedDate(d);
                    setShowModal(true);
                  };
                  const slotLabel = t('calendar.slotLabel', 'New event {{date}} at {{time}}', {
                    date: day.toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    }),
                    time: `${String(hour).padStart(2, '0')}:00`,
                  });
                  return (
                    // Keyboard-reachable slot: a real button so Tab focuses it
                    // and Enter/Space activate it — the old click-only div was
                    // invisible to keyboard and screen-reader users.
                    <button
                      type="button"
                      key={`${toIso(day)}-${hour}`}
                      aria-label={slotLabel}
                      className="border-t border-l border-(--color-border) h-16 relative cursor-pointer text-left w-full hover:bg-(--color-surface-hover)/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--color-accent)"
                      onClick={openSlot}
                    >
                      {dayHourEvents.map((ev) => (
                        <span
                          key={ev.id}
                          title={ev.subject}
                          className={`absolute inset-x-0.5 top-0.5 rounded px-1 py-0.5 text-xs text-white truncate block
                            ${PROVIDER_COLORS[ev.provider] ?? 'bg-gray-400'}
                            ${ev.syncState === 'CONFLICT' ? 'ring-2 ring-yellow-400' : ''}
                            ${ev.syncState === 'PENDING_PUSH' ? 'opacity-70 italic' : ''}`}
                        >
                          {ev.syncState === 'CONFLICT' && (
                            <span
                              aria-label={t('calendar.syncConflict', 'Sync conflict')}
                              title={t('calendar.syncConflict', 'Sync conflict')}
                            >
                              ⚠{' '}
                            </span>
                          )}
                          {ev.subject}
                        </span>
                      ))}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <CreateEventModal
          initialDate={selectedDate}
          onClose={() => {
            setShowModal(false);
            setCreateError(null);
          }}
          loading={createEvent.isPending}
          error={createError}
          onSave={async (body) => {
            // Without this catch the rejection was unhandled and the failure
            // was completely invisible to the user.
            setCreateError(null);
            try {
              await createEvent.mutateAsync(body);
              setShowModal(false);
            } catch (err) {
              setCreateError(
                err instanceof Error
                  ? err.message
                  : t('calendar.createError', 'Could not create the event. Try again.'),
              );
            }
          }}
        />
      )}
    </div>
  );
}
