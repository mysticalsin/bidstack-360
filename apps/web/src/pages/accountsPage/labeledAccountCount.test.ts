import { describe, expect, it } from 'vitest';

import { labeledAccountCount } from './AccountsKeySegment';

describe('labeledAccountCount', () => {
  it('uses the singular for one strategic account', () => {
    expect(labeledAccountCount(1)).toBe('1 account');
    expect(labeledAccountCount(4)).toBe('4 accounts');
  });
});