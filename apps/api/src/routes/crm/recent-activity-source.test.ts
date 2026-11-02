import { describe, expect, it } from 'vitest';

import { recentActivitySourceTake } from './recent-activity-source.js';

describe('recentActivitySourceTake', () => {
  it('does not cut six loaded deals to five before the activity card', () => {
    // WHY: each source used to take five. Six opportunities then never reached
    // the dashboard card, and those five read as every recent update. The
    // summary page is already `limit`. A sixth loaded deal has to be in that
    // page. No activity total is invented, and this is not a new query.
    const six = ['Ada', 'Bea', 'Cara', 'Dia', 'Eve', 'Fay'];
    const passed = six.slice(0, recentActivitySourceTake(20));
    expect(passed).toEqual(six);
    expect(passed).not.toEqual(six.slice(0, 5));
  });

  it('still respects a shorter summary page', () => {
    // WHY: the route cap is the requested limit. Raising a fixed take of five
    // must not return more rows than the caller asked for.
    expect(recentActivitySourceTake(3)).toBe(3);
    expect(['Ada', 'Bea', 'Cara', 'Dia'].slice(0, recentActivitySourceTake(3))).toEqual([
      'Ada',
      'Bea',
      'Cara',
    ]);
  });
});
