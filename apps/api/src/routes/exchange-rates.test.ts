import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandlerPlugin } from '../plugins/error-handler.js';
import { exchangeRatesRoutes, resetExchangeRatesCacheForTest } from './exchange-rates.js';

// The production error handler masks unmapped 5xx errors as 500, so status
// expectations only mean something with it registered.
async function buildApp(opts: { providerTimeoutMs?: number } = {}) {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(errorHandlerPlugin);
  await app.register(exchangeRatesRoutes, opts);
  return app;
}

describe('exchange rates route', () => {
  beforeEach(() => {
    resetExchangeRatesCacheForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetExchangeRatesCacheForTest();
  });

  it('returns normalized current rates for every CRM display currency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        result: 'success',
        base_code: 'eur',
        time_last_update_utc: 'Sun, 31 May 2026 00:00:01 +0000',
        rates: fullRates(),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=900');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.json()).toMatchObject({
      base: 'EUR',
      date: 'Sun, 31 May 2026 00:00:01 +0000',
      rates: {
        BRL: 6,
        COP: 4500,
        CLP: 1000,
        USD: 1.1,
        CAD: 1.5,
      },
    });

    await app.close();
  });

  it('rejects provider payloads missing Americas currencies before clients cache them', async () => {
    const rates = fullRates();
    delete rates.BRL;
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        result: 'success',
        base_code: 'EUR',
        time_last_update_utc: 'Sun, 31 May 2026 00:00:01 +0000',
        rates,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(res.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await app.close();
  });

  // WHY: the provider is a third party on the public internet. When it cannot
  // be reached the client must get the documented "provider unavailable"
  // answer it backs off on, not an unhandled 500 that reads as an app crash.
  it('answers 503 when the provider cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ message: 'Exchange rate provider unavailable' });
    // A cacheable failure would keep the browser on "unavailable" for 15 minutes.
    expect(res.headers['cache-control']).toBe('no-store');

    await app.close();
  });

  // WHY: without a deadline a provider that accepts the connection and never
  // answers holds every dashboard request open indefinitely.
  it('gives up on a provider that never answers, within the deadline', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp({ providerTimeoutMs: 50 });
    const started = Date.now();
    const res = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(res.statusCode).toBe(504);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    await app.close();
  });

  it('gives up on a provider that sends headers and then stalls the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, init?: RequestInit) =>
          new Response(
            // Headers arrive, then the body never completes until the request is aborted.
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener('abort', () =>
                  controller.error(init.signal?.reason),
                );
              },
            }),
            { status: 200 },
          ),
      ),
    );

    const app = await buildApp({ providerTimeoutMs: 50 });
    const res = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(res.statusCode).toBe(504);

    await app.close();
  });

  it('answers 502 when the provider body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 })),
    );

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(res.statusCode).toBe(502);

    await app.close();
  });

  // WHY: the date tells users how old the rates are. Stamping "now" on a
  // payload that carries no date would present rates of unknown age as fresh.
  it('rejects a payload without a provider date instead of stamping it as current', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(okJson({ result: 'success', base_code: 'EUR', rates: fullRates() })),
    );

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(res.statusCode).toBe(502);

    await app.close();
  });

  it('recovers on the next request once the provider is back, without caching the failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(
        okJson({
          result: 'success',
          base_code: 'EUR',
          time_last_update_utc: 'Sun, 31 May 2026 00:00:01 +0000',
          rates: fullRates(),
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    const down = await app.inject({ method: 'GET', url: '/exchange-rates' });
    const up = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(down.statusCode).toBe(503);
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ base: 'EUR', rates: { BRL: 6 } });

    await app.close();
  });

  // WHY: expired rates must not be served as if current while the provider
  // is down; the client then shows amounts in their stored currency instead.
  it('does not serve expired cached rates while the provider is down', async () => {
    const now = vi.spyOn(Date, 'now');
    const t0 = Date.UTC(2026, 10, 9);
    now.mockReturnValue(t0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        okJson({
          result: 'success',
          base_code: 'EUR',
          time_last_update_utc: 'Sun, 31 May 2026 00:00:01 +0000',
          rates: fullRates(),
        }),
      )
      .mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/exchange-rates' })).statusCode).toBe(200);
    now.mockReturnValue(t0 + 60 * 60 * 1000 + 1);
    const expired = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(expired.statusCode).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now.mockRestore();
    await app.close();
  });
});

function okJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

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
