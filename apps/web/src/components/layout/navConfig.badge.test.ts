import { describe, expect, it } from 'vitest';

import { navBadgeCopy } from './navConfig';

describe('navBadgeCopy', () => {
  it('says the opportunities badge is the open count', () => {
    // Why: the rail shows 7 beside Opportunities while the list page has 19 rows.
    expect(navBadgeCopy('openBids')).toEqual({
      key: 'nav.badgeOpenBids',
      fallback: '{{count}} open',
    });
  });

  it('says the tasks badge is the overdue count', () => {
    expect(navBadgeCopy('overdueTasks').fallback).toBe('{{count}} overdue');
  });
});
