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

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

// ─── Types ─────────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  subject: string;
  startAt: string;
  endAt: string;
  location: string | null;
  isAllDay: boolean;
  syncState: string;
  provider: string;
  createdAt: string;
}

interface CreateEventBody {
  subject: string;
  startAt: string;
  endAt: string;
  location?: string;
  bodyPreview?: string;
  provider?: 'google_workspace' | 'microsoft_graph';
}

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

function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/api/v1/calendar/events/${id}`, { method: 'DELETE' }),
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
  return d.toISOString().slice(0, 10);
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const PROVIDER_COLORS: Record<string, string> = {
  google_workspace: 'bg-blue-500/80 dark:bg-blue-600/80',
  microsoft_graph: 'bg-purple-500/80 dark:bg-purple-600/80',
};

// ─── Create Event Modal ────────────────────────────────────────────────────

interface CreateEventModalProps {
  initialDate?: Date;
  onClose: () => void;
  onSave: (body: CreateEventBody) => void;
  loading: boolean;
}

function CreateEventModal({ initialDate, onClose, onSave, loading }: CreateEventModalProps) {
  const baseDate = initialDate ?? new Date();
  const baseDateStr = toIso(baseDate);
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState(baseDateStr);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [location, setLocation] = useState('');
  const [provider, setProvider] = useState<'google_workspace' | 'microsoft_graph'>('google_workspace');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      subject,
      startAt: `${date}T${startTime}:00Z`,
      endAt: `${date}T${endTime}:00Z`,
      location: location || undefined,
      provider,
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create calendar event"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-(--color-surface) rounded-2xl p-6 shadow-xl w-full max-w-md mx-4 focus:outline-none">
        <h2 className="text-lg font-semibold mb-4 text-(--color-text-primary)">New event</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="evt-subject" className="block text-sm font-medium text-(--color-text-secondary) mb-1">
              Title
            </label>
            <input
              id="evt-subject"
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
              placeholder="Event title"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="evt-date" className="block text-sm font-medium text-(--color-text-secondary) mb-1">Date</label>
              <input id="evt-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)" />
            </div>
            <div>
              <label htmlFor="evt-provider" className="block text-sm font-medium text-(--color-text-secondary) mb-1">Calendar</label>
              <select id="evt-provider" value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)">
                <option value="google_workspace">Google</option>
                <option value="microsoft_graph">Microsoft</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="evt-start" className="block text-sm font-medium text-(--color-text-secondary) mb-1">Start</label>
              <input id="evt-start" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)" />
            </div>
            <div>
              <label htmlFor="evt-end" className="block text-sm font-medium text-(--color-text-secondary) mb-1">End</label>
              <input id="evt-end" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)" />
            </div>
          </div>

          <div>
            <label htmlFor="evt-location" className="block text-sm font-medium text-(--color-text-secondary) mb-1">Location (optional)</label>
            <input id="evt-location" type="text" value={location} onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text-primary) focus:outline-none focus:ring-2 focus:ring-(--color-accent)"
              placeholder="Room, Zoom link, address…" />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium text-(--color-text-secondary) hover:bg-(--color-surface-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent)">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium bg-(--color-accent) text-white hover:bg-(--color-accent-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-2 disabled:opacity-50">
              {loading ? 'Saving…' : 'Create event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export function CalendarPage() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [showModal, setShowModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [providerFilter, setProviderFilter] = useState<'all' | 'google_workspace' | 'microsoft_graph'>('all');

  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);
  const weekStart = weekDays[0] ?? anchor;
  const weekEnd = weekDays[6] ?? weekStart;
  const from = weekStart.toISOString();
  const to = new Date(weekEnd.getTime() + 86_400_000).toISOString();

  const { data, isLoading, isError } = useCalendarEvents(from, to);
  const createEvent = useCreateEvent();
  const _deleteEvent = useDeleteEvent();

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
      return (
        toIso(start) === toIso(day) && start.getUTCHours() === hour
      );
    });
  }

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const todayStr = toIso(new Date());

  return (
    <div className="flex flex-col h-full bg-(--color-bg) text-(--color-text-primary)">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-(--color-border)">
        <button onClick={prevWeek} aria-label="Previous week"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-(--color-surface-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent) text-(--color-text-secondary)">
          ‹
        </button>
        <button onClick={goToday}
          className="min-h-[44px] px-3 py-1 rounded-lg text-sm font-medium hover:bg-(--color-surface-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent)">
          Today
        </button>
        <button onClick={nextWeek} aria-label="Next week"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-(--color-surface-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent) text-(--color-text-secondary)">
          ›
        </button>

        <span className="flex-1 text-sm font-semibold text-(--color-text-primary)">
          {weekDays[0] && weekDays[6] ? `${formatDate(weekDays[0].toISOString())} – ${formatDate(weekDays[6].toISOString())}` : ''}
        </span>

        {/* Provider filter */}
        <div role="group" aria-label="Calendar filter" className="flex gap-2">
          {(['all', 'google_workspace', 'microsoft_graph'] as const).map((p) => (
            <button key={p}
              onClick={() => setProviderFilter(p)}
              aria-pressed={providerFilter === p}
              className={`min-h-[44px] px-3 py-1 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-(--color-accent) transition-colors ${
                providerFilter === p
                  ? 'bg-(--color-accent) text-white'
                  : 'bg-(--color-surface) text-(--color-text-secondary) hover:bg-(--color-surface-hover)'
              }`}>
              {p === 'all' ? 'All' : p === 'google_workspace' ? 'Google' : 'Microsoft'}
            </button>
          ))}
        </div>

        <button onClick={() => { setSelectedDate(undefined); setShowModal(true); }}
          className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-semibold bg-(--color-accent) text-white hover:bg-(--color-accent-hover) focus:outline-none focus:ring-2 focus:ring-(--color-accent) focus:ring-offset-2">
          + New event
        </button>
      </div>

      {/* Week grid */}
      {isLoading && (
        <div role="status" aria-live="polite" className="flex-1 flex items-center justify-center text-(--color-text-secondary) text-sm">
          Loading calendar…
        </div>
      )}
      {isError && (
        <div role="alert" className="flex-1 flex items-center justify-center text-red-500 text-sm">
          Failed to load calendar events.
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
                <div key={iso} className={`h-12 flex flex-col items-center justify-center text-xs font-medium
                  ${isToday ? 'text-(--color-accent)' : 'text-(--color-text-secondary)'}`}>
                  <span>{DAY_LABELS[i]}</span>
                  <span className={`text-sm font-bold mt-0.5 w-7 h-7 flex items-center justify-center rounded-full
                    ${isToday ? 'bg-(--color-accent) text-white' : ''}`}>
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Hour rows */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)]">
            {HOURS.map((hour) => (
              <>
                <div key={`hr-${hour}`} className="text-right pr-2 text-xs text-(--color-text-tertiary) pt-1 border-t border-(--color-border) h-16">
                  {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
                </div>
                {weekDays.map((day) => {
                  const dayHourEvents = getEventsForDayHour(day, hour);
                  return (
                    <div key={`${toIso(day)}-${hour}`}
                      className="border-t border-l border-(--color-border) h-16 relative cursor-pointer hover:bg-(--color-surface-hover)/30"
                      onClick={() => {
                        const d = new Date(day);
                        d.setUTCHours(hour);
                        setSelectedDate(d);
                        setShowModal(true);
                      }}>
                      {dayHourEvents.map((ev) => (
                        <div key={ev.id}
                          title={ev.subject}
                          className={`absolute inset-x-0.5 top-0.5 rounded px-1 py-0.5 text-xs text-white truncate
                            ${PROVIDER_COLORS[ev.provider] ?? 'bg-gray-400'}
                            ${ev.syncState === 'CONFLICT' ? 'ring-2 ring-yellow-400' : ''}
                            ${ev.syncState === 'PENDING_PUSH' ? 'opacity-70 italic' : ''}`}>
                          {ev.syncState === 'CONFLICT' && <span aria-label="Sync conflict" title="Sync conflict">⚠ </span>}
                          {ev.subject}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <CreateEventModal
          initialDate={selectedDate}
          onClose={() => setShowModal(false)}
          loading={createEvent.isPending}
          onSave={async (body) => {
            await createEvent.mutateAsync(body);
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}
