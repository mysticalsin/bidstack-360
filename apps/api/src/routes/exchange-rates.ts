import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const REQUIRED_CURRENCIES = [
  'BRL',
  'COP',
  'CLP',
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'AUD',
  'CHF',
  'JPY',
  'SEK',
  'NOK',
  'DKK',
] as const;

interface CachedRates {
  base: string;
  rates: Record<string, number>;
  date: string;
}

let cache: { data: CachedRates; ts: number } | null = null;

const ExchangeRatesResponse = z.object({
  base: z.string(),
  rates: z.record(z.number()),
  date: z.string(),
});

function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}

function isUsableRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

function normalizeRates(rates: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(rates)
      .map(([code, rate]) => [normalizeCurrencyCode(code), rate] as const)
      .filter(([code, rate]) => Boolean(code) && isUsableRate(rate)),
  ) as Record<string, number>;
}

function hasRequiredCurrencyCoverage(base: string, rates: Record<string, number>): boolean {
  return REQUIRED_CURRENCIES.every((code) => code === base || isUsableRate(rates[code]));
}

export function resetExchangeRatesCacheForTest(): void {
  cache = null;
}

export const exchangeRatesRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/exchange-rates',
    {
      // Rate-limit this public endpoint: the app shell may request it from many
      // tabs/pages on one IP, while the 1-hour server cache protects the upstream.
      // rateLimit lives inside config — that's where @fastify/rate-limit reads it.
      config: { public: true, rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: ExchangeRatesResponse,
        },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'private, max-age=900, stale-while-revalidate=3600');

      if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
        return cache.data;
      }

      const res = await fetch('https://open.er-api.com/v6/latest/EUR', {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        req.log.warn({ status: res.status }, 'exchange rates upstream error');
        throw server.httpErrors.serviceUnavailable('Exchange rate provider unavailable');
      }

      const upstream = (await res.json()) as Record<string, unknown>;
      if (
        !upstream ||
        typeof upstream !== 'object' ||
        upstream.result !== 'success' ||
        !upstream.rates ||
        typeof upstream.rates !== 'object'
      ) {
        throw server.httpErrors.badGateway('Invalid response from exchange rate provider');
      }

      const base = normalizeCurrencyCode(
        typeof upstream.base_code === 'string' ? upstream.base_code : 'EUR',
      );
      const rates = normalizeRates(upstream.rates as Record<string, unknown>);
      if (!hasRequiredCurrencyCoverage(base, rates)) {
        req.log.warn({ base }, 'exchange rates missing required CRM currencies');
        throw server.httpErrors.badGateway('Exchange rate provider missing required currencies');
      }

      const data: CachedRates = {
        base,
        rates,
        date: (upstream.time_last_update_utc as string) ?? new Date().toISOString(),
      };

      cache = { data, ts: Date.now() };
      return data;
    },
  );
};
