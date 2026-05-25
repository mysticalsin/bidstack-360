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
  rates: ExchangeRates | null;
  ratesLoading: boolean;
  ratesError: string | null;
  setCurrency: (c: CurrencyCode) => void;
  fetchRates: () => Promise<void>;
  convert: (amount: number, from: string) => number;
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
      currency: 'EUR',
      rates: loadCachedRates(),
      ratesLoading: false,
      ratesError: null,

      setCurrency: (currency) => set({ currency }),

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
          const data = await res.json() as { rates?: unknown; base?: string; date?: string };
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
        const fromRate = rates.rates[from];
        const toRate = rates.rates[to];
        if (!fromRate || !toRate) return amount;
        // Convert: amount / fromRate * toRate  (rates are all relative to EUR base)
        return (amount / fromRate) * toRate;
      },
    }),
    {
      name: 'bidstack:currency-locale',
      partialize: (state) => ({ currency: state.currency }),
    }
  )
);
