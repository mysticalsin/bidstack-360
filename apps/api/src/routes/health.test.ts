import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';

import { healthRoute, metricsAccessAllowed, storageConfigReady } from './health.js';

describe('health route contract', () => {
  it('keeps liveness separate from dependency readiness', async () => {
    const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(healthRoute);

    const res = await app.inject({ method: 'GET', url: '/livez' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('treats local storage as not production-ready (non-demo)', () => {
    expect(storageConfigReady({ NODE_ENV: 'production', STORAGE_DRIVER: 'local' })).toBe(false);
  });

  it('allows local storage in production DEMO deployments', () => {
    // matches env.ts: STORAGE_DRIVER=local is permitted in prod when DEMO_MODE=true
    expect(storageConfigReady({ NODE_ENV: 'production', STORAGE_DRIVER: 'local', DEMO_MODE: 'true' })).toBe(true);
  });

  it('requires an S3 bucket when S3 storage is selected', () => {
    expect(storageConfigReady({ NODE_ENV: 'production', STORAGE_DRIVER: 's3' })).toBe(false);
    expect(
      storageConfigReady({
        NODE_ENV: 'production',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'bidstack-prod-files',
      }),
    ).toBe(true);
  });

  it('does not expose metrics publicly in production without an explicit bearer token', () => {
    expect(metricsAccessAllowed({}, { NODE_ENV: 'production' })).toBe(false);
    expect(
      metricsAccessAllowed(
        { authorization: 'Bearer correct-token' },
        { NODE_ENV: 'production', METRICS_BEARER_TOKEN: 'correct-token' },
      ),
    ).toBe(true);
    expect(
      metricsAccessAllowed(
        { authorization: 'Bearer wrong-token' },
        { NODE_ENV: 'production', METRICS_BEARER_TOKEN: 'correct-token' },
      ),
    ).toBe(false);
  });
});
