import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimeGrid } from './TimeGrid';
import type { CalendarEvent } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      opts ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts[k] ?? '')) : fallback,
  }),
}));
vi.mock('./DeadlinesRow', () => ({ DeadlinesRow: () => null }));

const KEYS = ['2026-11-10', '2026-11-11'];

function event(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'timed',
    subject: 'Pricing review',
    startAt: '2026-11-11T00:00:00.000Z',
    endAt: '2026-11-11T00:30:00.000Z',
    location: null,
    isAllDay: false,
    syncState: 'SYNCED',
    provider: 'google_workspace',
    createdAt: '2026-11-01T00:00:00.000Z',
    contactId: null,
    companyId: null,
    opportunityId: null,
    localOnly: true,
    ...over,
  };
}

const TIMED = event({});
const HOLIDAY = event({
  id: 'holiday',
  subject: 'Office closed',
  startAt: '2026-11-10T00:00:00.000Z',
  endAt: '2026-11-11T00:00:00.000Z',
  isAllDay: true,
});

function renderGrid(events: CalendarEvent[], onMove = vi.fn(), onSelect = vi.fn()) {
  const view = render(
    <TimeGrid
      keys={KEYS}
      tz="Asia/Tokyo"
      events={events}
      todayKey="2026-11-01"
      showDeadlines={false}
      onSlot={() => {}}
      onSelect={onSelect}
      onMove={onMove}
    />,
  );
  return { ...view, onMove, onSelect };
}

function point(button: HTMLElement, target: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp') {
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => target);
  const coords = type === 'pointerDown' ? { clientX: 0, clientY: 0 } : { clientX: 24, clientY: 12 };
  fireEvent[type](button, { button: 0, pointerId: 1, ...coords });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('calendar drag onto the all-day lane', () => {
  it('a click without a drag still opens the meeting', () => {
    const { onSelect, onMove } = renderGrid([TIMED]);
    fireEvent.click(screen.getByRole('button', { name: /Pricing review/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  // WHY: a demo week in a zone ahead of UTC was saving the viewer's midnight.
  // The bar then painted on the previous day, and the drag itself left no
  // preview, so the drop looked like a click that opened the meeting.
  it('previews the aimed day and saves that UTC date, without opening the meeting', () => {
    const { onMove, onSelect } = renderGrid([HOLIDAY, TIMED]);
    const button = screen.getByRole('button', { name: /Pricing review/ });
    const cell = document.querySelector('[data-drop="all-day"][data-day="2026-11-11"]');
    expect(cell).toBeTruthy();

    point(button, cell as Element, 'pointerDown');
    point(button, cell as Element, 'pointerMove');
    const preview = cell?.querySelector('[data-testid="calendar-drag-preview"]');
    expect(preview?.textContent).toContain('Pricing review');

    point(button, cell as Element, 'pointerUp');
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'timed' }),
      {
        startAt: '2026-11-11T00:00:00.000Z',
        endAt: '2026-11-12T00:00:00.000Z',
        isAllDay: true,
      },
    );
  });

  // WHY: the conflict line is about this row. Once the row is no longer in
  // conflict, the line has to go. A message kept in its own state stays on
  // screen after the demo data has already cleared the conflict.
  it('says when a move fails for a reason other than a conflict', async () => {
    const onMove = vi.fn().mockRejectedValue(new Error('offline'));
    renderGrid([TIMED], onMove);
    const button = screen.getByRole('button', { name: /Pricing review/ });
    const cell = document.querySelector('[data-drop="all-day"][data-day="2026-11-11"]');
    expect(cell).toBeTruthy();
    point(button, cell as Element, 'pointerDown');
    point(button, cell as Element, 'pointerMove');
    point(button, cell as Element, 'pointerUp');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not move the event');
  });

  it('shows a conflict notice on drop and removes it when the row is no longer in conflict', () => {
    const onMove = vi.fn();
    const { rerender } = renderGrid([event({ syncState: 'CONFLICT' })], onMove);
    const button = screen.getByRole('button', { name: /Pricing review/ });
    const cell = document.querySelector('[data-drop="all-day"][data-day="2026-11-11"]');
    expect(cell).toBeTruthy();

    point(button, cell as Element, 'pointerDown');
    point(button, cell as Element, 'pointerMove');
    point(button, cell as Element, 'pointerUp');
    fireEvent.click(button);

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('sync conflict');

    rerender(
      <TimeGrid
        keys={KEYS}
        tz="Asia/Tokyo"
        events={[event({ syncState: 'SYNCED' })]}
        todayKey="2026-11-01"
        showDeadlines={false}
        onSlot={() => {}}
        onSelect={() => {}}
        onMove={onMove}
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();
  });
});
