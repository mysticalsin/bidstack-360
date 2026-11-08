/**
 * CalendarPage: week, day and agenda views of synced events.
 *
 * Layout lives in ./calendarPage/layout.ts (pure, unit tested): day
 * boundaries come from the selected time zone, overlapping events share the
 * column side by side, and all-day or multi-day events sit in a lane above
 * the hour grid.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/ui/StateMessages';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { AgendaList } from './calendarPage/AgendaList';
import { CreateEventModal } from './calendarPage/CreateEventModal';
import { EventPanel } from './calendarPage/EventPanel';
import {
  addDays,
  dayKey,
  formatDayLabel,
  timeZoneChoices,
  timeZoneLabel,
  userTimeZone,
  weekKeys,
  zonedMidnight,
} from './calendarPage/layout';
import { TimeGrid } from './calendarPage/TimeGrid';
import type { CalendarEvent, CreateEventBody } from './calendarPage/types';

type View = 'week' | 'day' | 'agenda';
type ProviderFilter = 'all' | 'google_workspace' | 'microsoft_graph';
const AGENDA_DAYS = 14;
const PAGE_LIMIT = 200;

function useCalendarEvents(from: string, to: string) {
  return useQuery<{ items: CalendarEvent[] }>({
    queryKey: ['calendar-events', from, to],
    queryFn: () =>
      api(
        `/api/v1/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${PAGE_LIMIT}`,
      ),
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

function rangeKeys(view: View, anchor: string): string[] {
  if (view === 'day') return [anchor];
  if (view === 'week') return weekKeys(anchor);
  return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(anchor, i));
}

const CHIP =
  'min-h-11 px-3 py-1 rounded-lg text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors';
const CHIP_ON = 'bg-[var(--brand-primary)] text-[var(--fg-on-brand)]';
const CHIP_OFF =
  'bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]';
const ICON_BTN =
  'min-h-11 min-w-11 flex items-center justify-center rounded-lg hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] text-[var(--fg-secondary)]';

export function CalendarPage() {
  const { t } = useTranslation('crm');
  const zones = useMemo(() => timeZoneChoices(userTimeZone()), []);
  const [tz, setTz] = useState<string>(() => zones[0] ?? userTimeZone());
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState<string>(() => dayKey(new Date(), tz));
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [showDeadlines, setShowDeadlines] = useState(true);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [draftSlot, setDraftSlot] = useState<{ key?: string; hour?: number } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const keys = useMemo(() => rangeKeys(view, anchor), [view, anchor]);
  const firstKey = keys[0] ?? anchor;
  const lastKey = keys[keys.length - 1] ?? anchor;
  const from = zonedMidnight(firstKey, tz).toISOString();
  const to = zonedMidnight(addDays(lastKey, 1), tz).toISOString();
  const todayKey = dayKey(new Date(), tz);

  const { data, isLoading, isError, refetch } = useCalendarEvents(from, to);
  const createEvent = useCreateEvent();

  const events = useMemo(() => {
    const all = data?.items ?? [];
    return providerFilter === 'all' ? all : all.filter((e) => e.provider === providerFilter);
  }, [data, providerFilter]);

  const step = view === 'day' ? 1 : view === 'week' ? 7 : AGENDA_DAYS;
  const dayOpts = { month: 'short', day: 'numeric', year: 'numeric' } as const;
  const rangeLabel =
    firstKey === lastKey
      ? formatDayLabel(firstKey, { weekday: 'long', ...dayOpts })
      : t('calendar.timeRange', '{{start}} to {{end}}', {
          start: formatDayLabel(firstKey, dayOpts),
          end: formatDayLabel(lastKey, dayOpts),
        });

  const views: Array<[View, string]> = [
    ['week', t('calendar.viewWeek', 'Week')],
    ['day', t('calendar.viewDay', 'Day')],
    ['agenda', t('calendar.viewAgenda', 'Agenda')],
  ];
  const providers: Array<[ProviderFilter, string]> = [
    ['all', t('calendar.providerAll', 'All')],
    ['google_workspace', t('calendar.providerGoogle', 'Google')],
    ['microsoft_graph', t('calendar.providerMicrosoft', 'Microsoft')],
  ];

  return (
    <div className="flex flex-col h-full bg-[var(--surface-page)] text-[var(--fg-primary)]">
      <h1 className="sr-only">{t('calendar.title', 'Calendar')}</h1>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border-default)]">
        <div role="group" aria-label={t('calendar.viewGroup', 'View')} className="flex gap-1">
          {views.map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(CHIP, view === v ? CHIP_ON : CHIP_OFF)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setAnchor((k) => addDays(k, -step))}
            aria-label={t('calendar.previous', 'Previous')}
            className={ICON_BTN}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(dayKey(new Date(), tz))}
            className="min-h-11 px-3 py-1 rounded-lg text-sm font-medium hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {t('calendar.today', 'Today')}
          </button>
          <button
            type="button"
            onClick={() => setAnchor((k) => addDays(k, step))}
            aria-label={t('calendar.next', 'Next')}
            className={ICON_BTN}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>

        {/* A real basis, not bare flex-1, so a narrow toolbar wraps instead of
            squeezing the range label into a one-character column. */}
        <span
          className="min-w-0 flex-1 basis-48 whitespace-nowrap truncate text-sm font-semibold text-[var(--fg-primary)]"
          title={rangeLabel}
          data-testid="calendar-range"
        >
          {rangeLabel}
        </span>

        {zones.length > 1 ? (
          <div role="group" aria-label={t('calendar.timeZone', 'Time zone')} className="flex gap-1">
            {zones.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setTz(z)}
                aria-pressed={tz === z}
                className={cn(CHIP, tz === z ? CHIP_ON : CHIP_OFF)}
              >
                {timeZoneLabel(z)}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-[var(--fg-secondary)]">{timeZoneLabel(tz)}</span>
        )}

        <div role="group" aria-label={t('calendar.filterGroup', 'Calendar filter')} className="flex gap-1">
          {providers.map(([p, label]) => (
            <button
              key={p}
              type="button"
              onClick={() => setProviderFilter(p)}
              aria-pressed={providerFilter === p}
              className={cn(CHIP, providerFilter === p ? CHIP_ON : CHIP_OFF)}
            >
              {label}
            </button>
          ))}
        </div>

        {view !== 'agenda' ? (
          <button
            type="button"
            onClick={() => setShowDeadlines((v) => !v)}
            aria-pressed={showDeadlines}
            className={cn(CHIP, 'inline-flex items-center gap-1.5', showDeadlines ? CHIP_ON : CHIP_OFF)}
          >
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rotate-45 border border-current" />
            {t('calendar.deadlinesToggle', 'Deadlines')}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setDraftSlot({})}
          className="min-h-11 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--brand-primary)] text-[var(--fg-on-brand)] hover:bg-[var(--brand-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
        >
          <Plus size={14} aria-hidden />
          {t('calendar.newEventCta', 'New event')}
        </button>
      </div>

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          aria-label={t('calendar.loading', 'Loading calendar')}
          className="flex-1 px-4 py-3 space-y-2"
          data-testid="calendar-loading"
        >
          {Array.from({ length: 6 }).map((_, row) => (
            <span key={row} aria-hidden className="bs-shimmer block h-10" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex-1">
          <ErrorState
            title={t('calendar.loadError', 'Could not load events')}
            action={
              <button
                type="button"
                onClick={() => void refetch()}
                className={cn(CHIP, CHIP_OFF)}
              >
                {t('calendar.retry', 'Retry')}
              </button>
            }
          />
        </div>
      ) : view === 'agenda' ? (
        <AgendaList keys={keys} tz={tz} events={events} todayKey={todayKey} onSelect={setSelected} />
      ) : (
        <TimeGrid
          keys={keys}
          tz={tz}
          events={events}
          todayKey={todayKey}
          showDeadlines={showDeadlines}
          onSlot={(key, hour) => setDraftSlot({ key, hour })}
          onSelect={setSelected}
        />
      )}

      <EventPanel event={selected} tz={tz} onClose={() => setSelected(null)} />

      {draftSlot ? (
        <CreateEventModal
          initialDayKey={draftSlot.key ?? todayKey}
          initialHour={draftSlot.hour}
          timeZone={tz}
          onClose={() => {
            setDraftSlot(null);
            setCreateError(null);
          }}
          loading={createEvent.isPending}
          error={createError}
          onSave={async (body) => {
            setCreateError(null);
            try {
              await createEvent.mutateAsync(body);
              setDraftSlot(null);
            } catch (err) {
              setCreateError(
                err instanceof Error
                  ? err.message
                  : t('calendar.createError', 'Could not create the event. Try again.'),
              );
            }
          }}
        />
      ) : null}
    </div>
  );
}
