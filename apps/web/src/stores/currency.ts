import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { ORG_LOCALE_DEFAULT } from '@bidstack/shared';

import { buildApiUrl } from '@/lib/api';

const RATES_KEY = 'bidstack:exchange-rates';
const RATES_TS_KEY = 'bidstack:exchange-rates-ts';
const RATES_CACHE_TTL_MS = 60 * 60 * 1000;

export const SUPPORTED_CURRENCIES = [
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'COP', name: 'Colombian Peso', symbol: 'COL$' },
  { code: 'CLP', name: 'Chilean Peso', symbol: 'CLP$' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'];

export interface ExchangeRateTable {
  base: string;
  rates: Record<string, number>;
  date: string;
}

interface CurrencyStore {
  currency: CurrencyCode;
  /** True only after the user picked "Auto" (browser location, then time zone). */
  autoDetect: boolean;
  /** True until the user picks a currency or "Auto": display follows the workspace currency. */
  followOrg: boolean;
  /** Last workspace currency seen from Settings, Currency and locale. */
  orgCurrency: CurrencyCode | null;
  rates: ExchangeRateTable | null;
  ratesLoading: boolean;
  ratesError: string | null;
  setCurrency: (c: CurrencyCode) => void;
  enableAutoDetect: () => Promise<void>;
  /** Record the workspace currency; applied when the display follows it. */
  applyOrgCurrency: (code: string) => void;
  /** Go back to following the workspace currency. */
  followOrgDefault: () => void;
  fetchRates: () => Promise<void>;
  convert: (amount: number, from: string) => number;
}

let inflightRatesRequest: Promise<void> | null = null;
let ratesRetryAt = 0;
let ratesFetchedAt = 0;

function normalizeCurrencyCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

function asSupportedCurrency(code: string | null | undefined): CurrencyCode | null {
  const c = normalizeCurrencyCode(code);
  return SUPPORTED_CURRENCIES.some((s) => s.code === c) ? (c as CurrencyCode) : null;
}

/** Workspace default until the org setting loads; never the browser time zone. */
const INITIAL_CURRENCY: CurrencyCode = asSupportedCurrency(ORG_LOCALE_DEFAULT.currency) ?? 'EUR';

type PersistedCurrency = Partial<Pick<CurrencyStore, 'currency' | 'autoDetect' | 'followOrg' | 'orgCurrency'>>;

/**
 * Older builds persisted only { currency, autoDetect } with autoDetect true by
 * default, so a time-zone guess (R$ for a UTC-3 browser) stuck. Without an
 * explicit pick, follow the workspace currency instead.
 */
export function migratePersistedCurrency(persisted: PersistedCurrency): PersistedCurrency {
  if (persisted.followOrg !== undefined) return persisted;
  const picked = persisted.autoDetect === false;
  return {
    ...persisted,
    autoDetect: false,
    followOrg: !picked,
    ...(picked ? {} : { currency: persisted.orgCurrency ?? INITIAL_CURRENCY }),
  };
}

function isUsableRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

export type ConversionOutcome = { ok: true; amount: number } | { ok: false };

/**
 * Whether `amount` in `from` can be shown in `to`.
 * Same currency is success. A missing or unusable rate is failure.
 * The number returned on success is the converted amount, including a real
 * 1:1 rate. Failure does not invent an amount.
 */
export function conversionOutcome(
  amount: number,
  from: string,
  to: string,
  rates: ExchangeRateTable | null,
): ConversionOutcome {
  const source = normalizeCurrencyCode(from);
  const target = normalizeCurrencyCode(to);
  if (!Number.isFinite(amount) || !source || !target) return { ok: false };
  if (source === target) return { ok: true, amount };
  if (!rates?.rates) return { ok: false };
  const base = normalizeCurrencyCode(rates.base);
  if (!base) return { ok: false };
  const fromRate = source === base ? 1.0 : rates.rates[source];
  const toRate = target === base ? 1.0 : rates.rates[target];
  if (!isUsableRate(fromRate) || !isUsableRate(toRate)) return { ok: false };
  const converted = (amount / fromRate) * toRate;
  if (!Number.isFinite(converted)) return { ok: false };
  return { ok: true, amount: converted };
}

/**
 * How two currency codes relate, without looking at an amount.
 * `parity` means the two rate quotes are the same number, so a 1:1
 * conversion does not change the stored integer. It is not a comparison
 * of the money before and after, and it is not a failure signal.
 */
export type RateRelation = 'same' | 'parity' | 'cross' | 'unavailable';

export function rateRelation(
  from: string,
  to: string,
  rates: ExchangeRateTable | null,
): RateRelation {
  const source = normalizeCurrencyCode(from);
  const target = normalizeCurrencyCode(to);
  if (!source || !target) return 'unavailable';
  if (source === target) return 'same';
  if (!rates?.rates) return 'unavailable';
  const base = normalizeCurrencyCode(rates.base);
  if (!base) return 'unavailable';
  const fromRate = source === base ? 1.0 : rates.rates[source];
  const toRate = target === base ? 1.0 : rates.rates[target];
  if (!isUsableRate(fromRate) || !isUsableRate(toRate)) return 'unavailable';
  if (fromRate === toRate) return 'parity';
  return 'cross';
}

const REGION_TO_CURRENCY: Partial<Record<string, CurrencyCode>> = {
  AT: 'EUR',
  BE: 'EUR',
  BR: 'BRL',
  CY: 'EUR',
  DE: 'EUR',
  EE: 'EUR',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  GR: 'EUR',
  HR: 'EUR',
  IE: 'EUR',
  IT: 'EUR',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  MT: 'EUR',
  NL: 'EUR',
  PT: 'EUR',
  SI: 'EUR',
  SK: 'EUR',
  CL: 'CLP',
  CO: 'COP',
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  AU: 'AUD',
  JP: 'JPY',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  CH: 'CHF',
};

const TIMEZONE_TO_CURRENCY: Array<[pattern: RegExp, currency: CurrencyCode]> = [
  [
    /^America\/(Sao_Paulo|Bahia|Belem|Fortaleza|Recife|Araguaina|Maceio|Cuiaba|Campo_Grande|Manaus|Boa_Vista|Porto_Velho|Rio_Branco|Noronha)$/i,
    'BRL',
  ],
  [/^America\/Bogota$/i, 'COP'],
  [/^America\/Santiago$/i, 'CLP'],
  [
    /^America\/(Toronto|Vancouver|Montreal|Winnipeg|Edmonton|Halifax|St_Johns|Regina|Whitehorse|Yellowknife|Iqaluit|Moncton|Atikokan|Blanc-Sablon|Cambridge_Bay|Creston|Dawson|Dawson_Creek|Fort_Nelson|Glace_Bay|Goose_Bay|Inuvik|Nipigon|Pangnirtung|Rainy_River|Rankin_Inlet|Resolute|Swift_Current|Thunder_Bay)$/i,
    'CAD',
  ],
  [
    /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Adak|Detroit|Indiana\/.*|Kentucky\/.*|Boise|Juneau|Metlakatla|Nome|Sitka|Yakutat|Menominee|North_Dakota\/.*)$/i,
    'USD',
  ],
  [
    /^Europe\/(Amsterdam|Andorra|Athens|Belgrade|Berlin|Bratislava|Brussels|Busingen|Dublin|Gibraltar|Helsinki|Lisbon|Ljubljana|Luxembourg|Madrid|Malta|Monaco|Paris|Podgorica|Prague|Riga|Rome|San_Marino|Sarajevo|Skopje|Tallinn|Tirane|Vaduz|Vatican|Vienna|Vilnius|Warsaw|Zagreb)$/i,
    'EUR',
  ],
  [/^Europe\/London$/i, 'GBP'],
  [
    /^Australia\/(Sydney|Melbourne|Brisbane|Perth|Adelaide|Darwin|Hobart|Canberra|Lord_Howe)$/i,
    'AUD',
  ],
  [/^Asia\/Tokyo$/i, 'JPY'],
  [/^Europe\/Stockholm$/i, 'SEK'],
  [/^Europe\/Oslo$/i, 'NOK'],
  [/^Europe\/Copenhagen$/i, 'DKK'],
  [/^Europe\/Zurich$/i, 'CHF'],
];

