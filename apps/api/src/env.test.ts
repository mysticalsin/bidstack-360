import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

async function loadEnvWith(overrides: NodeJS.ProcessEnv) {
  restoreEnv();
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://bidstack:bidstack@localhost:5432/bidstack_test',
    PUBLIC_BASE_URL: 'http://localhost:5173',
    ...overrides,
  });
  vi.resetModules();
  const mod = await import('./env.js');
  return mod.getEnv();
}

describe('boot environment validation', () => {
  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it('rejects local filesystem storage in production', async () => {
    await expect(loadEnvWith({ NODE_ENV: 'production', STORAGE_DRIVER: 'local' })).rejects.toThrow(
      'STORAGE_DRIVER=s3 is required in production',
    );
  });

  it('requires an S3 bucket when S3 storage is selected', async () => {
    await expect(loadEnvWith({ NODE_ENV: 'production', STORAGE_DRIVER: 's3' })).rejects.toThrow(
      'S3_BUCKET is required when STORAGE_DRIVER=s3',
    );
  });

  it('requires INTEGRATION_TOKEN_KEY in production', async () => {
    // Without the key, admins could save per-org Dust / OAuth secrets the app
    // then can't decrypt — so production must fail fast at boot.
    await expect(
      loadEnvWith({
        NODE_ENV: 'production',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'bidstack-prod-files',
        S3_REGION: 'us-east-1',
        STORAGE_SCAN_REQUIRED: 'true',
      }),
    ).rejects.toThrow('INTEGRATION_TOKEN_KEY must be a 64-character hex string in production');
  });

  it('rejects malformed INTEGRATION_TOKEN_KEY in production', async () => {
    await expect(
      loadEnvWith({
        NODE_ENV: 'production',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'bidstack-prod-files',
        S3_REGION: 'us-east-1',
        STORAGE_SCAN_REQUIRED: 'true',
        INTEGRATION_TOKEN_KEY: 'unit-test-integration-token-key',
        PUBLIC_BASE_URL: 'https://crm.example.com',
      }),
    ).rejects.toThrow('INTEGRATION_TOKEN_KEY must be a 64-character hex string in production');
  });

  it('requires PII encryption and a valid PII master key in production', async () => {
    const productionBase = {
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'bidstack-prod-files',
      S3_REGION: 'us-east-1',
      STORAGE_SCAN_REQUIRED: 'true',
      INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
      PUBLIC_BASE_URL: 'https://crm.example.com',
      BIDSTACK_JOB_SIGNING_SECRET: 'b'.repeat(64),
    };

    await expect(
      loadEnvWith({
        ...productionBase,
        PII_FIELD_ENCRYPTION: 'false',
        PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
      }),
    ).rejects.toThrow('PII_FIELD_ENCRYPTION=true is required in production');

    await expect(
      loadEnvWith({
        ...productionBase,
        PII_FIELD_ENCRYPTION: 'true',
        PII_ENCRYPTION_MASTER_KEY: 'z'.repeat(64),
      }),
    ).rejects.toThrow('PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string');
  });

  it('requires a non-loopback HTTPS public web origin in production', async () => {
    const productionBase = {
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'bidstack-prod-files',
      S3_REGION: 'us-east-1',
      STORAGE_SCAN_REQUIRED: 'true',
      INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
      PII_FIELD_ENCRYPTION: 'true',
      PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
    };

    await expect(
      loadEnvWith({
        ...productionBase,
        PUBLIC_BASE_URL: 'http://crm.example.com',
      }),
    ).rejects.toThrow('PUBLIC_BASE_URL must use https in production');

    await expect(
      loadEnvWith({
        ...productionBase,
        PUBLIC_BASE_URL: 'https://127.0.0.1:5173',
      }),
    ).rejects.toThrow('PUBLIC_BASE_URL must be set to the public web origin in production');
  });

  it('requires an explicit acknowledgement before public demo mode can run in production', async () => {
    const productionDemo = {
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'local',
      STORAGE_SCAN_REQUIRED: 'true',
      INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
      PII_FIELD_ENCRYPTION: 'true',
      PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
      PUBLIC_BASE_URL: 'https://demo.example.com',
      DEMO_MODE: 'true',
      DEMO_SESSION_SECRET: 'demo-session-secret',
      BIDSTACK_JOB_SIGNING_SECRET: 'b'.repeat(64),
    };

    await expect(loadEnvWith(productionDemo)).rejects.toThrow(
      'DEMO_MODE=true in production requires DEMO_PUBLIC_DEPLOYMENT_ACK=true',
    );

    const env = await loadEnvWith({
      ...productionDemo,
      DEMO_PUBLIC_DEPLOYMENT_ACK: 'true',
    });

    expect(env.DEMO_MODE).toBe('true');
    expect(env.STORAGE_DRIVER).toBe('local');
  });

  it('requires a job signing secret in production', async () => {
    // Without it enqueueApolloEnrich skips silently and the worker rejects every
    // job — enrichment dies with no error. Production must fail fast at boot.
    await expect(
      loadEnvWith({
        NODE_ENV: 'production',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'bidstack-prod-files',
        S3_REGION: 'us-east-1',
        STORAGE_SCAN_REQUIRED: 'true',
        INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
        PII_FIELD_ENCRYPTION: 'true',
        PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
        PUBLIC_BASE_URL: 'https://crm.example.com',
      }),
    ).rejects.toThrow('BIDSTACK_JOB_SIGNING_SECRET is required in production');
  });

  it('accepts the legacy JOB_SIGNING_SECRET fallback in production', async () => {
    // The queue resolves BIDSTACK_JOB_SIGNING_SECRET ?? JOB_SIGNING_SECRET, so
    // the fallback alone must satisfy boot (else valid deploys break).
    const env = await loadEnvWith({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'bidstack-prod-files',
      S3_REGION: 'us-east-1',
      STORAGE_SCAN_REQUIRED: 'true',
      INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
      PII_FIELD_ENCRYPTION: 'true',
      PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
      PUBLIC_BASE_URL: 'https://crm.example.com',
      JOB_SIGNING_SECRET: 'b'.repeat(64),
    });

    expect(env.JOB_SIGNING_SECRET).toBe('b'.repeat(64));
  });

  it('accepts explicit durable storage settings for production', async () => {
    const env = await loadEnvWith({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'bidstack-prod-files',
      S3_REGION: 'us-east-1',
      STORAGE_SCAN_REQUIRED: 'true',
      INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
      PII_FIELD_ENCRYPTION: 'true',
      PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
      PUBLIC_BASE_URL: 'https://crm.example.com',
      BIDSTACK_JOB_SIGNING_SECRET: 'b'.repeat(64),
    });

    expect(env.STORAGE_DRIVER).toBe('s3');
    expect(env.S3_BUCKET).toBe('bidstack-prod-files');
  });
});
