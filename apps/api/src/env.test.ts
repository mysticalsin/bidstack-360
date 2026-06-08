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
    ).rejects.toThrow('INTEGRATION_TOKEN_KEY is required in production');
  });

  it('accepts explicit durable storage settings for production', async () => {
    const env = await loadEnvWith({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'bidstack-prod-files',
      S3_REGION: 'us-east-1',
      STORAGE_SCAN_REQUIRED: 'true',
      INTEGRATION_TOKEN_KEY: 'unit-test-integration-token-key',
      PUBLIC_BASE_URL: 'https://crm.example.com',
    });

    expect(env.STORAGE_DRIVER).toBe('s3');
    expect(env.S3_BUCKET).toBe('bidstack-prod-files');
  });
});
