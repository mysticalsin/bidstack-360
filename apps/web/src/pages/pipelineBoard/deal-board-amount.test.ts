// A bid does not store a currency. The opportunities list already prints the
// amount with that fact. The deal board must use the same sentence, or a
// reader treats demo OP-2041 (1,240,000) as a euro forecast.
import { describe, expect, it } from 'vitest';

import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';

import { dealBoardAmount } from './deal-board-amount';

describe('dealBoardAmount', () => {
  it('uses the opportunities-list sentence and does not name a currency', () => {
    // WHY: inventing EUR here is what formatMoney(value, "EUR") did, including
    // compacting 1,240,000 into a euro million and converting it when a
    // display currency was selected.
    const amount = dealBoardAmount(1_240_000);
    expect(amount).toBe(`${formatUnspecifiedAmount(1_240_000)} (${UNSPECIFIED_CURRENCY_BASIS})`);
    expect(amount).toContain('1,240,000');
    expect(amount).not.toMatch(/€|EUR|USD|£/);
  });

  it('keeps a zero book unspecified rather than a zero-euro forecast', () => {
    expect(dealBoardAmount(0)).toBe(`0 (${UNSPECIFIED_CURRENCY_BASIS})`);
  });
});
