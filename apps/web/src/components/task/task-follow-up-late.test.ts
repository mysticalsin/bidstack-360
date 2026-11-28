import { describe, expect, it } from 'vitest';

import { openFollowUpLateDays } from './task-follow-up-late';

// Demo follow-ups are dated May 2026. On 25 Nov 2026 the list says they are
// late. The record must use the same UTC day: due today at 18:00 is still
// today's work, a finished follow-up is not late, and 15 May is 194 days late.
const NOW = new Date('2026-11-25T18:00:00.000Z');

describe('openFollowUpLateDays', () => {
  it('counts a past demo close as late and leaves today, the future, and done alone', () => {
    expect(openFollowUpLateDays('2026-05-15', 'open', NOW)).toBe(194);
    expect(openFollowUpLateDays('2026-05-15', 'in_progress', NOW)).toBe(194);
    expect(openFollowUpLateDays('2026-05-15', 'blocked', NOW)).toBe(194);
    expect(openFollowUpLateDays('2026-11-24', 'open', NOW)).toBe(1);
    expect(openFollowUpLateDays('2026-11-25', 'open', NOW)).toBeNull();
    expect(openFollowUpLateDays('2026-12-01', 'open', NOW)).toBeNull();
    expect(openFollowUpLateDays('2026-05-15', 'done', NOW)).toBeNull();
    expect(openFollowUpLateDays(null, 'open', NOW)).toBeNull();
  });
});