const LANGUAGE_FALLBACK_TO_CURRENCY: Partial<Record<string, CurrencyCode>> = {
  pt: 'BRL',
  ja: 'JPY',
  sv: 'SEK',
  no: 'NOK',
  nb: 'NOK',
  nn: 'NOK',
  da: 'DKK',
};

const GEOLOCATION_TIMEOUT_MS = 3500;

type GeoCurrencyRegion = {
  currency: CurrencyCode;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

const GEO_CURRENCY_REGIONS: GeoCurrencyRegion[] = [
  { currency: 'COP', minLat: -5, maxLat: 14, minLon: -82, maxLon: -66 },
  { currency: 'CLP', minLat: -56, maxLat: -17, minLon: -76, maxLon: -66 },
  { currency: 'BRL', minLat: -34, maxLat: 6, minLon: -74, maxLon: -34 },
  { currency: 'CAD', minLat: 41, maxLat: 84, minLon: -142, maxLon: -52 },
  { currency: 'USD', minLat: 18, maxLat: 72, minLon: -170, maxLon: -66 },
  { currency: 'EUR', minLat: 35, maxLat: 72, minLon: -11, maxLon: 35 },
  { currency: 'GBP', minLat: 49, maxLat: 61, minLon: -9, maxLon: 3 },
  { currency: 'AUD', minLat: -44, maxLat: -10, minLon: 112, maxLon: 154 },
  { currency: 'CHF', minLat: 45, maxLat: 48, minLon: 5, maxLon: 11 },
  { currency: 'JPY', minLat: 24, maxLat: 46, minLon: 123, maxLon: 146 },
  { currency: 'SEK', minLat: 55, maxLat: 70, minLon: 10, maxLon: 25 },
  { currency: 'NOK', minLat: 57, maxLat: 72, minLon: 4, maxLon: 32 },
  { currency: 'DKK', minLat: 54, maxLat: 58, minLon: 8, maxLon: 16 },
];

function currencyFromTimeZone(timeZone: string | undefined): CurrencyCode | null {
  if (!timeZone) return null;
  return TIMEZONE_TO_CURRENCY.find(([pattern]) => pattern.test(timeZone))?.[1] ?? null;
}

function currencyFromLocale(locale: string | undefined): CurrencyCode | null {
  if (!locale) return null;
  const normalized = locale.replace('_', '-');
  const region = normalized
    .split('-')
    .slice(1)
    .find((part) => /^[A-Z]{2}$/i.test(part))
    ?.toUpperCase();
  if (region && REGION_TO_CURRENCY[region]) return REGION_TO_CURRENCY[region] ?? null;
  const language = normalized.split('-')[0]?.toLowerCase();
  return language ? (LANGUAGE_FALLBACK_TO_CURRENCY[language] ?? null) : null;
}

export function currencyFromCoordinates(latitude: number, longitude: number): CurrencyCode | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return (
    GEO_CURRENCY_REGIONS.find(
      (region) =>
        latitude >= region.minLat &&
        latitude <= region.maxLat &&
        longitude >= region.minLon &&
        longitude <= region.maxLon,
    )?.currency ?? null
  );
}

