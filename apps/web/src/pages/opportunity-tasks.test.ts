import { describe, expect, it } from 'vitest';

import { opportunityTaskCaption } from './opportunity-tasks';

describe('opportunity task caption', () => {
  it('does not describe a full task page as every task', () => {
    // WHY: the opportunity Tasks tab counted the loaded page as every task on
    // the deal. The list route already reads one row past the limit and drops
    // it. pageContinues means that extra row existed. A shorter page is the
    // whole match and keeps the old caption.
    expect(opportunityTaskCaption(50, true)).toBe('50 in the latest 50, not every task');
    expect(opportunityTaskCaption(50, true)).not.toBe('50 active');
    expect(opportunityTaskCaption(2, true)).toMatch(/not every task/i);
    expect(opportunityTaskCaption(2, true)).not.toBe('2 active');

    expect(opportunityTaskCaption(2, false)).toBe('2 active');
    expect(opportunityTaskCaption(0, false)).toBe('0 active');
    expect(opportunityTaskCaption(1, false)).toBe('1 active');
    expect(opportunityTaskCaption(50, false)).toBe('50 active');
    expect(opportunityTaskCaption(2, false)).not.toMatch(/not every/i);
  });
});
