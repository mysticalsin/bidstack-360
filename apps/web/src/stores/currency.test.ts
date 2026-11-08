import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDisplayMoney, useDisplayMoneyMicros } from '../hooks/useDisplayMoney';
import { formatMoneyMicros } from '@/lib/format';
import { conversionOutcome, rateRelation, useCurrencyStore } from './currency';
import { useFormatMoney } from '../hooks/useFormatMoney';

const { microsSeen } = vi.hoisted(() => ({
  microsSeen: [] as { micros: string; currency?: string }[],
}));

vi.mock('@/lib/format', async () => {
  const actual = await vi.importActual<typeof import('@/lib/format')>('@/lib/format');
  return {
    ...actual,
    formatMoneyMicros: (
      micros: string | number | bigint,
      currency?: string,
      options?: { compact?: boolean; locale?: string },
    ) => {
      microsSeen.push({
        micros: typeof micros === 'bigint' ? micros.toString() : String(micros),
        currency,
      });
      return actual.formatMoneyMicros(micros, currency, options);
    },
  };
});

/** One unit past the largest integer Number can store exactly, in micros. */
const HUGE_MICROS = 9007199254740993000000n;

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

  it('starts on the workspace default currency, not the browser time zone', async () => {
    // WHY: a UTC-3 browser (America/Sao_Paulo) showed R$ on a Canadian
    // account. The time zone says where the user sits, not how the workspace
    // reports money.
    const spyLocale = vi.spyOn(Intl.NumberFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'pt-BR',
    } as unknown as Intl.ResolvedNumberFormatOptions);
    const spyTZ = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Sao_Paulo',
    } as unknown as Intl.ResolvedDateTimeFormatOptions);

    const { useCurrencyStore } = await loadCurrency();
    const state = useCurrencyStore.getState();

    expect(state.currency).toBe('CAD');
    expect(state.autoDetect).toBe(false);
    expect(state.followOrg).toBe(true);
    expect(state.ratesLoading).toBe(false);
    expect(state.ratesError).toBe(null);

    spyLocale.mockRestore();
    spyTZ.mockRestore();
  });

  it('follows the workspace currency until the user picks one', async () => {
    const { useCurrencyStore } = await loadCurrency();

    useCurrencyStore.getState().applyOrgCurrency('EUR');
    expect(useCurrencyStore.getState().currency).toBe('EUR');

    useCurrencyStore.getState().setCurrency('GBP');
    useCurrencyStore.getState().applyOrgCurrency('USD');
    expect(useCurrencyStore.getState().currency).toBe('GBP');
    expect(useCurrencyStore.getState().orgCurrency).toBe('USD');

    useCurrencyStore.getState().followOrgDefault();
    expect(useCurrencyStore.getState().currency).toBe('USD');
    expect(useCurrencyStore.getState().followOrg).toBe(true);
  });

  it('ignores a workspace currency the chooser does not support', async () => {
    const { useCurrencyStore } = await loadCurrency();
    useCurrencyStore.getState().applyOrgCurrency('XYZ');
    expect(useCurrencyStore.getState().currency).toBe('CAD');
  });

  it('moves a legacy time-zone guess onto the workspace currency but keeps an explicit pick', async () => {
    const { migratePersistedCurrency } = await loadCurrency();
    expect(migratePersistedCurrency({ currency: 'BRL', autoDetect: true })).toMatchObject({
      currency: 'CAD',
      autoDetect: false,
      followOrg: true,
    });
    expect(migratePersistedCurrency({ currency: 'GBP', autoDetect: false })).toMatchObject({
      currency: 'GBP',
      followOrg: false,
    });
  });

  it('restores a legacy persisted time-zone guess as the workspace default on load', async () => {
    localStorage.setItem(
      'bidstack:currency-locale',
      JSON.stringify({ state: { currency: 'BRL', autoDetect: true }, version: 0 }),
    );
    const { useCurrencyStore } = await loadCurrency();
    expect(useCurrencyStore.getState().currency).toBe('CAD');
    expect(useCurrencyStore.getState().followOrg).toBe(true);
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

    expect(useCurrencyStore.getState().currency).toBe('CAD');
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

  it('keeps the source currency when no rate can convert', () => {
    // WHY: convert() returns the original number when rates are missing.
    // Labeling that number with the display currency shows an unconverted
    // CAD amount as USD.
    localStorage.setItem('bidstack-locale', 'en-US');
    useCurrencyStore.setState({ currency: 'USD', rates: null });
    const { result } = renderHook(() => useFormatMoney());
    const formatted = result.current.formatMoney(100, 'CAD');
    expect(formatted).toContain('CA$');
    expect(formatted).not.toBe('$100');
  });

  it('labels an exact rate parity with the display currency', () => {
    // WHY: a real 1:1 rate is a successful conversion. The display currency
    // is the right label even though the number did not change.
    localStorage.setItem('bidstack-locale', 'en-US');
    useCurrencyStore.setState({
      currency: 'USD',
      rates: {
        base: 'EUR',
        rates: { USD: 1, CAD: 1.5 },
        date: 'parity',
      },
    });
    const { result } = renderHook(() => useFormatMoney());
    const formatted = result.current.formatMoney(100, 'EUR');
    expect(formatted).toContain('$');
    expect(formatted).not.toContain('€');
    expect(formatted).not.toContain('CA$');
  });

  it('does not throw when micros cannot be parsed', () => {
    // WHY: BigInt() throws on a bad micros string and the page would crash
    // instead of leaving the amount unlabeled.
    localStorage.setItem('bidstack-locale', 'en-US');
    useCurrencyStore.setState({ currency: 'USD', rates: null });
    const { result } = renderHook(() => useFormatMoney());
    expect(() => result.current.formatMoneyMicros('not-a-number', 'CAD')).not.toThrow();
    expect(result.current.formatMoneyMicros('not-a-number', 'CAD')).toBe('—');
  });

  it('keeps the source currency when the loaded table has no rate for the pair', () => {
    localStorage.setItem('bidstack-locale', 'en-US');
    useCurrencyStore.setState({
      currency: 'USD',
      rates: { base: 'EUR', rates: { USD: 1.1, CAD: 1.5 }, date: 'partial' },
    });
    const { result } = renderHook(() => useFormatMoney());
    expect(result.current.formatMoney(100, 'GBP')).toContain('£');
    expect(useCurrencyStore.getState().convert(100, 'GBP')).toBe(100);
  });

  it('useDisplayMoney uses the same source-currency fallback', () => {
    localStorage.setItem('bidstack-locale', 'en-US');
    useCurrencyStore.setState({ currency: 'USD', rates: null });
    const { result } = renderHook(() => useDisplayMoney(100, 'CAD'));
    expect(result.current).toContain('CA$');
  });
});

