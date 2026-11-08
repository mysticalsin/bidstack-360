import { describe, expect, it } from 'vitest';

import {
  addDays,
  dayKey,
  eventDaySpan,
  groupAgenda,
  layoutLane,
  layoutTimed,
  timeZoneChoices,
  weekKeys,
  zonedMidnight,
} from './layout';
import type { CalendarEvent } from './types';

const TZ = 'America/Toronto';

function ev(id: string, startAt: string, endAt: string, isAllDay = false): CalendarEvent {
  return {
    id,
    subject: id,
    startAt,
    endAt,
    location: null,
    isAllDay,
    syncState: 'SYNCED',
    provider: 'google_workspace',
    createdAt: startAt,
    contactId: null,
    companyId: null,
    opportunityId: null,
    localOnly: false,
  };
}

describe('day keys and boundaries', () => {
  it('buckets an evening Toronto meeting on its Toronto day, not the UTC day', () => {
    // 21:30 Toronto on 9 Nov = 02:30 UTC on 10 Nov.
    expect(dayKey(new Date('2026-11-10T02:30:00Z'), TZ)).toBe('2026-11-09');
    expect(dayKey(new Date('2026-11-10T02:30:00Z'), 'Europe/Paris')).toBe('2026-11-10');
  });

  it('starts the Toronto day at the right instant on both sides of DST', () => {
    expect(zonedMidnight('2026-07-01', TZ).toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(zonedMidnight('2026-12-01', TZ).toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });

  it('builds a Monday-first week', () => {
    expect(weekKeys('2026-11-11')).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('offers the user time zone and Toronto, once each', () => {
    expect(timeZoneChoices('Europe/Paris')).toEqual(['Europe/Paris', TZ]);
    expect(timeZoneChoices(TZ)).toEqual([TZ]);
  });
});

describe('layoutTimed', () => {
  it('draws events at their wall-clock row on the 25-hour fall-back day', () => {
    // 1 Nov 2026: Toronto falls back at 02:00. 14:00 EST = 19:00 UTC.
    const [fallBack] = layoutTimed([ev('a', '2026-11-01T19:00:00Z', '2026-11-01T20:00:00Z')], '2026-11-01', TZ);
    expect(fallBack).toMatchObject({ startMin: 14 * 60, endMin: 15 * 60 });
    // 8 Mar 2026: springs forward at 02:00. 14:00 EDT = 18:00 UTC.
    const [springForward] = layoutTimed([ev('b', '2026-03-08T18:00:00Z', '2026-03-08T19:00:00Z')], '2026-03-08', TZ);
    expect(springForward).toMatchObject({ startMin: 14 * 60, endMin: 15 * 60 });
  });

  it('places overlapping events side by side so their text never overlaps', () => {
    const blocks = layoutTimed(
      [
        ev('a', '2026-11-09T14:00:00Z', '2026-11-09T15:00:00Z'),
        ev('b', '2026-11-09T14:30:00Z', '2026-11-09T15:30:00Z'),
        ev('c', '2026-11-09T14:45:00Z', '2026-11-09T15:00:00Z'),
        ev('d', '2026-11-09T16:00:00Z', '2026-11-09T17:00:00Z'),
      ],
      '2026-11-09',
      TZ,
    );
    const byId = Object.fromEntries(blocks.map((b) => [b.event.id, b]));
    expect(byId.a).toMatchObject({ startMin: 9 * 60, endMin: 10 * 60, col: 0, cols: 3 });
    expect(byId.b).toMatchObject({ col: 1, cols: 3 });
    expect(byId.c).toMatchObject({ col: 2, cols: 3 });
    // A later event outside the cluster gets the full width back.
    expect(byId.d).toMatchObject({ col: 0, cols: 1 });
  });

  it('reuses a free column inside a cluster', () => {
    const blocks = layoutTimed(
      [
        ev('long', '2026-11-09T14:00:00Z', '2026-11-09T17:00:00Z'),
        ev('first', '2026-11-09T14:00:00Z', '2026-11-09T15:00:00Z'),
        ev('second', '2026-11-09T15:00:00Z', '2026-11-09T16:00:00Z'),
      ],
      '2026-11-09',
      TZ,
    );
    const second = blocks.find((b) => b.event.id === 'second');
    expect(second).toMatchObject({ col: 1, cols: 2 });
  });

  it('clips an overnight meeting to each day it touches', () => {
    const late = ev('late', '2026-11-10T03:00:00Z', '2026-11-10T06:00:00Z'); // 22:00 to 01:00 Toronto
    const first = layoutTimed([late], '2026-11-09', TZ)[0];
    const second = layoutTimed([late], '2026-11-10', TZ)[0];
    expect(first).toMatchObject({ startMin: 22 * 60, endMin: 24 * 60 });
    expect(second).toMatchObject({ startMin: 0, endMin: 60 });
  });

  it('gives very short events a readable minimum height', () => {
    const [b] = layoutTimed([ev('blip', '2026-11-09T14:00:00Z', '2026-11-09T14:05:00Z')], '2026-11-09', TZ);
    expect((b?.endMin ?? 0) - (b?.startMin ?? 0)).toBeGreaterThanOrEqual(20);
  });

  it('keeps all-day and multi-day events out of the hour grid', () => {
    expect(
      layoutTimed(
        [ev('allday', '2026-11-09T00:00:00Z', '2026-11-10T00:00:00Z', true), ev('trip', '2026-11-09T12:00:00Z', '2026-11-11T12:00:00Z')],
        '2026-11-09',
        TZ,
      ),
    ).toEqual([]);
  });
});

describe('all-day lane', () => {
  it('keeps an all-day date in every time zone', () => {
    const holiday = ev('holiday', '2026-11-11T00:00:00Z', '2026-11-12T00:00:00Z', true);
    expect(eventDaySpan(holiday, TZ)).toEqual(['2026-11-11', '2026-11-11']);
    expect(eventDaySpan(holiday, 'Asia/Tokyo')).toEqual(['2026-11-11', '2026-11-11']);
  });

  it('spans multi-day events across columns and stacks overlaps in rows', () => {
    const keys = weekKeys('2026-11-09');
    const segs = layoutLane(
      [
        ev('offsite', '2026-11-10T00:00:00Z', '2026-11-13T00:00:00Z', true),
        ev('bid', '2026-11-11T00:00:00Z', '2026-11-12T00:00:00Z', true),
        ev('carry', '2026-11-05T00:00:00Z', '2026-11-10T00:00:00Z', true),
      ],
      keys,
      TZ,
    );
    const byId = Object.fromEntries(segs.map((s) => [s.event.id, s]));
    expect(byId.offsite).toMatchObject({ startCol: 1, span: 3, row: 0 });
    expect(byId.bid).toMatchObject({ startCol: 2, span: 1, row: 1 });
    expect(byId.carry).toMatchObject({ startCol: 0, span: 1, continuesBefore: true });
  });
});

describe('groupAgenda', () => {
  it('lists each day with all-day events first', () => {
    const days = groupAgenda(
      [
        ev('call', '2026-11-09T15:00:00Z', '2026-11-09T16:00:00Z'),
        ev('allday', '2026-11-09T00:00:00Z', '2026-11-10T00:00:00Z', true),
        ev('later', '2026-11-12T15:00:00Z', '2026-11-12T16:00:00Z'),
      ],
      weekKeys('2026-11-09'),
      TZ,
    );
    expect(days.map((d) => [d.key, d.events.map((e) => e.id)])).toEqual([
      ['2026-11-09', ['allday', 'call']],
      ['2026-11-12', ['later']],
    ]);
  });
});