async function detectCurrencyFromGeolocation(): Promise<CurrencyCode | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), GEOLOCATION_TIMEOUT_MS + 250);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer);
        resolve(currencyFromCoordinates(position.coords.latitude, position.coords.longitude));
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      {
        enableHighAccuracy: false,
        maximumAge: 1000 * 60 * 60,
        timeout: GEOLOCATION_TIMEOUT_MS,
      },
    );
  });
}

function normalizeExchangeRates(data: unknown): ExchangeRateTable | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as { base?: unknown; rates?: unknown; date?: unknown };
  if (!raw.rates || typeof raw.rates !== 'object') return null;

  const base = normalizeCurrencyCode(typeof raw.base === 'string' ? raw.base : 'EUR');
  if (!base) return null;

  const rates = Object.fromEntries(
    Object.entries(raw.rates as Record<string, unknown>)
      .map(([code, rate]) => [normalizeCurrencyCode(code), rate] as const)
      .filter(([code, rate]) => Boolean(code) && isUsableRate(rate)),
  ) as Record<string, number>;

  const hasRequiredCoverage = SUPPORTED_CURRENCIES.every(
    ({ code }) => code === base || isUsableRate(rates[code]),
  );
  if (!hasRequiredCoverage) return null;

  return {
    base,
    rates,
    date: typeof raw.date === 'string' && raw.date ? raw.date : new Date().toISOString(),
  };
}

export function detectLocalCurrency(): CurrencyCode {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeZoneCurrency = currencyFromTimeZone(timeZone);
    if (timeZoneCurrency) return timeZoneCurrency;

    const resolvedOptions = new Intl.NumberFormat().resolvedOptions();
    const localeCurrency = currencyFromLocale(resolvedOptions.locale);
    if (localeCurrency) return localeCurrency;

    if (typeof navigator !== 'undefined') {
      const browserLocales = [navigator.language, ...(navigator.languages ?? [])];
      for (const locale of browserLocales) {
        const browserCurrency = currencyFromLocale(locale);
        if (browserCurrency) return browserCurrency;
      }
    }
  } catch {
    // ignore
  }
  return 'EUR';
}