describe('micros precision before formatting', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('bidstack-locale', 'en-US');
    microsSeen.length = 0;
  });

  it('passes the stored micros through when the currency is unchanged', () => {
    // WHY: the unit integer 9007199254740993 does not fit in a Number.
    // Rebuilding micros with amount * 1e6 would store a different integer
    // before the formatter runs, even though no exchange is required.
    useCurrencyStore.setState({ currency: 'EUR', rates: null });
    const { result } = renderHook(() => useFormatMoney());
    const rendered = result.current.formatMoneyMicros(HUGE_MICROS, 'EUR');
    expect(microsSeen.at(-1)).toEqual({ micros: HUGE_MICROS.toString(), currency: 'EUR' });
    expect(rendered).toContain('€');
    expect(rendered).not.toContain('9007199254740993');

    microsSeen.length = 0;
    const negative = renderHook(() => useFormatMoney());
    negative.result.current.formatMoneyMicros(-HUGE_MICROS, 'EUR');
    expect(microsSeen.at(-1)).toEqual({ micros: (-HUGE_MICROS).toString(), currency: 'EUR' });
  });

  it('passes the stored micros through on a real 1:1 rate and labels the display currency', () => {
    useCurrencyStore.setState({
      currency: 'USD',
      rates: { base: 'EUR', rates: { USD: 1 }, date: 'parity' },
    });
    const { result } = renderHook(() => useFormatMoney());
    const rendered = result.current.formatMoneyMicros(HUGE_MICROS, 'EUR');
    expect(microsSeen.at(-1)).toEqual({ micros: HUGE_MICROS.toString(), currency: 'USD' });
    expect(rendered).toContain('$');
    expect(rendered).not.toContain('€');
    expect(rendered).not.toContain('9007199254740993');

    microsSeen.length = 0;
    const other = renderHook(() => useDisplayMoneyMicros(HUGE_MICROS, 'EUR'));
    expect(other.result.current).toContain('$');
    expect(microsSeen.at(-1)).toEqual({ micros: HUGE_MICROS.toString(), currency: 'USD' });
  });

  it('converts a safe cross rate and keeps the source micros when the integer cannot be rebuilt', () => {
    useCurrencyStore.setState({
      currency: 'USD',
      rates: { base: 'EUR', rates: { USD: 1.1 }, date: 'live' },
    });
    const { result } = renderHook(() => useFormatMoney());
    result.current.formatMoneyMicros(100_000_000n, 'EUR');
    expect(microsSeen.at(-1)).toEqual({ micros: '110000000', currency: 'USD' });
    microsSeen.length = 0;
    result.current.formatMoneyMicros(-100_000_000n, 'EUR');
    expect(microsSeen.at(-1)).toEqual({ micros: '-110000000', currency: 'USD' });

    microsSeen.length = 0;
    result.current.formatMoneyMicros(HUGE_MICROS, 'EUR');
    expect(microsSeen.at(-1)).toEqual({ micros: HUGE_MICROS.toString(), currency: 'EUR' });

    microsSeen.length = 0;
    result.current.formatMoneyMicros(-HUGE_MICROS, 'EUR');
    expect(microsSeen.at(-1)).toEqual({ micros: (-HUGE_MICROS).toString(), currency: 'EUR' });
  });

  it('keeps the source micros when a finite cross rate overflows the micros scale', () => {
    // 1e15 units times 1e290 is still a finite Number. Multiplying by 1e6
    // is not. That must not become an em dash or a display-currency amount.
    useCurrencyStore.setState({
      currency: 'USD',
      rates: { base: 'EUR', rates: { USD: 1e290 }, date: 'overflow' },
    });
    const micros = 1000000000000000000000n;
    const { result } = renderHook(() => useFormatMoney());
    const rendered = result.current.formatMoneyMicros(micros, 'EUR');
    expect(rendered).not.toBe('—');
    expect(microsSeen.at(-1)).toEqual({ micros: micros.toString(), currency: 'EUR' });
  });

  it('rejects invalid micros from both hooks', () => {
    useCurrencyStore.setState({ currency: 'USD', rates: null });
    const format = renderHook(() => useFormatMoney());
    expect(format.result.current.formatMoneyMicros('not-a-number', 'CAD')).toBe('—');
    expect(format.result.current.formatMoneyMicros('1.5', 'CAD')).toBe('—');
    expect(format.result.current.formatMoneyMicros(Number.NaN, 'CAD')).toBe('—');
    expect(format.result.current.formatMoneyMicros(Number.POSITIVE_INFINITY, 'CAD')).toBe('—');
    expect(format.result.current.formatMoneyMicros(1.5, 'CAD')).toBe('—');
    const display = renderHook(() => useDisplayMoneyMicros('not-a-number', 'CAD'));
    expect(display.result.current).toBe('—');
    const fractional = renderHook(() => useDisplayMoneyMicros(1.5, 'CAD'));
    expect(fractional.result.current).toBe('—');
  });

  it('renders the exact stored digits on screen, not just the formatter argument', () => {
    // Literal expectations: agreeing with the formatter would also pass a
    // renderer that rounds 9007199254740993 to ...992.
    const full = { compact: false };
    useCurrencyStore.setState({ currency: 'EUR', rates: null });
    const same = renderHook(() => useFormatMoney()).result.current;
    expect(same.formatMoneyMicros(HUGE_MICROS, 'EUR', full)).toBe('€9,007,199,254,740,993.00');
    expect(same.formatMoneyMicros(-HUGE_MICROS, 'EUR', full)).toBe('-€9,007,199,254,740,993.00');

    useCurrencyStore.setState({
      currency: 'USD',
      rates: { base: 'EUR', rates: { USD: 1 }, date: 'parity' },
    });
    const parity = renderHook(() => useFormatMoney()).result.current;
    expect(parity.formatMoneyMicros(HUGE_MICROS, 'EUR', full)).toBe('$9,007,199,254,740,993.00');
    expect(parity.formatMoneyMicros(-HUGE_MICROS, 'EUR', full)).toBe('-$9,007,199,254,740,993.00');
    const display = renderHook(() => useDisplayMoneyMicros(HUGE_MICROS, 'EUR', full));
    expect(display.result.current).toBe('$9,007,199,254,740,993.00');

    useCurrencyStore.setState({
      currency: 'USD',
      rates: { base: 'EUR', rates: { USD: 1.1 }, date: 'live' },
    });
    const cross = renderHook(() => useFormatMoney()).result.current;
    expect(cross.formatMoneyMicros(HUGE_MICROS, 'EUR', full)).toBe('€9,007,199,254,740,993.00');
    expect(cross.formatMoneyMicros(-HUGE_MICROS, 'EUR', full)).toBe('-€9,007,199,254,740,993.00');
    expect(cross.formatMoneyMicros(100_000_000n, 'EUR', full)).toBe('$110.00');
    expect(cross.formatMoneyMicros(-100_000_000n, 'EUR', full)).toBe('-$110.00');
  });

  it('keeps the formatter exact when called directly past Number.MAX_SAFE_INTEGER units', () => {
    expect(
      formatMoneyMicros(HUGE_MICROS.toString(), 'EUR', { compact: false, locale: 'en-US' }),
    ).toBe('€9,007,199,254,740,993.00');
  });
});

