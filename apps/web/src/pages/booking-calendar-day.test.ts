import { describe, expect, it } from 'vitest';

import { calendarDayKey, speakCalendarDay } from './booking-calendar-day';

describe('booking calendar day', () => {
  // WHY: 26 Nov 2026 01:00 UTC is still 25 Nov in Toronto. Adding one local
  // day and then taking the UTC date speaks 27 Nov. Tomorrow is 26 Nov.
  // Formatting that date as a UTC midnight instant would speak 25 Nov.
  it('keeps tomorrow on the Toronto calendar day after UTC has moved on', () => {
    const now = new Date('2026-11-26T01:00:00.000Z');
    expect(calendarDayKey(now, 'America/Toronto', 0)).toBe('2026-11-25');
    expect(calendarDayKey(now, 'America/Toronto', 1)).toBe('2026-11-26');

    const spoken = speakCalendarDay('2026-11-26');
    const heardFromUtcMidnight = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(new Date('2026-11-26T00:00:00.000Z'));
    expect(heardFromUtcMidnight).toBe('Wednesday, Nov 25');
    expect(spoken).not.toBe(heardFromUtcMidnight);
    expect(spoken).toMatch(/Thursday/);
    expect(spoken).toMatch(/Nov 26/);
  });
});
