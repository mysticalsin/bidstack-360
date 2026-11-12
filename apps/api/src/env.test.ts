import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const COMPLETE_PRODUCTION_ENV = {
  NODE_ENV: 'production',
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'bidstack-prod-files',
  S3_REGION: 'us-east-1',
  STORAGE_SCAN_REQUIRED: 'true',
  INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
  PII_FIELD_ENCRYPTION: 'true',
  PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
  PUBLIC_BASE_URL: 'https://crm.example.com',
  REDIS_URL: 'redis://:test@redis:6379',
  BIDSTACK_JOB_SIGNING_SECRET: 'b'.repeat(64),
  BIDSTACK_TENANT_SCOPE_GUARD: 'enforce',
};

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

async function loadEnvWith(overrides: NodeJS.ProcessEnv) {
  restoreEnv();
  const nextEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgresql://bidstack:bidstack@localhost:5432/bidstack_test',
    PUBLIC_BASE_URL: 'http://localhost:5173',
    ...overrides,
  };
  for (const [key, value] of Object.entries(nextEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
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
    await expect(
      loadEnvWith({
        ...COMPLETE_PRODUCTION_ENV,
        PII_FIELD_ENCRYPTION: 'false',
        PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
      }),
    ).rejects.toThrow('PII_FIELD_ENCRYPTION=true is required in production');

    await expect(
      loadEnvWith({
        ...COMPLETE_PRODUCTION_ENV,
        PII_FIELD_ENCRYPTION: 'true',
        PII_ENCRYPTION_MASTER_KEY: 'z'.repeat(64),
      }),
    ).rejects.toThrow('PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string');
  });

  it('requires a non-loopback HTTPS public web origin in production', async () => {
    await expect(
      loadEnvWith({
        ...COMPLETE_PRODUCTION_ENV,
        PUBLIC_BASE_URL: 'http://crm.example.com',
      }),
    ).rejects.toThrow('PUBLIC_BASE_URL must use https in production');

    await expect(
      loadEnvWith({
        ...COMPLETE_PRODUCTION_ENV,
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
      REDIS_URL: 'redis://:test@redis:6379',
      DEMO_MODE: 'true',
      DEMO_SESSION_SECRET: 'demo-session-secret',
      BIDSTACK_JOB_SIGNING_SECRET: 'b'.repeat(64),
      BIDSTACK_TENANT_SCOPE_GUARD: 'enforce',
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

  it('refuses a refresh-lock wait that is not shorter than the ttl', async () => {
    await expect(
      loadEnvWith({
        NODE_ENV: 'development',
        OAUTH_REFRESH_LOCK_TTL_MS: '30000',
        OAUTH_REFRESH_LOCK_WAIT_MS: '30000',
      }),
    ).rejects.toThrow('OAUTH_REFRESH_LOCK_TTL_MS must be greater than OAUTH_REFRESH_LOCK_WAIT_MS');
  });

  it('refuses to start in production when the refresh lock opts out of Redis', async () => {
    await expect(
      loadEnvWith({
        ...COMPLETE_PRODUCTION_ENV,
        OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
      }),
    ).rejects.toThrow(
      'OAUTH_REFRESH_LOCK_REDIS_REQUIRED=false is refused when NODE_ENV=production',
    );
    const env = await loadEnvWith({
      NODE_ENV: 'development',
      OAUTH_REFRESH_LOCK_REDIS_REQUIRED: 'false',
    });
    expect(env.OAUTH_REFRESH_LOCK_REDIS_REQUIRED).toBe('false');
  });

  it('requires an explicit non-loopback Redis URL in production', async () => {
    await expect(loadEnvWith({ ...COMPLETE_PRODUCTION_ENV, REDIS_URL: undefined })).rejects.toThrow(
      'REDIS_URL is required in production',
    );
    await expect(
      loadEnvWith({
        ...COMPLETE_PRODUCTION_ENV,
        REDIS_URL: 'redis://localhost:6380',
      }),
    ).rejects.toThrow('REDIS_URL must not point at localhost or loopback in production');
    await expect(
      loadEnvWith({
        ...COMPLETE_PRODUCTION_ENV,
        REDIS_URL: 'not-a-redis-url',
      }),
    ).rejects.toThrow('REDIS_URL must be a valid Redis URL in production');
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
        REDIS_URL: 'redis://:test@redis:6379',
      }),
    ).rejects.toThrow('BIDSTACK_JOB_SIGNING_SECRET is required in production');
  });

  it('accepts the legacy JOB_SIGNING_SECRET fallback in production', async () => {
    // The queue resolves BIDSTACK_JOB_SIGNING_SECRET ?? JOB_SIGNING_SECRET, so
    // the fallback alone must satisfy boot (else valid deploys break).
    const env = await loadEnvWith({
      ...COMPLETE_PRODUCTION_ENV,
      BIDSTACK_JOB_SIGNING_SECRET: '',
      JOB_SIGNING_SECRET: 'b'.repeat(64),
    });

    expect(env.JOB_SIGNING_SECRET).toBe('b'.repeat(64));
  });

  it('accepts explicit durable storage settings for production', async () => {
    const env = await loadEnvWith({
      ...COMPLETE_PRODUCTION_ENV,
    });

    expect(env.STORAGE_DRIVER).toBe('s3');
    expect(env.S3_BUCKET).toBe('bidstack-prod-files');
  });

  it('requires the tenant-scope guard set to warn or enforce in production', async () => {
    // BIDSTACK_TENANT_SCOPE_GUARD defaults 'off' for backward compatibility, but
    // an unscoped tenant-table query in production is an all-tenants data leak
    // (see packages/db/src/middleware/tenant-scope-guard.ts) — boot must fail
    // loud rather than silently run unguarded.
    await expect(
      loadEnvWith({ ...COMPLETE_PRODUCTION_ENV, BIDSTACK_TENANT_SCOPE_GUARD: undefined }),
    ).rejects.toThrow("BIDSTACK_TENANT_SCOPE_GUARD must be 'warn' or 'enforce' in production");

    const env = await loadEnvWith({
      ...COMPLETE_PRODUCTION_ENV,
      BIDSTACK_TENANT_SCOPE_GUARD: 'warn',
    });
    expect(env.BIDSTACK_TENANT_SCOPE_GUARD).toBe('warn');
  });

  it('defaults to demo data mode and refuses real mode without an identity source', async () => {
    const env = await loadEnvWith({});
    expect(env.POLO_DATA_MODE).toBe('demo');
    expect(env.CF_ACCESS_AUTH).toBe('false');

    await expect(loadEnvWith({ POLO_DATA_MODE: 'real' })).rejects.toThrow(
      'POLO_DATA_MODE=real requires CLERK_SECRET_KEY or CF_ACCESS_AUTH=true',
    );
  });

  it('requires an allowlist when Cloudflare Access is the identity source', async () => {
    await expect(loadEnvWith({ CF_ACCESS_AUTH: 'true' })).rejects.toThrow(
      'POLO_ALLOWED_USERS is required when CF_ACCESS_AUTH=true',
    );

    const env = await loadEnvWith({
      CF_ACCESS_AUTH: 'true',
      POLO_ALLOWED_USERS: 'ada@mantu.com:Admin',
    });
    expect(env.CF_ACCESS_AUTH).toBe('true');
    expect(env.POLO_ALLOWED_USERS).toBe('ada@mantu.com:Admin');
  });

  it('refuses the Access loopback email trust in production and defaults it off', async () => {
    // WHY: a missing flag must not mean "trust the email header". Production
    // must refuse to boot if an operator turns the dev bypass on.
    const dev = await loadEnvWith({ NODE_ENV: 'development' });
    expect(dev.CF_ACCESS_TRUST_LOOPBACK_EMAIL).toBe('false');
    await expect(
      loadEnvWith({
        ...COMPLETE_PRODUCTION_ENV,
        CF_ACCESS_TRUST_LOOPBACK_EMAIL: 'true',
      }),
    ).rejects.toThrow('CF_ACCESS_TRUST_LOOPBACK_EMAIL=true is not allowed in production');
  });
});
