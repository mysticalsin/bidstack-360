import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { fetchWithTimeout, isProviderTimeoutError } from '../lib/fetch-timeout.js';

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

const ProviderFailureResponse = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
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

// fetchWithTimeout keeps the deadline armed through the body read. Well under
// the patience of a dashboard load, so a stalled provider degrades the UI
// instead of hanging it.
const PROVIDER_TIMEOUT_MS = 5_000;

export const exchangeRatesRoutes: FastifyPluginAsyncZod<{ providerTimeoutMs?: number }> = async (
  server,
  opts,
) => {
  const providerTimeoutMs = opts.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;

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
          502: ProviderFailureResponse,
          503: ProviderFailureResponse,
        },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'private, max-age=900, stale-while-revalidate=3600');

      if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
        return cache.data;
      }

      // The global error handler reports unmapped 5xx errors as a generic 500,
      // so provider failures are answered here with their own status.
      // Timeouts throw ProviderTimeoutError, which it maps to 504.
      const providerFailure = (statusCode: 502 | 503, message: string) =>
        reply
          .code(statusCode)
          .header('Cache-Control', 'no-store')
          .send({
            statusCode,
            error: statusCode === 503 ? 'Service Unavailable' : 'Bad Gateway',
            message,
          });

      let res: Response;
      try {
        res = await fetchWithTimeout('https://open.er-api.com/v6/latest/EUR', {
          headers: { Accept: 'application/json' },
          provider: 'Exchange rate provider',
          operation: 'latest rates',
          timeoutMs: providerTimeoutMs,
        });
      } catch (err) {
        if (isProviderTimeoutError(err)) {
          reply.header('Cache-Control', 'no-store');
          throw err;
        }
        req.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'exchange rates upstream unreachable',
        );
        return providerFailure(503, 'Exchange rate provider unavailable');
      }

      if (!res.ok) {
        req.log.warn({ status: res.status }, 'exchange rates upstream error');
        return providerFailure(503, 'Exchange rate provider unavailable');
      }

      let upstream: Record<string, unknown>;
      try {
        upstream = (await res.json()) as Record<string, unknown>;
      } catch (err) {
        if (isProviderTimeoutError(err)) {
          reply.header('Cache-Control', 'no-store');
          throw err;
        }
        return providerFailure(502, 'Invalid response from exchange rate provider');
      }
      if (
        !upstream ||
        typeof upstream !== 'object' ||
        upstream.result !== 'success' ||
        !upstream.rates ||
        typeof upstream.rates !== 'object' ||
        typeof upstream.time_last_update_utc !== 'string' ||
        !upstream.time_last_update_utc
      ) {
        return providerFailure(502, 'Invalid response from exchange rate provider');
      }

      const base = normalizeCurrencyCode(
        typeof upstream.base_code === 'string' ? upstream.base_code : 'EUR',
      );
      const rates = normalizeRates(upstream.rates as Record<string, unknown>);
      if (!hasRequiredCurrencyCoverage(base, rates)) {
        req.log.warn({ base }, 'exchange rates missing required CRM currencies');
        return providerFailure(502, 'Exchange rate provider missing required currencies');
      }

      const data: CachedRates = {
        base,
        rates,
        date: upstream.time_last_update_utc,
      };

      cache = { data, ts: Date.now() };
      return data;
    },
  );
};
