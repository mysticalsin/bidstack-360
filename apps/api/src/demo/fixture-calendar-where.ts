import { FIXTURE_CALENDAR_EVENTS, fixtureCalendarMode, fixtureCalendarShiftMs } from '@bidstack/shared';

/**
 * Extra lookup for fixture meetings whose stored week is behind the clock.
 * Real mode, and a demo whose seeded week is still ahead, returns null so the
 * range query stays the only read. Booking availability keeps using stored times.
 */
export function fixtureCalendarLookup(
  now: Date,
  mode: string | undefined,
): { clientRequestId: { in: string[] }; startAt: { in: Date[] } } | null {
  if (fixtureCalendarMode(mode) !== 'demo' || fixtureCalendarShiftMs(now) === 0) return null;
  return {
    clientRequestId: { in: FIXTURE_CALENDAR_EVENTS.map((event) => event.clientRequestId) },
    startAt: { in: FIXTURE_CALENDAR_EVENTS.map((event) => new Date(event.startAt)) },
  };
}
