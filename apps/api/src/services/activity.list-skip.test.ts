import { describe, expect, it } from 'vitest';

import { activityListSkip } from './activity.service.js';

describe('activity list skip', () => {
  it('does not apply offset on top of a cursor', () => {
    // WHY: ActivityFilter allows both. The cursor already starts the next
    // page. skip: offset on that query drops or repeats rows, while total
    // still counts the whole filtered set.
    expect(activityListSkip('2026-01-01T00:00:00.000Z|11111111-1111-4111-8111-111111111111', 20)).toBe(0);
  });

  it('keeps offset when there is no cursor', () => {
    expect(activityListSkip(undefined, 20)).toBe(20);
  });
});
