import { describe, expect, it } from 'vitest';

import { validateWorkerProductionEnv } from './production-env.js';

const validProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://bidstack:test@postgres:5432/bidstack',
  REDIS_URL: 'redis://:test@redis:6379',
  INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
  PII_FIELD_ENCRYPTION: 'true',
  PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'bidstack-prod-files',
  S3_REGION: 'us-east-1',
  BIDSTACK_JOB_SIGNING_SECRET: 'b'.repeat(64),
  BIDSTACK_TENANT_SCOPE_GUARD: 'enforce',
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
      'PII_FIELD_ENCRYPTION=true is required in production',
      'PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string in production',
      'BIDSTACK_JOB_SIGNING_SECRET is required in production',
      "BIDSTACK_TENANT_SCOPE_GUARD must be 'warn' or 'enforce' in production",
      'STORAGE_DRIVER=s3 is required in production',
    ]);
  });

  it('requires the tenant-scope guard set to warn or enforce in production', () => {
    // BIDSTACK_TENANT_SCOPE_GUARD defaults 'off' for backward compatibility, but
    // the worker shares the same @bidstack/db Prisma client (and its middleware
    // stack) as the API, so an unscoped query here is the same all-tenants leak.
    expect(
      validateWorkerProductionEnv({ ...validProductionEnv, BIDSTACK_TENANT_SCOPE_GUARD: 'off' }),
    ).toContain("BIDSTACK_TENANT_SCOPE_GUARD must be 'warn' or 'enforce' in production");

    expect(
      validateWorkerProductionEnv({ ...validProductionEnv, BIDSTACK_TENANT_SCOPE_GUARD: 'warn' }),
    ).toEqual([]);
  });

  it('rejects loopback or malformed Redis URLs in production', () => {
    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        REDIS_URL: 'redis://localhost:6380',
      }),
    ).toContain('REDIS_URL must not point at localhost or loopback in production');

    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        REDIS_URL: 'redis://127.0.0.1:6380',
      }),
    ).toContain('REDIS_URL must not point at localhost or loopback in production');

    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        REDIS_URL: 'not-a-redis-url',
      }),
    ).toEqual(['REDIS_URL must be a valid Redis URL in production']);
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

  it('requires PII encryption and a valid PII master key in production', () => {
    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        PII_FIELD_ENCRYPTION: 'false',
      }),
    ).toContain('PII_FIELD_ENCRYPTION=true is required in production');

    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        PII_ENCRYPTION_MASTER_KEY: 'z'.repeat(64),
      }),
    ).toContain('PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string in production');
  });

  it('rejects truthy-looking PII flags that the DB middleware would ignore', () => {
    // isPiiEncryptionEnabled (packages/db/src/middleware/pii-encryption.ts)
    // does a strict raw === 'true' check, so values like 'True' or 'true\r'
    // would pass a lenient boot gate while encryption silently stays OFF.
    for (const value of ['True', 'true\r', ' true ']) {
      expect(
        validateWorkerProductionEnv({ ...validProductionEnv, PII_FIELD_ENCRYPTION: value }),
      ).toEqual([
        "PII_FIELD_ENCRYPTION must be set to exactly 'true' (lowercase, no surrounding whitespace/newline) in production",
      ]);
    }
  });

  it('rejects whitespace-padded PII master keys that only pass after trim', () => {
    // getMasterKeyBuffer (packages/shared/src/crypto/pii-field-cipher.ts)
    // checks the RAW length, so a padded key that a trimming validator lets
    // through boots green and then throws on the first PII operation.
    expect(
      validateWorkerProductionEnv({
        ...validProductionEnv,
        PII_ENCRYPTION_MASTER_KEY: `${'b'.repeat(64)}\n`,
      }),
    ).toEqual([
      'PII_ENCRYPTION_MASTER_KEY has surrounding whitespace or a newline — the PII cipher reads the raw value; remove the padding',
    ]);
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

  it('requires a job signing secret so enrichment jobs are not silently rejected', () => {
    // Without it the worker rejects every Apollo enrich job in production
    // (verifyApolloEnrichJobSignature returns false), killing enrichment with
    // no error — so boot must fail loud instead.
    const { BIDSTACK_JOB_SIGNING_SECRET: _omit, ...withoutSecret } = validProductionEnv;
    void _omit;
    expect(validateWorkerProductionEnv(withoutSecret)).toContain(
      'BIDSTACK_JOB_SIGNING_SECRET is required in production',
    );
  });

  it('accepts the legacy JOB_SIGNING_SECRET fallback the queue resolves', () => {
    // The queue reads BIDSTACK_JOB_SIGNING_SECRET ?? JOB_SIGNING_SECRET, so the
    // fallback must satisfy the boot check (else valid deploys break).
    const { BIDSTACK_JOB_SIGNING_SECRET: _omit, ...withFallback } = validProductionEnv;
    void _omit;
    expect(
      validateWorkerProductionEnv({ ...withFallback, JOB_SIGNING_SECRET: 'b'.repeat(64) }),
    ).toEqual([]);
  });

  it('accepts a complete production env', () => {
    expect(validateWorkerProductionEnv(validProductionEnv)).toEqual([]);
  });
});
