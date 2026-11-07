/**
 * calendarPage/TimeGrid.tsx — week and day views.
 *
 * Timed events are absolutely positioned by start and duration; overlapping
 * events share the column side by side (layoutTimed). All-day and multi-day
 * events sit in a lane above the hours (layoutLane). Every label truncates
 * with an ellipsis and carries the full text in a title tooltip.
 */
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/cn';

import { DeadlinesRow } from './DeadlinesRow';
import {
  dayKey,
  formatDayLabel,
  formatTime,
  keyToLocalDate,
  layoutLane,
  layoutTimed,
  zonedMidnight,
} from './layout';
import { eventFill } from './eventFill';
import type { CalendarEvent } from './types';

const HOUR_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const LANE_ROW_PX = 28;

function columns(count: number): CSSProperties {
  return { gridTemplateColumns: `56px repeat(${count}, minmax(0, 1fr))` };
}

interface TimeGridProps {
  keys: string[];
  tz: string;
  events: CalendarEvent[];
  todayKey: string;
  showDeadlines: boolean;
  onSlot: (key: string, hour: number) => void;
  onSelect: (ev: CalendarEvent) => void;
}

export function TimeGrid({ keys, tz, events, todayKey, showDeadlines, onSlot, onSelect }: TimeGridProps) {
  const { t } = useTranslation('crm');
  const scroller = useRef<HTMLDivElement>(null);
  const lane = useMemo(() => layoutLane(events, keys, tz), [events, keys, tz]);
  const laneRows = lane.reduce((n, s) => Math.max(n, s.row + 1), 0);
  const timed = useMemo(
    () => keys.map((key) => ({ key, blocks: layoutTimed(events, key, tz) })),
    [events, keys, tz],
  );

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX;
  }, []);

  const now = new Date();
  const nowMinutes =
    keys.includes(todayKey) && dayKey(now, tz) === todayKey
      ? (now.getTime() - zonedMidnight(todayKey, tz).getTime()) / 60_000
      : null;

  const timeRange = (ev: CalendarEvent) =>
    ev.isAllDay
      ? t('calendar.allDay', 'All day')
      : t('calendar.timeRange', '{{start}} to {{end}}', {
          start: formatTime(ev.startAt, tz),
          end: formatTime(ev.endAt, tz),
        });

  return (
    <div ref={scroller} className="flex-1 overflow-auto" data-testid="calendar-grid">
      <div
        className="sticky top-0 z-20 grid border-b border-[var(--border-default)] bg-[var(--surface-page)]"
        style={columns(keys.length)}
      >
        <div className="h-12" aria-hidden="true" />
        {keys.map((key) => {
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={cn(
                'flex h-12 min-w-0 flex-col items-center justify-center text-xs font-medium',
                isToday ? 'text-[var(--fg-primary)]' : 'text-[var(--fg-secondary)]',
              )}
            >
              <span className="truncate">{formatDayLabel(key, { weekday: 'short' })}</span>
              <span
                className={cn(
                  'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold',
                  isToday && 'bg-[var(--brand-primary)] text-[var(--fg-on-brand)]',
                )}
              >
                {formatDayLabel(key, { day: 'numeric' })}
              </span>
            </div>
          );
        })}
      </div>

      {laneRows > 0 && (
        <div
          className="grid gap-y-1 border-b border-[var(--border-subtle)] py-1"
          style={{ ...columns(keys.length), gridAutoRows: `${LANE_ROW_PX}px` }}
          data-testid="calendar-all-day"
        >
          <div
            className="flex items-center justify-end pr-2 text-xs text-[var(--fg-tertiary)]"
            style={{ gridColumn: 1, gridRow: `1 / span ${laneRows}` }}
          >
            {t('calendar.allDay', 'All day')}
          </div>
          {lane.map((seg) => (
            <button
              key={seg.event.id}
              type="button"
              title={`${seg.event.subject}, ${timeRange(seg.event)}`}
              onClick={() => onSelect(seg.event)}
              className={cn(
                'mx-0.5 min-w-0 truncate rounded px-2 text-left text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]',
                eventFill(seg.event),
                seg.continuesBefore && 'rounded-l-none',
                seg.continuesAfter && 'rounded-r-none',
              )}
              style={{ gridColumn: `${seg.startCol + 2} / span ${seg.span}`, gridRow: seg.row + 1 }}
            >
              {seg.event.subject}
            </button>
          ))}
        </div>
      )}

      {showDeadlines && <DeadlinesRow days={keys.map(keyToLocalDate)} />}

      <div className="grid" style={columns(keys.length)}>
        <div aria-hidden="true">
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="border-t border-[var(--border-subtle)] pr-2 pt-1 text-right text-xs text-[var(--fg-tertiary)]"
              style={{ height: HOUR_PX }}
            >
              {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
            </div>
          ))}
        </div>
        {timed.map(({ key, blocks }) => (
          <div key={key} className="relative min-w-0 border-l border-[var(--border-subtle)]" data-day={key}>
            {HOURS.map((hour) => (
              <button
                key={hour}
                type="button"
                aria-label={t('calendar.slotLabel', 'New event {{date}} at {{time}}', {
                  date: formatDayLabel(key, { weekday: 'short', month: 'short', day: 'numeric' }),
                  time: `${String(hour).padStart(2, '0')}:00`,
                })}
                onClick={() => onSlot(key, hour)}
                className="block w-full border-t border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--border-focus)]"
                style={{ height: HOUR_PX }}
              />
            ))}
            {blocks.map((b) => {
              const height = ((b.endMin - b.startMin) / 60) * HOUR_PX - 2;
              const label = `${b.event.subject}, ${timeRange(b.event)}`;
              return (
                <button
                  key={b.event.id}
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={() => onSelect(b.event)}
                  data-testid="calendar-event"
                  className={cn(
                    'absolute z-10 flex min-w-0 flex-col overflow-hidden rounded px-1.5 py-0.5 text-left text-xs leading-tight text-white shadow-[var(--shadow-sm)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]',
                    eventFill(b.event),
                    b.event.syncState === 'CONFLICT' && 'ring-2 ring-[var(--warning)]',
                    b.event.syncState === 'PENDING_PUSH' && 'opacity-80',
                  )}
                  style={{
                    top: (b.startMin / 60) * HOUR_PX + 1,
                    height: Math.max(height, 18),
                    left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
                    width: `calc(${100 / b.cols}% - 4px)`,
                  }}
                >
                  <span className="flex min-w-0 items-center gap-1 font-medium">
                    {b.event.syncState === 'CONFLICT' && (
                      <AlertTriangle size={12} aria-hidden="true" className="shrink-0" />
                    )}
                    <span className="truncate">{b.event.subject}</span>
                  </span>
                  {height >= 34 && (
                    <span className="truncate opacity-90">{formatTime(b.event.startAt, tz)}</span>
                  )}
                </button>
              );
            })}
            {nowMinutes !== null && key === todayKey && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-[var(--danger)]"
                style={{ top: (nowMinutes / 60) * HOUR_PX }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
