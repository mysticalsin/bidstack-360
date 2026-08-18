/**
 * CalendarPage — month/week/day view of synced events with two-way sync support.
 *
 * WHY a custom calendar grid instead of FullCalendar: no additional dep to
 * bundle; the week view is sufficient for Polo PreSales's use case and stays within
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

import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { CalendarEvent, CreateEventBody } from './calendarPage/types';
import { CreateEventModal } from './calendarPage/CreateEventModal';
import { DeadlinesRow } from './calendarPage/DeadlinesRow';
import { toLocalIsoDate as toIso } from './calendarPage/dateUtils';

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

// toIso (local Y-M-D bucketing) moved to ./calendarPage/dateUtils.ts so the
// deadlines lane buckets chips onto the same local days as the event grid.

const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Solid 600-weight fills: white 12px chip text needs ≥4.5:1 — blue-600 (5.2:1)
// and purple-600 (5.4:1) pass in both themes; the old 500/80 alphas didn't.
const PROVIDER_COLORS: Record<string, string> = {
  google_workspace: 'bg-blue-600',
  microsoft_graph: 'bg-purple-600',
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
  // Deadlines lane defaults ON — surfacing the bid clock is the point.
  const [showDeadlines, setShowDeadlines] = useState(true);

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
    <div className="flex flex-col h-full bg-[var(--surface-page)] text-[var(--fg-primary)]">
      {/* Page landmark heading (the visible date label below is a styled span). */}
      <h1 className="sr-only">{t('calendar.title', 'Calendar')}</h1>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border-default)]">
        <button
          onClick={prevWeek}
          aria-label={t('calendar.previousWeek', 'Previous week')}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] text-[var(--fg-secondary)]"
        >
          <Icon name="chevron-right" size={16} className="rotate-180" />
        </button>
        <button
          onClick={goToday}
          className="min-h-[44px] px-3 py-1 rounded-lg text-sm font-medium hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
        >
          {t('calendar.today', 'Today')}
        </button>
        <button
          onClick={nextWeek}
          aria-label={t('calendar.nextWeek', 'Next week')}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-[var(--surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] text-[var(--fg-secondary)]"
        >
          <Icon name="chevron-right" size={16} />
        </button>

        {/* basis-48 + nowrap, not bare flex-1: `flex-1` resolves flex-basis
            to 0, so on a narrow viewport the 44px nav buttons and the filter
            group (all min-width:auto, none shrinkable) took the whole row and
            this label collapsed to a 31px column, wrapping the date range one
            character per line. A real basis makes the row wrap instead, and
            nowrap keeps "Aug 17, 2026 – Aug 23, 2026" on one line. */}
        <span className="min-w-0 flex-1 basis-48 whitespace-nowrap text-sm font-semibold text-[var(--fg-primary)]">
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
              className={`min-h-[44px] px-3 py-1 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] transition-colors ${
                providerFilter === p
                  ? 'bg-[var(--brand-primary)] text-[var(--fg-on-brand)]'
                  : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
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

        {/* Deadlines lane toggle. Real theme tokens (not the page's legacy
            --color-* vars) so active/inactive states render in both modes. */}
        <button
          onClick={() => setShowDeadlines((v) => !v)}
          aria-pressed={showDeadlines}
          className={`min-h-[44px] inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] transition-colors ${
            showDeadlines
              ? 'bg-[var(--brand-primary)] text-[var(--fg-on-brand)]'
              : 'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
          }`}
        >
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rotate-45 border border-current"
          />
          {t('calendar.deadlinesToggle', 'Deadlines')}
        </button>

        <button
          onClick={() => {
            setSelectedDate(undefined);
            setShowModal(true);
          }}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--brand-primary)] text-[var(--fg-on-brand)] hover:bg-[var(--brand-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] focus:ring-offset-2"
        >
          {/* New i18n key: the old calendar.newEvent locale value baked a "+"
              glyph into the label; the SVG plus below replaces it. */}
          <Icon name="plus" size={14} />
          {t('calendar.newEventCta', 'New event')}
        </button>
      </div>

      {/* Week grid */}
      {isLoading && (
        // Shimmer skeleton shaped like the week grid (shared bs-shimmer
        // system) — not a bare "Loading…" string.
        <div
          role="status"
          aria-live="polite"
          aria-label={t('calendar.loading', 'Loading calendar…')}
          className="flex-1 px-4 py-3 space-y-2"
        >
          <div className="grid grid-cols-[56px_repeat(7,1fr)] gap-2" aria-hidden>
            <span />
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className="bs-shimmer h-10" />
            ))}
          </div>
          {Array.from({ length: 6 }).map((_, row) => (
            <div key={row} className="grid grid-cols-[56px_repeat(7,1fr)] gap-2" aria-hidden>
              <span className="bs-shimmer h-8 w-10 justify-self-end" />
              {Array.from({ length: 7 }).map((_, col) => (
                <span key={col} className="bs-shimmer h-8" />
              ))}
            </div>
          ))}
        </div>
      )}
      {isError && (
        <div
          role="alert"
          className="flex-1 flex items-center justify-center text-[var(--danger)] text-sm"
        >
          {t('calendar.loadError', 'Failed to load calendar events.')}
        </div>
      )}
      {!isLoading && !isError && (
        <div className="flex-1 overflow-auto">
          {/* Day headers */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-[var(--border-default)] sticky top-0 bg-[var(--surface-page)] z-10">
            <div className="h-12" aria-hidden="true" />
            {weekDays.map((day, i) => {
              const iso = toIso(day);
              const isToday = iso === todayStr;
              return (
                <div
                  key={iso}
                  className={`h-12 flex flex-col items-center justify-center text-xs font-medium
                  ${isToday ? 'text-[var(--brand-primary)]' : 'text-[var(--fg-secondary)]'}`}
                >
                  <span>{DAY_LABELS[i]}</span>
                  <span
                    className={`text-sm font-bold mt-0.5 w-7 h-7 flex items-center justify-center rounded-full
                    ${isToday ? 'bg-[var(--brand-primary)] text-[var(--fg-on-brand)]' : ''}`}
                  >
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* All-day deadlines lane — bid/proposal due dates, distinct from
              timed meeting bars. Toggleable from the toolbar. */}
          {showDeadlines && <DeadlinesRow days={weekDays} />}

          {/* Hour rows */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)]">
            {HOURS.map((hour) => (
              // WHY: Fragment must carry the key here — inner divs also have keys
              // but React reconciles at the Fragment boundary first.
              <Fragment key={`hour-${hour}`}>
                <div className="text-right pr-2 text-xs text-[var(--fg-tertiary)] pt-1 border-t border-[var(--border-subtle)] h-16">
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
                      className="border-t border-l border-[var(--border-subtle)] h-16 relative cursor-pointer text-left w-full hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--border-focus)]"
                      onClick={openSlot}
                    >
                      {dayHourEvents.map((ev) => (
                        <span
                          key={ev.id}
                          title={ev.subject}
                          className={`absolute inset-x-0.5 top-0.5 rounded px-1 py-0.5 text-xs text-white truncate block
                            ${PROVIDER_COLORS[ev.provider] ?? 'bg-gray-600'}
                            ${ev.syncState === 'CONFLICT' ? 'ring-2 ring-[var(--warning)]' : ''}
                            ${ev.syncState === 'PENDING_PUSH' ? 'opacity-70 italic' : ''}`}
                        >
                          {ev.syncState === 'CONFLICT' && (
                            <span
                              role="img"
                              aria-label={t('calendar.syncConflict', 'Sync conflict')}
                              title={t('calendar.syncConflict', 'Sync conflict')}
                              className="inline-flex align-text-bottom mr-0.5"
                            >
                              <Icon name="warning" size={12} strokeWidth={2.25} />
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
