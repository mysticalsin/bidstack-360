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
    try {
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    } catch {
      // ignore: jsdom may lock navigator in some runners
    }
    vi.unstubAllGlobals();
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
    const spyUTC = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'UTC',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);

    const spyBR = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'pt-BR',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    expect(detectLocalCurrency()).toBe('BRL');
    spyBR.mockRestore();

    const spyCO = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'es-CO',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    expect(detectLocalCurrency()).toBe('COP');
    spyCO.mockRestore();

    const spyCL = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'es-CL',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    expect(detectLocalCurrency()).toBe('CLP');
    spyCL.mockRestore();

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
    spyUTC.mockRestore();

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

  it('prioritizes browser location over display language for auto currency', async () => {
    const { detectLocalCurrency } = await loadCurrency();
    const spyLocale = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'fr-FR',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    const spyTZ = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Bogota',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);

    expect(detectLocalCurrency()).toBe('COP');

    spyLocale.mockRestore();
    spyTZ.mockRestore();
  });

  it('uses Americas location signals for Brazil, Chile, US, and Canada', async () => {
    const { detectLocalCurrency } = await loadCurrency();
    const spyLocale = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    const spyTZ = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');

    spyTZ.mockReturnValue({
      timeZone: 'America/Sao_Paulo',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);
    expect(detectLocalCurrency()).toBe('BRL');

    spyTZ.mockReturnValue({
      timeZone: 'America/Santiago',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);
    expect(detectLocalCurrency()).toBe('CLP');

    spyTZ.mockReturnValue({
      timeZone: 'America/New_York',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);
    expect(detectLocalCurrency()).toBe('USD');

    spyTZ.mockReturnValue({
      timeZone: 'America/Toronto',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);
    expect(detectLocalCurrency()).toBe('CAD');

    spyLocale.mockRestore();
    spyTZ.mockRestore();
  });

  it('maps exact browser coordinates to the supported local currency', async () => {
    const { currencyFromCoordinates } = await loadCurrency();

    expect(currencyFromCoordinates(-23.5505, -46.6333)).toBe('BRL');
    expect(currencyFromCoordinates(4.711, -74.0721)).toBe('COP');
    expect(currencyFromCoordinates(-33.4489, -70.6693)).toBe('CLP');
    expect(currencyFromCoordinates(40.7128, -74.006)).toBe('USD');
    expect(currencyFromCoordinates(45.5019, -73.5674)).toBe('CAD');
  });

  it('uses precise geolocation when Auto is enabled', async () => {
    const spyLocale = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    const spyTZ = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/New_York',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 4.711,
          longitude: -74.0721,
          accuracy: 100,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      });
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    const { useCurrencyStore } = await loadCurrency();

    expect(useCurrencyStore.getState().currency).toBe('USD');
    await useCurrencyStore.getState().enableAutoDetect();

    expect(getCurrentPosition).toHaveBeenCalled();
    expect(useCurrencyStore.getState().currency).toBe('COP');
    expect(useCurrencyStore.getState().autoDetect).toBe(true);

    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    spyLocale.mockRestore();
    spyTZ.mockRestore();
  });

  it('falls back to timezone when browser geolocation is denied', async () => {
    const spyLocale = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'fr-FR',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    const spyTZ = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Santiago',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({
        code: 1,
        message: 'Denied',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    const { useCurrencyStore } = await loadCurrency();
    await useCurrencyStore.getState().enableAutoDetect();

    expect(useCurrencyStore.getState().currency).toBe('CLP');

    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    spyLocale.mockRestore();
    spyTZ.mockRestore();
  });

  it('prioritizes Americas currencies in the top-bar chooser order', async () => {
    const { SUPPORTED_CURRENCIES } = await loadCurrency();

    expect(SUPPORTED_CURRENCIES.slice(0, 6).map((c) => c.code)).toEqual([
      'BRL',
      'COP',
      'CLP',
      'USD',
      'CAD',
      'EUR',
    ]);
  });

  it('rejects cached rates missing supported currencies and refreshes from the API', async () => {
    localStorage.setItem('bidstack:exchange-rates-ts', String(Date.now()));
    localStorage.setItem(
      'bidstack:exchange-rates',
      JSON.stringify({
        base: 'EUR',
        rates: { USD: 1.1, CAD: 1.5 },
        date: 'stale-shape',
      }),
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        base: 'EUR',
        rates: fullRates(),
        date: 'fresh',
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { useCurrencyStore } = await loadCurrency();
    expect(useCurrencyStore.getState().rates).toBe(null);

    await useCurrencyStore.getState().fetchRates();

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/exchange-rates', {
      credentials: 'include',
    });
    expect(useCurrencyStore.getState().rates?.date).toBe('fresh');
    expect(useCurrencyStore.getState().rates?.rates.BRL).toBe(6);
  });

  it('updates currency state via setCurrency and clears autoDetect', async () => {
    const { useCurrencyStore } = await loadCurrency();

    useCurrencyStore.getState().setCurrency('USD');
    expect(useCurrencyStore.getState().currency).toBe('USD');
    expect(useCurrencyStore.getState().autoDetect).toBe(false);

    await useCurrencyStore.getState().enableAutoDetect();
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

  it('normalizes source currency codes before converting', async () => {
    const { useCurrencyStore } = await loadCurrency();

    useCurrencyStore.setState({
      currency: 'USD',
      rates: {
        base: 'EUR',
        rates: fullRates(),
        date: new Date().toISOString(),
      },
    });

    expect(useCurrencyStore.getState().convert(100, 'eur')).toBeCloseTo(110, 2);
    expect(useCurrencyStore.getState().convert(150, ' cad ')).toBeCloseTo(110, 2);
  });
});

describe('useFormatMoney hook integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('formats CAD to EUR correctly using useFormatMoney hook', () => {
    localStorage.setItem('bidstack:exchange-rates-ts', String(Date.now()));
    localStorage.setItem(
      'bidstack:exchange-rates',
      JSON.stringify({
        base: 'EUR',
        rates: fullRates(),
        date: new Date().toISOString(),
      }),
    );
    useCurrencyStore.setState({
      currency: 'EUR',
      rates: {
        base: 'EUR',
        rates: fullRates(),
        date: new Date().toISOString(),
      },
    });

    const { result } = renderHook(() => useFormatMoney());

    // 1.5M CAD in micros is '1500000000000'
    const formatted = result.current.formatMoneyMicros('1500000000000', 'CAD');

    expect(formatted).toContain('€');
    expect(formatted).not.toContain('CA$');
  });
});

function fullRates(): Record<string, number> {
  return {
    BRL: 6,
    COP: 4500,
    CLP: 1000,
    USD: 1.1,
    CAD: 1.5,
    GBP: 0.86,
    AUD: 1.65,
    CHF: 0.95,
    JPY: 170,
    SEK: 11.2,
    NOK: 11.8,
    DKK: 7.45,
  };
}
