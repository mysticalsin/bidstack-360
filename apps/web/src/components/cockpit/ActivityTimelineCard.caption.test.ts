import { describe, expect, it } from 'vitest';

import en from '../../../public/locales/en/crm.json';

import { ACTIVITY_EMPTY_MESSAGE, activityListCaption } from './ActivityTimelineCard';

describe('activity list caption', () => {
  it('says when older tasks sit outside the five shown', () => {
    // WHY: "Last 5 items" read as the whole account when a sixth task existed.
    expect(activityListCaption(5, true)).toBe('Latest 5. Older tasks are outside this list.');
    expect(activityListCaption(2, false)).toBe('Last 2 items');
  });

  it('does not promise emails or Dust runs in an empty task list', () => {
    // WHY: the empty card named emails and Dust runs. This feed only stores tasks.
    expect(ACTIVITY_EMPTY_MESSAGE).toBe('Tasks for this account will appear here.');
    expect(en.activityTimeline.emptyMessage).toBe(ACTIVITY_EMPTY_MESSAGE);
    expect(en.activityTimeline.emptyMessage).not.toMatch(/email|dust/i);
  });
});
