import { afterEach, describe, expect, it } from 'vitest';

import { formatDate } from '@/lib/format';

import { formatOpportunityDueDate } from './opportunity-due-date';

describe('formatOpportunityDueDate', () => {
  afterEach(() => {
    process.env.TZ = 'UTC';
  });

  it('prints the calendar day, not the previous evening west of UTC', () => {
    // WHY: `new Date('2026-07-22')` is UTC midnight. America/Toronto formats
    // that instant as Jul 21. Demo OP-2041 is due on the 22nd, and the Due
    // column has to agree with the date stored on the bid.
    process.env.TZ = 'America/Toronto';
    expect(formatDate('2026-07-22', 'en-US')).toBe('Jul 21, 2026');
    expect(formatOpportunityDueDate('2026-07-22', 'en-US')).toBe('Jul 22, 2026');
    expect(formatOpportunityDueDate('2026-07-22', 'en-US')).not.toBe(
      formatDate('2026-07-22', 'en-US'),
    );
  });

  it('leaves a value that is not a calendar date untouched', () => {
    expect(formatOpportunityDueDate('not-a-date', 'en-US')).toBe('not-a-date');
    // 31 Feb is not a deadline. Overflowing it into March would invent a day.
    expect(formatOpportunityDueDate('2026-02-31', 'en-US')).toBe('2026-02-31');
  });
});
