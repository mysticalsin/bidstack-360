import { describe, expect, it } from 'vitest';

import { validateWorkerProductionEnv } from './production-env.js';

const validProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://bidstack:test@postgres:5432/bidstack',
  REDIS_URL: 'redis://:test@redis:6379',
  INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'bidstack-prod-files',
  S3_REGION: 'us-east-1',
};

describe('worker production env contract', () => {
  it('does not enforce production-only secrets in development', () => {
    expect(validateWorkerProductionEnv({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('requires the universal production dependencies before queues start', () => {
    expect(validateWorkerProductionEnv({ NODE_ENV: 'production' })).toEqual([
      'DATABASE_URL is required in production',
      'REDIS_URL is required in production',
      'INTEGRATION_TOKEN_KEY must be a 64-character hex string in production',
      'STORAGE_DRIVER=s3 is required in production',
    ]);
  });

  it('rejects legacy or malformed integration token keys', () => {
    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        INTEGRATION_TOKEN_KEY: 'legacy-base64-looking-key-value-that-is-not-hex',
      }),
    ).toContain('INTEGRATION_TOKEN_KEY must be a 64-character hex string in production');

    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        INTEGRATION_TOKEN_KEY: 'z'.repeat(64),
      }),
    ).toContain('INTEGRATION_TOKEN_KEY must be a 64-character hex string in production');
  });

  it('requires durable S3 storage for non-demo production workers', () => {
    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        STORAGE_DRIVER: 'local',
      }),
    ).toContain('STORAGE_DRIVER=s3 is required in production');
  });

  it('requires S3 bucket and region when S3 storage is active', () => {
    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        S3_BUCKET: '',
        S3_REGION: '',
      }),
    ).toEqual([
      'S3_BUCKET is required when STORAGE_DRIVER=s3',
      'S3_REGION is required when STORAGE_DRIVER=s3',
    ]);
  });

  it('allows an explicitly acknowledged public demo to use local ephemeral storage', () => {
    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        DEMO_MODE: 'true',
        STORAGE_DRIVER: 'local',
        S3_BUCKET: '',
        S3_REGION: '',
      }),
    ).toEqual([]);
  });

  it('accepts a complete production env', () => {
    expect(validateWorkerProductionEnv(validProductionEnv)).toEqual([]);
  });
});
