import { describe, expect, it } from 'vitest';

import { formatOpportunityDueDay } from './opportunity-due-day';

// A bid due date is a calendar day with no time. Parsing it as an instant
// puts UTC midnight on the previous evening in America/Toronto, so the
// record says the bid is due a day early. An empty due date is not a day.
describe('formatOpportunityDueDay', () => {
  it('prints the calendar day, not the previous evening in America/Toronto', () => {
    const previousEvening = new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Toronto',
    }).format(new Date('2026-07-22T00:00:00.000Z'));

    expect(previousEvening).toBe('Jul 21, 2026');
    expect(formatOpportunityDueDay('2026-07-22', 'en')).toBe('Jul 22, 2026');
  });

  it('treats a missing due date as no day', () => {
    expect(formatOpportunityDueDay(null, 'en')).toBeNull();
    expect(formatOpportunityDueDay(undefined, 'en')).toBeNull();
    expect(formatOpportunityDueDay('', 'en')).toBeNull();
    expect(formatOpportunityDueDay('   ', 'en')).toBeNull();
  });

  it('leaves a value that is not a real calendar day as written', () => {
    expect(formatOpportunityDueDay('2026-02-31', 'en')).toBe('2026-02-31');
  });
});
