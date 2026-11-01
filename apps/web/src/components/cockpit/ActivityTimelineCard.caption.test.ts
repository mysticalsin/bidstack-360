import { describe, expect, it } from 'vitest';

import { activityListCaption } from './ActivityTimelineCard';

describe('activity list caption', () => {
  it('says when older tasks sit outside the five shown', () => {
    // WHY: "Last 5 items" read as the whole account when a sixth task existed.
    expect(activityListCaption(5, true)).toBe('Latest 5. Older tasks are outside this list.');
    expect(activityListCaption(2, false)).toBe('Last 2 items');
  });
});
