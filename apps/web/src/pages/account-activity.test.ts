import { describe, expect, it } from 'vitest';

import { accountActivityCaption } from './account-activity';

describe('account activity caption', () => {
  it('does not describe a full activity page as every activity', () => {
    // WHY: the account activity header counted the loaded page as every
    // activity. The cockpit reads one row past the page and drops it.
    // pageContinues means that extra row existed. A shorter page is the
    // whole match and keeps the old caption.
    expect(accountActivityCaption(5, true)).toBe('5 in the latest 5, not every activity');
    expect(accountActivityCaption(5, true)).not.toBe('Last 5 items');
    expect(accountActivityCaption(2, true)).toMatch(/not every activity/i);
    expect(accountActivityCaption(2, true)).not.toBe('Last 2 items');

    expect(accountActivityCaption(2, false)).toBe('Last 2 items');
    expect(accountActivityCaption(1, false)).toBe('Last 1 item');
    expect(accountActivityCaption(0, false)).toBe('Last 0 items');
    expect(accountActivityCaption(5, false)).toBe('Last 5 items');
    expect(accountActivityCaption(2, false)).not.toMatch(/not every/i);
  });
});
