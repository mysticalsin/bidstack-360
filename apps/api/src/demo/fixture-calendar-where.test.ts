import { describe, expect, it } from 'vitest';

import { FIXTURE_CALENDAR_EVENTS } from '@bidstack/shared';

import { fixtureCalendarLookup } from './fixture-calendar-where.js';

const AGED = new Date('2026-11-27T15:00:00.000Z');
const AHEAD = new Date('2026-05-10T13:00:00.000Z');

describe('fixture calendar lookup', () => {
  it('fetches the seeded instants only when demo dates have aged', () => {
    // WHY: the list query filters start_at inside the visible week. A May
    // fixture never reaches the projector unless this lookup brings it in.
    const demo = fixtureCalendarLookup(AGED, 'demo');
    expect(demo?.clientRequestId.in).toEqual(FIXTURE_CALENDAR_EVENTS.map((event) => event.clientRequestId));
    expect(demo?.startAt.in.map((date) => date.toISOString())).toEqual(
      FIXTURE_CALENDAR_EVENTS.map((event) => event.startAt),
    );

    expect(fixtureCalendarLookup(AGED, undefined)).toEqual(demo);
    expect(fixtureCalendarLookup(AHEAD, 'demo')).toBeNull();
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', 'notdemo'] as const) {
      expect(fixtureCalendarLookup(AGED, mode)).toBeNull();
    }
  });
});
