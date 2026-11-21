import { describe, expect, it } from 'vitest';

import { isDueToday, isOverdue, summaryToday } from './civil-date.js';

// 22:00 in America/Sao_Paulo is 01:00 UTC the next calendar day.
const AT_22_LOCAL = new Date('2026-11-22T01:00:00.000Z');
const SAO_PAULO = 'America/Sao_Paulo';

const SEVEN_OVERDUE = Array.from({ length: 7 }, () => '2026-11-20');
const DUE_ON_THE_LOCAL_DAY = '2026-11-21';
const DATES = [...SEVEN_OVERDUE, DUE_ON_THE_LOCAL_DAY];

describe('task clock at 22:00 America/Sao_Paulo', () => {
  it('is 01:00 UTC the next day, and that local evening is still the civil day', () => {
    expect(AT_22_LOCAL.toISOString().slice(0, 10)).toBe('2026-11-22');
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: SAO_PAULO,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(AT_22_LOCAL);
    expect(hour).toBe('22');
    // The badge's UTC "today" is the 22nd. The page's civil day is the 21st.
    expect(summaryToday(AT_22_LOCAL, SAO_PAULO)).toBe('2026-11-21');
  });

  it('counts 7 overdue and 1 due today, not 8 overdue', () => {
    // WHY: seven tasks are already past the São Paulo day. The eighth is due
    // on that day. UTC has rolled over, so the summary counts all eight as
    // overdue and none as due today. The page, on the civil day, shows 7 and 1.
    const overdue = DATES.filter((due) => isOverdue(due, AT_22_LOCAL, SAO_PAULO)).length;
    const dueToday = DATES.filter((due) => isDueToday(due, AT_22_LOCAL, SAO_PAULO)).length;
    expect(overdue).toBe(7);
    expect(dueToday).toBe(1);
    expect(overdue + dueToday).toBe(DATES.length);
  });
});
