import { describe, expect, it } from 'vitest';

import { allDayLengthDays, moveToAllDay, moveToHour } from './eventDrag';
import { eventDaySpan } from './layout';
import type { CalendarEvent } from './types';

function placed(move: { startAt: string; endAt: string; isAllDay: boolean }): CalendarEvent {
  return {
    id: 'x',
    subject: 'Pricing review',
    location: null,
    syncState: 'SYNCED',
    provider: 'google_workspace',
    createdAt: move.startAt,
    contactId: null,
    companyId: null,
    opportunityId: null,
    localOnly: true,
    ...move,
  };
}

const DAY = '2026-11-11';

describe('all-day drop', () => {
  // WHY: the lane buckets an all-day event by the UTC date of its start.
  // A drop on Wednesday that stores Tokyo or Paris midnight is still Tuesday
  // in UTC, so the bar paints on the day before the pointer.
  it.each(['Asia/Tokyo', 'Europe/Paris'])(
    'keeps the aimed day in %s, not the previous UTC date',
    (tz) => {
      const move = moveToAllDay(DAY, 1);
      expect(move.isAllDay).toBe(true);
      expect(move.startAt).toBe('2026-11-11T00:00:00.000Z');
      expect(move.endAt).toBe('2026-11-12T00:00:00.000Z');
      expect(eventDaySpan(placed(move), tz)).toEqual([DAY, DAY]);
    },
  );

  it('keeps a multi-day bar the same length when it moves to another day', () => {
    const span = allDayLengthDays({
      startAt: '2026-11-11T00:00:00.000Z',
      endAt: '2026-11-14T00:00:00.000Z',
      isAllDay: true,
    });
    expect(span).toBe(3);
    const move = moveToAllDay('2026-11-12', span);
    expect(move).toEqual({
      startAt: '2026-11-12T00:00:00.000Z',
      endAt: '2026-11-15T00:00:00.000Z',
      isAllDay: true,
    });
  });

  it('a timed event dropped on the lane covers that one day', () => {
    expect(
      allDayLengthDays({
        startAt: '2026-11-11T00:00:00.000Z',
        endAt: '2026-11-11T01:00:00.000Z',
        isAllDay: false,
      }),
    ).toBe(1);
  });
});

describe('hour drop', () => {
  // WHY: an hour drop is a wall time. Pinning it to UTC midnight would put a
  // 09:00 Tokyo meeting at 09:00 UTC, which is 18:00 in Tokyo.
  it('keeps the wall-clock hour in the calendar time zone', () => {
    const move = moveToHour(
      {
        startAt: '2026-11-10T00:00:00.000Z',
        endAt: '2026-11-10T00:30:00.000Z',
        isAllDay: false,
      },
      DAY,
      9,
      'Asia/Tokyo',
    );
    expect(move.isAllDay).toBe(false);
    expect(move.startAt).toBe('2026-11-11T00:00:00.000Z');
    expect(move.endAt).toBe('2026-11-11T00:30:00.000Z');
  });
});
