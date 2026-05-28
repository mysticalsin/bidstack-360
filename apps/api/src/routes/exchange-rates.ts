import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

export const exchangeRatesRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/exchange-rates',
    {
      // Rate-limit this public endpoint: unauthenticated callers are capped at
      // 30 req/min per IP. The 1-hour cache already prevents upstream hammering,
      // but without this a single IP could still saturate the Fastify process.
      // rateLimit lives inside config — that's where @fastify/rate-limit reads it.
      config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        response: {
          200: ExchangeRatesResponse,
        },
      },
    },
    async (req, _reply) => {
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
        !upstream.rates ||
        typeof upstream.rates !== 'object'
      ) {
        throw server.httpErrors.badGateway('Invalid response from exchange rate provider');
      }

      const data: CachedRates = {
        base: (upstream.base_code as string) ?? 'EUR',
        rates: upstream.rates as Record<string, number>,
        date: (upstream.time_last_update_utc as string) ?? new Date().toISOString(),
      };

      cache = { data, ts: Date.now() };
      return data;
    },
  );
};
