import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exchangeRatesRoutes, resetExchangeRatesCacheForTest } from './exchange-rates.js';

async function buildApp() {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(exchangeRatesRoutes);
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
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: 'success',
        base_code: 'eur',
        time_last_update_utc: 'Sun, 31 May 2026 00:00:01 +0000',
        rates: fullRates(),
      }),
    } as Response);
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
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: 'success',
        base_code: 'EUR',
        time_last_update_utc: 'Sun, 31 May 2026 00:00:01 +0000',
        rates,
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/exchange-rates' });

    expect(res.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await app.close();
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
