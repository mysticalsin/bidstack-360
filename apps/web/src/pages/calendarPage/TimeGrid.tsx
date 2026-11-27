/**
 * calendarPage/TimeGrid.tsx — week and day views.
 *
 * Timed events are absolutely positioned by start and duration; overlapping
 * events share the column side by side (layoutTimed). All-day and multi-day
 * events sit in a lane above the hours (layoutLane). Every label truncates
 * with an ellipsis and carries the full text in a title tooltip.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/cn';

import { DeadlinesRow } from './DeadlinesRow';
import { allDayLengthDays, dropTargetFromElement, moveToAllDay, moveToHour, type DropTarget } from './eventDrag';
import {
  dayKey,
  formatDayLabel,
  formatTime,
  keyToLocalDate,
  layoutLane,
  layoutTimed,
  zonedParts,
} from './layout';
import { eventFill } from './eventFill';
import type { CalendarEvent } from './types';

const HOUR_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const LANE_ROW_PX = 28;
/** WCAG 2.5.8 floor for fine pointers; coarse pointers get 44px via pointer-coarse:min-h-11. */
const MIN_EVENT_PX = 24;

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
  /** Persist a drag. A 409 means the row is in sync conflict. */
  onMove?: (ev: CalendarEvent, move: { startAt: string; endAt: string; isAllDay: boolean }) => void | Promise<void>;
}

function isConflictError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 409;
}

