import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useCurrencyStore } from '@/stores/currency';

import { useFormatMoney } from './useFormatMoney';

const EUR_11_89M_MICROS = '11890000000000';

describe('useFormatMoney keeps the amount currency', () => {
  beforeEach(() => {
    localStorage.clear();
    useCurrencyStore.setState({
      currency: 'CAD',
      autoDetect: false,
      followOrg: false,
      rates: {
        base: 'EUR',
        date: '2026-05-31',
        rates: {
          USD: 1.1,
          CAD: 1.5,
          GBP: 0.86,
          JPY: 170,
          BRL: 6,
          COP: 4500,
          CLP: 1000,
          AUD: 1.65,
          CHF: 0.95,
          SEK: 11.2,
          NOK: 11.8,
          DKK: 7.45,
        },
      },
      ratesLoading: false,
      ratesError: null,
    });
  });

  it('shows an EUR amount as euros when the selector is CAD', () => {
    // WHY: cached rates would turn €11.89M into a Canadian figure and stamp
    // CA$ on it. The selector has no approved rate source, so the euro stays
    // and the label says it was not converted.
    const { result } = renderHook(() => useFormatMoney());
    const formatted = result.current.formatMoneyMicros(EUR_11_89M_MICROS, 'EUR', { compact: true });
    expect(result.current.currency).toBe('CAD');
    expect(formatted).toContain('€');
    expect(formatted).toContain('EUR');
    expect(formatted).toMatch(/not converted to CAD/i);
    expect(formatted).not.toContain('CA$');
  });
});
