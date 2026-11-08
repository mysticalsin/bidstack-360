import { describe, expect, it } from 'vitest';

import { formatMicrosAmount } from '@bidstack/shared';

import { formatStoredMicros } from './useFormatMoney';

describe('failed conversion keeps the source currency', () => {
  it('does not label a non-finite conversion with the display currency', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', () => Number.NaN, 'USD');
    expect(text).toContain('€');
    expect(text).not.toContain('$');
    expect(text).toContain('2.50');
  });

  it('keeps the source code when a different display currency comes back unchanged', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', (amount) => amount, 'USD');
    expect(text).toContain('€');
    expect(text).not.toContain('$');
  });

  it('uses the display currency when the converter changes the amount', () => {
    const text = formatStoredMicros(2_500_000n, 'EUR', (amount) => amount * 2, 'USD');
    expect(text).toContain('$');
    expect(text).not.toContain('€');
  });

  it('scales the stored micros before labelling them', () => {
    expect(formatMicrosAmount(100_000_000_000n)).toBe('100,000');
  });
});
