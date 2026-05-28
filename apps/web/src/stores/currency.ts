import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const RATES_KEY = 'bidstack:exchange-rates';
const RATES_TS_KEY = 'bidstack:exchange-rates-ts';

export const SUPPORTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'];

interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  date: string;
}

interface CurrencyStore {
  currency: CurrencyCode;
  autoDetect: boolean;
  rates: ExchangeRates | null;
  ratesLoading: boolean;
  ratesError: string | null;
  setCurrency: (c: CurrencyCode) => void;
  enableAutoDetect: () => void;
  fetchRates: () => Promise<void>;
  convert: (amount: number, from: string) => number;
}

export function detectLocalCurrency(): CurrencyCode {
  try {
    const resolvedOptions = new Intl.NumberFormat().resolvedOptions();
    const locale = resolvedOptions.locale || navigator.language || '';

    if (locale.endsWith('-US') || locale === 'en-US') return 'USD';
    if (locale.endsWith('-GB') || locale === 'en-GB') return 'GBP';
    if (locale.endsWith('-CA') || locale === 'en-CA') return 'CAD';
    if (locale.endsWith('-AU') || locale === 'en-AU') return 'AUD';
    if (locale.endsWith('-JP') || locale === 'ja-JP') return 'JPY';
    if (locale.endsWith('-SE') || locale === 'sv-SE') return 'SEK';
    if (locale.endsWith('-NO') || locale === 'nb-NO' || locale === 'nn-NO') return 'NOK';
    if (locale.endsWith('-DK') || locale === 'da-DK') return 'DKK';
    if (locale.endsWith('-CH') || locale === 'de-CH' || locale === 'fr-CH' || locale === 'it-CH')
      return 'CHF';

    const lang = (locale.split('-')[0] ?? '').toLowerCase();
    if (lang === 'ja') return 'JPY';
    if (lang === 'sv') return 'SEK';
    if (lang === 'no' || lang === 'nb' || lang === 'nn') return 'NOK';
    if (lang === 'da') return 'DKK';

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) {
      if (
        tz.includes('New_York') ||
        tz.includes('Chicago') ||
        tz.includes('Denver') ||
        tz.includes('Los_Angeles')
      ) {
        return 'USD';
      }
      if (tz.includes('London')) return 'GBP';
      if (tz.includes('Toronto') || tz.includes('Vancouver')) return 'CAD';
      if (tz.includes('Sydney') || tz.includes('Melbourne')) return 'AUD';
      if (tz.includes('Tokyo')) return 'JPY';
      if (tz.includes('Stockholm')) return 'SEK';
      if (tz.includes('Oslo')) return 'NOK';
      if (tz.includes('Copenhagen')) return 'DKK';
      if (tz.includes('Zurich')) return 'CHF';
    }
  } catch {
    // ignore
  }
  return 'EUR';
}

function loadCachedRates(): ExchangeRates | null {
  try {
    const ts = localStorage.getItem(RATES_TS_KEY);
    if (!ts) return null;
    const age = Date.now() - Number(ts);
    if (age > 1000 * 60 * 60 * 6) return null; // 6 hours stale
    const raw = localStorage.getItem(RATES_KEY);
    if (raw) return JSON.parse(raw) as ExchangeRates;
  } catch {
    // ignore
  }
  return null;
}

export const useCurrencyStore = create<CurrencyStore>()(
  persist(
    (set, get) => ({
      currency: detectLocalCurrency(),
      autoDetect: true,
      rates: loadCachedRates(),
      ratesLoading: false,
      ratesError: null,

      setCurrency: (currency) => set({ currency, autoDetect: false }),
      enableAutoDetect: () => set({ autoDetect: true, currency: detectLocalCurrency() }),

      fetchRates: async () => {
        const cached = loadCachedRates();
        if (cached) {
          set({ rates: cached, ratesError: null });
          return;
        }
        set({ ratesLoading: true, ratesError: null });
        try {
          const res = await fetch('/api/v1/exchange-rates', { credentials: 'include' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { rates?: unknown; base?: string; date?: string };
          if (!data.rates || typeof data.rates !== 'object') throw new Error('Invalid rate data');
          const rates: ExchangeRates = {
            base: data.base ?? 'EUR',
            rates: data.rates as Record<string, number>,
            date: data.date ?? new Date().toISOString(),
          };
          try {
            localStorage.setItem(RATES_KEY, JSON.stringify(rates));
            localStorage.setItem(RATES_TS_KEY, String(Date.now()));
          } catch {
            // ignore
          }
          set({ rates, ratesLoading: false, ratesError: null });
        } catch (err) {
          set({
            ratesLoading: false,
            ratesError: err instanceof Error ? err.message : 'Failed to load rates',
          });
        }
      },

      convert: (amount, from) => {
        const { currency: to, rates } = get();
        if (!rates || !rates.rates) return amount;
        if (from === to) return amount;
        const fromRate = from === rates.base ? 1.0 : rates.rates[from];
        const toRate = to === rates.base ? 1.0 : rates.rates[to];
        if (fromRate === undefined || toRate === undefined) return amount;
        // Convert: amount / fromRate * toRate  (rates are all relative to EUR base)
        return (amount / fromRate) * toRate;
      },
    }),
    {
      name: 'bidstack:currency-locale',
      partialize: (state) => ({ currency: state.currency, autoDetect: state.autoDetect }),
    },
  ),
);
