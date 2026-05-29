import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCurrencyStore } from './currency';
import { useFormatMoney } from '../hooks/useFormatMoney';

async function loadCurrency() {
  vi.resetModules();
  return import('./currency');
}

describe('useCurrencyStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('has correct initial state', async () => {
    const spyLocale = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'fr-FR',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    const spyTZ = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Paris',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);

    const { useCurrencyStore } = await loadCurrency();
    const state = useCurrencyStore.getState();

    expect(state.currency).toBe('EUR');
    expect(state.autoDetect).toBe(true);
    expect(state.ratesLoading).toBe(false);
    expect(state.ratesError).toBe(null);

    spyLocale.mockRestore();
    spyTZ.mockRestore();
  });

  it('detects currency correctly based on locale or timezone', async () => {
    const { detectLocalCurrency } = await loadCurrency();

    // Test US locale
    const spyUS = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    expect(detectLocalCurrency()).toBe('USD');
    spyUS.mockRestore();

    // Test GB locale
    const spyGB = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-GB',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    expect(detectLocalCurrency()).toBe('GBP');
    spyGB.mockRestore();

    // Test Switzerland timezone fallback
    const spyCH_Locale = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    const spyCH_TZ = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Zurich',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);
    expect(detectLocalCurrency()).toBe('CHF');
    spyCH_Locale.mockRestore();
    spyCH_TZ.mockRestore();
  });

  it('updates currency state via setCurrency and clears autoDetect', async () => {
    const { useCurrencyStore } = await loadCurrency();

    useCurrencyStore.getState().setCurrency('USD');
    expect(useCurrencyStore.getState().currency).toBe('USD');
    expect(useCurrencyStore.getState().autoDetect).toBe(false);

    useCurrencyStore.getState().enableAutoDetect();
    expect(useCurrencyStore.getState().autoDetect).toBe(true);
  });

  it('returns original amount when rates are not loaded', async () => {
    const { useCurrencyStore } = await loadCurrency();
    const state = useCurrencyStore.getState();

    expect(state.rates).toBe(null);
    expect(state.convert(100, 'CAD')).toBe(100);
  });

  it('performs correct conversion when rates are loaded and base currency is EUR (absent in rates.rates)', async () => {
    const { useCurrencyStore } = await loadCurrency();

    useCurrencyStore.setState({
      rates: {
        base: 'EUR',
        rates: {
          USD: 1.1,
          CAD: 1.5,
        },
        date: new Date().toISOString(),
      },
    });

    const store = useCurrencyStore.getState();

    store.setCurrency('EUR');
    expect(useCurrencyStore.getState().convert(150, 'CAD')).toBeCloseTo(100, 2);

    store.setCurrency('USD');
    expect(useCurrencyStore.getState().convert(100, 'EUR')).toBeCloseTo(110, 2);

    store.setCurrency('USD');
    expect(useCurrencyStore.getState().convert(150, 'CAD')).toBeCloseTo(110, 2);

    store.setCurrency('USD');
    expect(useCurrencyStore.getState().convert(100, 'GBP')).toBe(100);

    store.setCurrency('GBP');
    expect(useCurrencyStore.getState().convert(100, 'CAD')).toBe(100);
  });

  it('performs correct conversion when rates are loaded and base currency is EUR (present in rates.rates)', async () => {
    const { useCurrencyStore } = await loadCurrency();

    useCurrencyStore.setState({
      rates: {
        base: 'EUR',
        rates: {
          EUR: 1.0,
          USD: 1.1,
          CAD: 1.5,
        },
        date: new Date().toISOString(),
      },
    });

    const store = useCurrencyStore.getState();

    store.setCurrency('EUR');
    expect(useCurrencyStore.getState().convert(150, 'CAD')).toBeCloseTo(100, 2);

    store.setCurrency('USD');
    expect(useCurrencyStore.getState().convert(100, 'EUR')).toBeCloseTo(110, 2);
  });
});

describe('useFormatMoney hook integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('formats CAD to EUR correctly using useFormatMoney hook', () => {
    useCurrencyStore.setState({
      currency: 'EUR',
      rates: {
        base: 'EUR',
        rates: {
          USD: 1.1,
          CAD: 1.5,
        },
        date: new Date().toISOString(),
      },
    });

    const { result } = renderHook(() => useFormatMoney());

    // 1.5M CAD in micros is '1500000000000'
    const formatted = result.current.formatMoneyMicros('1500000000000', 'CAD');

    console.log('--- DIAGNOSTIC ---');
    console.log('Display Currency (from store):', useCurrencyStore.getState().currency);
    console.log('Result for 1.5M CAD formatted:', formatted);
    console.log('------------------');

    expect(formatted).toContain('€');
    expect(formatted).not.toContain('CA$');
  });
});
