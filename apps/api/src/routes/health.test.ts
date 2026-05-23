import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';

import { healthRoute, storageConfigReady } from './health.js';

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

  it('treats local storage as not production-ready', () => {
    expect(storageConfigReady({ NODE_ENV: 'production', STORAGE_DRIVER: 'local' })).toBe(false);
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
});