export function TimeGrid({ keys, tz, events, todayKey, showDeadlines, onSlot, onSelect, onMove }: TimeGridProps) {
  const { t } = useTranslation('crm');
  const scroller = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; x: number; y: number; moved: boolean; target: DropTarget | null } | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; target: DropTarget } | null>(null);
  const [refusedId, setRefusedId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState(false);
  const refused = events.find((ev) => ev.id === refusedId);
  const showConflict = refused?.syncState === 'CONFLICT';
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
      ? zonedParts(now, tz).hour * 60 + zonedParts(now, tz).minute
      : null;

  const timeRange = (ev: CalendarEvent) =>
    ev.isAllDay
      ? t('calendar.allDay', 'All day')
      : t('calendar.timeRange', '{{start}} to {{end}}', {
          start: formatTime(ev.startAt, tz),
          end: formatTime(ev.endAt, tz),
        });

  const previewEvent = preview ? events.find((ev) => ev.id === preview.id) : undefined;

  function bindDrag(ev: CalendarEvent) {
    return {
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // jsdom does not implement capture. The test dispatches on the button.
        }
        dragRef.current = { id: ev.id, x: e.clientX, y: e.clientY, moved: false, target: null };
        setMoveError(false);
      },
      onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== ev.id) return;
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
          drag.moved = true;
          setDraggingId(ev.id);
        }
        const target = dropTargetFromElement(document.elementFromPoint(e.clientX, e.clientY));
        drag.target = target;
        setPreview(target ? { id: ev.id, target } : null);
      },
      onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== ev.id) return;
        dragRef.current = null;
        setDraggingId(null);
        setPreview(null);
        if (!drag.moved) return;
        suppressClickRef.current = true;
        const target = drag.target ?? dropTargetFromElement(document.elementFromPoint(e.clientX, e.clientY));
        if (!target) return;
        if (ev.syncState === 'CONFLICT') {
          setRefusedId(ev.id);
          return;
        }
        const move =
          target.kind === 'all-day'
            ? moveToAllDay(target.dayKey, allDayLengthDays(ev))
            : moveToHour(ev, target.dayKey, target.hour ?? 0, tz);
        void Promise.resolve(onMove?.(ev, move)).catch((err: unknown) => {
          if (isConflictError(err)) setRefusedId(ev.id);
          else setMoveError(true);
        });
      },
      onClick: (e: MouseEvent<HTMLButtonElement>) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onSelect(ev);
      },
    };
  }

  const laneRowsShown = Math.max(laneRows, 1);

  return (
    <div ref={scroller} className="flex-1 overflow-auto" data-testid="calendar-grid">
      {moveError ? (
        <p role="alert" className="border-b border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--danger)]">
          {t('calendar.moveError', 'Could not move the event. Try again.')}
        </p>
      ) : null}
      {showConflict ? (
        <p
          role="status"
          data-testid="calendar-conflict-notice"
          className="border-b border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--warning)]"
        >
          {t('calendar.moveConflict', 'This event has a sync conflict. Resolve it before moving it.')}
        </p>
      ) : null}
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

      <div
        className="grid gap-y-1 border-b border-[var(--border-subtle)] py-1"
        style={{ ...columns(keys.length), gridAutoRows: `${LANE_ROW_PX}px` }}
        data-testid="calendar-all-day"
      >
        <div
          className="flex items-center justify-end pr-2 text-xs text-[var(--fg-tertiary)]"
          style={{ gridColumn: 1, gridRow: `1 / span ${laneRowsShown}` }}
        >
          {t('calendar.allDay', 'All day')}
        </div>
        {keys.map((key, index) => (
          <div
            key={key}
            data-drop="all-day"
            data-day={key}
            className="relative mx-0.5 min-h-7"
            style={{ gridColumn: index + 2, gridRow: `1 / span ${laneRowsShown}` }}
          >
            {preview?.target.kind === 'all-day' && preview.target.dayKey === key && previewEvent ? (
              <div
                data-testid="calendar-drag-preview"
                className={cn(
                  'pointer-events-none truncate rounded px-2 text-xs font-medium text-white',
                  eventFill(previewEvent),
                )}
              >
                {previewEvent.subject}
              </div>
            ) : null}
          </div>
        ))}
        {lane.map((seg) => (
          <button
            key={seg.event.id}
            type="button"
            title={`${seg.event.subject}, ${timeRange(seg.event)}`}
            aria-grabbed={draggingId === seg.event.id}
            {...bindDrag(seg.event)}
            className={cn(
              'mx-0.5 min-w-0 truncate rounded px-2 text-left text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]',
              eventFill(seg.event),
              seg.continuesBefore && 'rounded-l-none',
              seg.continuesAfter && 'rounded-r-none',
              draggingId && 'pointer-events-none',
            )}
            style={{ gridColumn: `${seg.startCol + 2} / span ${seg.span}`, gridRow: seg.row + 1 }}
          >
            {seg.event.subject}
          </button>
        ))}
      </div>

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
                data-drop="hour"
                data-day={key}
                data-hour={hour}
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
                  aria-grabbed={draggingId === b.event.id}
                  {...bindDrag(b.event)}
                  data-testid="calendar-event"
                  className={cn(
                    'absolute z-10 flex min-w-0 flex-col overflow-hidden rounded pointer-coarse:min-h-11 focus-visible:z-20 px-1.5 py-0.5 text-left text-xs leading-tight text-white shadow-[var(--shadow-sm)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]',
                    eventFill(b.event),
                    b.event.syncState === 'CONFLICT' && 'ring-2 ring-[var(--warning)]',
                    b.event.syncState === 'PENDING_PUSH' && 'opacity-80',
                    draggingId && 'pointer-events-none',
                  )}
                  style={{
                    top: (b.startMin / 60) * HOUR_PX + 1,
                    height: Math.max(height, MIN_EVENT_PX),
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
            {preview?.target.kind === 'hour' && preview.target.dayKey === key && previewEvent ? (
              <div
                data-testid="calendar-drag-preview"
                className={cn(
                  'pointer-events-none absolute inset-x-0.5 z-20 truncate rounded px-1.5 text-xs font-medium text-white',
                  eventFill(previewEvent),
                )}
                style={{ top: (preview.target.hour ?? 0) * HOUR_PX + 1, height: MIN_EVENT_PX }}
              >
                {previewEvent.subject}
              </div>
            ) : null}
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
