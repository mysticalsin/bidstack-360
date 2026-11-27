import { describe, expect, it } from 'vitest';

import {
  formatUnspecifiedAmount,
  UNSPECIFIED_CURRENCY_BASIS,
} from '@/components/dashboard/unspecified-currency';

import { accountPipelineAmount } from './accountPipelineAmount';

describe('accountPipelineAmount', () => {
  it('prints demo OP-2041 at 65% as 806,000 and does not name a currency', () => {
    // WHY: 1,240,000 stored as micros, weighted at 65%, is the open pipeline
    // on the CI Financial card. formatMoneyMicros(micros, "EUR") turned that
    // into a euro forecast and could compact it. The opportunity has no currency.
    const micros = Math.round(1_240_000 * 1_000_000 * 0.65);
    const amount = accountPipelineAmount(micros);
    expect(amount).toBe(formatUnspecifiedAmount(806_000));
    expect(amount).not.toMatch(/€|EUR|USD|£/);
    expect(UNSPECIFIED_CURRENCY_BASIS).not.toMatch(/€|EUR/);
  });

  it('keeps a zero book as zero rather than a zero-euro forecast', () => {
    expect(accountPipelineAmount(0)).toBe(formatUnspecifiedAmount(0));
  });
});
