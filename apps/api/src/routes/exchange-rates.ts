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

// Covers connect, headers and body. Well under the client-side patience of a
// dashboard load, so a stalled provider degrades the UI instead of hanging it.
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
        },
      },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'private, max-age=900, stale-while-revalidate=3600');

      if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
        return cache.data;
      }

      const signal = AbortSignal.timeout(providerTimeoutMs);
      let res: Response;
      try {
        res = await fetch('https://open.er-api.com/v6/latest/EUR', {
          headers: { Accept: 'application/json' },
          signal,
        });
      } catch (err) {
        req.log.warn(
          { err: err instanceof Error ? err.message : String(err), timedOut: signal.aborted },
          'exchange rates upstream unreachable',
        );
        throw server.httpErrors.serviceUnavailable('Exchange rate provider unavailable');
      }

      if (!res.ok) {
        req.log.warn({ status: res.status }, 'exchange rates upstream error');
        throw server.httpErrors.serviceUnavailable('Exchange rate provider unavailable');
      }

      let upstream: Record<string, unknown>;
      try {
        upstream = (await res.json()) as Record<string, unknown>;
      } catch {
        if (signal.aborted) {
          req.log.warn({ timedOut: true }, 'exchange rates upstream body timed out');
          throw server.httpErrors.serviceUnavailable('Exchange rate provider unavailable');
        }
        throw server.httpErrors.badGateway('Invalid response from exchange rate provider');
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
        date: upstream.time_last_update_utc,
      };

      cache = { data, ts: Date.now() };
      return data;
    },
  );
};