describe('rateRelation', () => {
  it('names same currency, an identical rate quote, a real cross rate, and a missing rate', () => {
    // The quote comparison is not a check that the money amount came back unchanged.
    expect(rateRelation('eur', 'EUR', null)).toBe('same');
    expect(rateRelation('EUR', 'USD', { base: 'EUR', rates: { USD: 1 }, date: 'parity' })).toBe('parity');
    expect(rateRelation('EUR', 'USD', { base: 'EUR', rates: { USD: 1.1 }, date: 'live' })).toBe('cross');
    expect(rateRelation('GBP', 'USD', { base: 'EUR', rates: { USD: 1.1 }, date: 'partial' })).toBe('unavailable');
    expect(rateRelation('CAD', 'USD', null)).toBe('unavailable');
  });
});

describe('conversionOutcome', () => {
  it('succeeds for the same currency and for a real parity rate, and fails when the rate is missing', () => {
    expect(conversionOutcome(100, 'CAD', 'USD', null)).toEqual({ ok: false });
    expect(conversionOutcome(100, 'EUR', 'EUR', null)).toEqual({ ok: true, amount: 100 });
    expect(
      conversionOutcome(100, 'EUR', 'USD', { base: 'EUR', rates: { USD: 1 }, date: 'parity' }),
    ).toEqual({ ok: true, amount: 100 });
    const converted = conversionOutcome(100, 'EUR', 'USD', {
      base: 'EUR',
      rates: { USD: 1.1 },
      date: 'live',
    });
    expect(converted.ok).toBe(true);
    if (converted.ok) expect(converted.amount).toBeCloseTo(110, 10);
    expect(
      conversionOutcome(100, 'GBP', 'USD', { base: 'EUR', rates: { USD: 1.1 }, date: 'partial' }),
    ).toEqual({ ok: false });
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
