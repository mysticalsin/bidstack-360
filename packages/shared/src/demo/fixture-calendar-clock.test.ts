import { describe, expect, it } from 'vitest';

import {
  FIXTURE_CALENDAR_EVENTS,
  calendarRowsForWindow,
  fixtureCalendarMode,
  fixtureCalendarShiftMs,
  projectFixtureCalendarRow,
} from './fixture-calendar-clock.js';

const NOW = new Date('2026-11-27T15:00:00.000Z');
const LATER = new Date('2027-06-15T12:00:00.000Z');
const WEEK_FROM = new Date('2026-11-23T00:00:00.000Z');
const WEEK_TO = new Date('2026-11-30T00:00:00.000Z');
const AGENDA_FROM = new Date('2026-11-27T00:00:00.000Z');
const AGENDA_TO = new Date('2026-12-11T00:00:00.000Z');

function stored(index = 0) {
  const event = FIXTURE_CALENDAR_EVENTS[index]!;
  return {
    id: `row-${index}`,
    clientRequestId: event.clientRequestId,
    startAt: new Date(event.startAt),
    endAt: new Date(event.endAt),
    subject: event.subject,
  };
}

function overlaps(row: { startAt: Date; endAt: Date }, from: Date, to: Date): boolean {
  return row.startAt.getTime() < to.getTime() && row.endAt.getTime() > from.getTime();
}

describe('fixture calendar clock', () => {
  it('moves the earliest fixture meeting onto today and keeps the later gaps', () => {
    // WHY: the week and the 14-day agenda read start_at. Fixture times are a
    // May week. On 2026-11-27 that week is empty, so the demo calendar says
    // there are no events.
    const first = stored(0);
    const second = stored(1);
    const firstStart = first.startAt;
    const gap = second.startAt.getTime() - first.startAt.getTime();

    const projectedFirst = projectFixtureCalendarRow(first, NOW, 'demo');
    const projectedSecond = projectFixtureCalendarRow(second, NOW, 'demo');

    expect(projectedFirst.startAt.toISOString().slice(0, 10)).toBe('2026-11-27');
    expect(projectedFirst.startAt.getUTCHours()).toBe(firstStart.getUTCHours());
    expect(projectedFirst.startAt.getUTCMinutes()).toBe(firstStart.getUTCMinutes());
    expect(projectedFirst.endAt.getTime() - projectedFirst.startAt.getTime()).toBe(
      first.endAt.getTime() - firstStart.getTime(),
    );
    expect(projectedSecond.startAt.getTime() - projectedFirst.startAt.getTime()).toBe(gap);
    expect(first.startAt).toBe(firstStart);

    const rows = FIXTURE_CALENDAR_EVENTS.map((_, i) => stored(i));
    const week = calendarRowsForWindow(rows, { from: WEEK_FROM, to: WEEK_TO }, NOW, 'demo');
    const agenda = calendarRowsForWindow(rows, { from: AGENDA_FROM, to: AGENDA_TO }, NOW, 'demo');
    expect(week.map((row) => row.clientRequestId)).toEqual(
      FIXTURE_CALENDAR_EVENTS.slice(0, 3).map((event) => event.clientRequestId),
    );
    expect(agenda).toHaveLength(FIXTURE_CALENDAR_EVENTS.length);
    expect(agenda.every((row) => overlaps(row, AGENDA_FROM, AGENDA_TO))).toBe(true);
    expect(calendarRowsForWindow(rows, { from: WEEK_FROM, to: WEEK_TO }, NOW, 'real')).toEqual([]);

    expect(fixtureCalendarShiftMs(LATER)).toBeGreaterThan(0);
    expect(projectFixtureCalendarRow(first, LATER, 'demo').startAt.toISOString().slice(0, 10)).toBe(
      '2027-06-15',
    );
  });

  it('does not move a meeting unless the mode is demo and the row is still the seed', () => {
    const row = stored(0);
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo', ''] as const) {
      expect(projectFixtureCalendarRow(row, NOW, mode).startAt).toBe(row.startAt);
      expect(fixtureCalendarMode(mode)).toBe('off');
    }
    expect(projectFixtureCalendarRow(row, NOW, undefined).startAt).toBe(row.startAt);
    expect(fixtureCalendarMode(undefined)).toBe('demo');
    expect(fixtureCalendarMode('demo')).toBe('demo');

    const edited = {
      ...row,
      startAt: new Date(row.startAt.getTime() + 60_000),
    };
    expect(projectFixtureCalendarRow(edited, NOW, 'demo').startAt).toBe(edited.startAt);
    expect(
      projectFixtureCalendarRow({ ...row, clientRequestId: 'fixture:cal:other' }, NOW, 'demo').startAt,
    ).toBe(row.startAt);
    expect(fixtureCalendarShiftMs(new Date('2026-05-11T13:00:00.000Z'))).toBe(0);
    expect(fixtureCalendarShiftMs(new Date('2026-05-10T13:00:00.000Z'))).toBe(0);
    expect(projectFixtureCalendarRow(row, new Date('2026-05-10T13:00:00.000Z'), 'demo').startAt).toBe(
      row.startAt,
    );
  });
});
