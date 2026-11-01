import { describe, expect, it } from 'vitest';

import { evidencePageCapped } from './initiatives';

describe('evidencePageCapped', () => {
  it('names a full news or meeting page only when another row exists', () => {
    // WHY: the latest 100 items were read as every initiative signal from the year.
    expect(evidencePageCapped(100, 101, 2, 2)).toBe(true);
    expect(evidencePageCapped(3, 3, 100, 140)).toBe(true);
    expect(evidencePageCapped(100, 100, 100, 100)).toBe(false);
    expect(evidencePageCapped(4, 4, 1, 1)).toBe(false);
  });
});