function loadCachedRates(): ExchangeRateTable | null {
  try {
    const ts = localStorage.getItem(RATES_TS_KEY);
    if (!ts) return null;
    const age = Date.now() - Number(ts);
    if (age > RATES_CACHE_TTL_MS) return null;
    const raw = localStorage.getItem(RATES_KEY);
    const rates = raw ? normalizeExchangeRates(JSON.parse(raw)) : null;
    if (rates) ratesFetchedAt = Number(ts);
    return rates;
  } catch {
    // ignore
  }
  return null;
}

export const useCurrencyStore = create<CurrencyStore>()(
  persist(
    (set, get) => ({
      currency: INITIAL_CURRENCY,
      autoDetect: false,
      followOrg: true,
      orgCurrency: null,
      rates: loadCachedRates(),
      ratesLoading: false,
      ratesError: null,

      setCurrency: (currency) => set({ currency, autoDetect: false, followOrg: false }),
      enableAutoDetect: async () => {
        set({ autoDetect: true, followOrg: false, currency: detectLocalCurrency() });
        const preciseCurrency = await detectCurrencyFromGeolocation();
        if (preciseCurrency && get().autoDetect) {
          set({ currency: preciseCurrency });
        }
      },
      applyOrgCurrency: (code) => {
        const orgCurrency = asSupportedCurrency(code);
        if (!orgCurrency) return;
        set(get().followOrg ? { orgCurrency, currency: orgCurrency } : { orgCurrency });
      },
      followOrgDefault: () =>
        set({ followOrg: true, autoDetect: false, currency: get().orgCurrency ?? INITIAL_CURRENCY }),

      fetchRates: async () => {
        const currentRatesTs = Number(localStorage.getItem(RATES_TS_KEY));
        const fetchedAt = Math.max(ratesFetchedAt, Number.isFinite(currentRatesTs) ? currentRatesTs : 0);
        if (get().rates && Date.now() - fetchedAt <= RATES_CACHE_TTL_MS) {
          return;
        }
        const cached = loadCachedRates();
        if (cached) {
          set({ rates: cached, ratesError: null });
          return;
        }
        if (inflightRatesRequest) return inflightRatesRequest;
        // Past this point any rates still held are older than the TTL. A failed
        // refresh drops them so conversions fall back to the stored currency.
        if (Date.now() < ratesRetryAt) {
          set({ ratesLoading: false, rates: null, ratesError: 'Exchange rates unavailable' });
          return;
        }
        set({ ratesLoading: true, ratesError: null });
        inflightRatesRequest = (async () => {
          // buildApiUrl prefixes the configured API origin (VITE_API_URL) — a
          // raw '/api/...' would hit the SPA's own origin, which on a split
          // SPA/API deploy is the static host (returns index.html, not JSON).
          const res = await fetch(buildApiUrl('/api/v1/exchange-rates'), {
            credentials: 'include',
          });
          if (!res.ok) {
            const retryAfterSeconds = Number(res.headers.get('Retry-After'));
            ratesRetryAt =
              Date.now() +
              (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                ? retryAfterSeconds * 1000
                : 60_000);
            throw new Error(
              res.status === 429 ? 'Exchange rates rate limited' : `HTTP ${res.status}`,
            );
          }
          const rates = normalizeExchangeRates(await res.json());
          if (!rates) throw new Error('Exchange rates missing required CRM currencies');
          try {
            localStorage.setItem(RATES_KEY, JSON.stringify(rates));
            localStorage.setItem(RATES_TS_KEY, String(Date.now()));
          } catch {
            // ignore
          }
          ratesFetchedAt = Date.now();
          set({ rates, ratesLoading: false, ratesError: null });
        })()
          .catch((err) => {
            set({
              ratesLoading: false,
              rates: null,
              ratesError: err instanceof Error ? err.message : 'Failed to load rates',
            });
          })
          .finally(() => {
            inflightRatesRequest = null;
          });

        return inflightRatesRequest;
      },

      convert: (amount, from) => {
        const { currency: to, rates } = get();
        const outcome = conversionOutcome(amount, from, to, rates);
        // Callers of convert() still receive a number. A failed conversion
        // returns the original amount; the formatters decide the label.
        if (outcome.ok) return outcome.amount;
        return amount;
      },
    }),
    {
      name: 'bidstack:currency-locale',
      partialize: (state) => ({
        currency: state.currency,
        autoDetect: state.autoDetect,
        followOrg: state.followOrg,
        orgCurrency: state.orgCurrency,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...migratePersistedCurrency((persisted ?? {}) as PersistedCurrency),
      }),
    },
  ),
);
