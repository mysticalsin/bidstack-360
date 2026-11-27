import { describe, expect, it } from 'vitest';

import { FIXTURE_CALENDAR_EVENTS } from '@bidstack/shared';

import { DEMO_CALENDAR_LINKS, FIXTURE_CALENDAR_LINKS } from './seed-calendar-fixtures.js';

describe('fixture calendar seed links', () => {
  it('files every meeting the read clock slides, in both demo seeds', () => {
    // WHY: the clock table is the seed. A new meeting in only one of them
    // ages out of the week while the other still claims it is on the agenda.
    const keys = FIXTURE_CALENDAR_EVENTS.map((event) => event.clientRequestId);
    expect(Object.keys(FIXTURE_CALENDAR_LINKS).sort()).toEqual([...keys].sort());
    expect(Object.keys(DEMO_CALENDAR_LINKS).sort()).toEqual([...keys].sort());
    for (const event of FIXTURE_CALENDAR_EVENTS) {
      expect(Date.parse(event.endAt)).toBeGreaterThan(Date.parse(event.startAt));
      expect(Date.parse(event.endAt) - Date.parse(event.startAt)).toBeLessThan(86_400_000);
      expect(FIXTURE_CALENDAR_LINKS[event.clientRequestId]?.subject.length).toBeGreaterThan(0);
      expect(DEMO_CALENDAR_LINKS[event.clientRequestId]?.subject.length).toBeGreaterThan(0);
    }
  });
});
