import { describe, expect, it } from 'vitest';

import { validateMcpProductionEnv } from './production-env.js';

const validProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://bidstack:test@postgres:5432/bidstack',
  REDIS_URL: 'redis://:test@redis:6379',
  INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
  PII_FIELD_ENCRYPTION: 'true',
  PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
  BIDSTACK_TENANT_SCOPE_GUARD: 'enforce',
};

describe('MCP production env contract', () => {
  it('does not enforce production-only checks in development', () => {
    expect(validateMcpProductionEnv({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('requires the shared production dependencies before MCP routes are exposed', () => {
    expect(validateMcpProductionEnv({ NODE_ENV: 'production' })).toEqual([
      'DATABASE_URL is required in production',
      'REDIS_URL is required in production',
      'INTEGRATION_TOKEN_KEY must be a 64-character hex string in production',
      'PII_FIELD_ENCRYPTION=true is required in production',
      'PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string in production',
      "BIDSTACK_TENANT_SCOPE_GUARD must be 'warn' or 'enforce' in production",
    ]);
  });

  it('requires the tenant-scope guard set to warn or enforce in production', () => {
    // BIDSTACK_TENANT_SCOPE_GUARD defaults 'off' for backward compatibility, but
    // MCP tool calls share the same @bidstack/db Prisma client (and its
    // middleware stack) as the API, so an unscoped query here is the same
    // all-tenants leak.
    expect(
      validateMcpProductionEnv({ ...validProductionEnv, BIDSTACK_TENANT_SCOPE_GUARD: 'off' }),
    ).toContain("BIDSTACK_TENANT_SCOPE_GUARD must be 'warn' or 'enforce' in production");

    expect(
      validateMcpProductionEnv({ ...validProductionEnv, BIDSTACK_TENANT_SCOPE_GUARD: 'warn' }),
    ).toEqual([]);
  });

  it('rejects loopback Redis URLs in production', () => {
    expect(
      validateMcpProductionEnv({
        ...validProductionEnv,
        REDIS_URL: 'redis://localhost:6379',
      }),
    ).toContain('REDIS_URL must not point at localhost or loopback in production');

    expect(
      validateMcpProductionEnv({
        ...validProductionEnv,
        REDIS_URL: 'redis://127.0.0.1:6379',
      }),
    ).toContain('REDIS_URL must not point at localhost or loopback in production');
  });

  it('rejects invalid Redis URLs in production', () => {
    expect(
      validateMcpProductionEnv({
        ...validProductionEnv,
        REDIS_URL: 'not a url',
      }),
    ).toEqual(['REDIS_URL must be a valid Redis URL in production']);
  });

  it('rejects explicit fail-open rate limiting in production', () => {
    expect(
      validateMcpProductionEnv({
        ...validProductionEnv,
        MCP_RATE_LIMIT_FAIL_CLOSED: 'false',
      }),
    ).toEqual(['MCP_RATE_LIMIT_FAIL_CLOSED cannot be false in production']);
  });

  it('requires encryption keys and PII encryption for real-data production', () => {
    expect(
      validateMcpProductionEnv({
        ...validProductionEnv,
        INTEGRATION_TOKEN_KEY: 'legacy-base64-looking-key-value-that-is-not-hex',
        PII_FIELD_ENCRYPTION: 'false',
        PII_ENCRYPTION_MASTER_KEY: 'z'.repeat(64),
      }),
    ).toEqual([
      'INTEGRATION_TOKEN_KEY must be a 64-character hex string in production',
      'PII_FIELD_ENCRYPTION=true is required in production',
      'PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string in production',
    ]);
  });

  it('rejects truthy-looking PII flags that the DB middleware would ignore', () => {
    // isPiiEncryptionEnabled (packages/db/src/middleware/pii-encryption.ts)
    // does a strict raw === 'true' check, so values like 'True' or 'true\r'
    // would pass a lenient boot gate while encryption silently stays OFF.
    for (const value of ['True', 'true\r', ' true ']) {
      expect(
        validateMcpProductionEnv({ ...validProductionEnv, PII_FIELD_ENCRYPTION: value }),
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
      validateMcpProductionEnv({
        ...validProductionEnv,
        PII_ENCRYPTION_MASTER_KEY: `${'b'.repeat(64)}\n`,
      }),
    ).toEqual([
      'PII_ENCRYPTION_MASTER_KEY has surrounding whitespace or a newline — the PII cipher reads the raw value; remove the padding',
    ]);
  });

  it('accepts a complete production env with default fail-closed rate limiting', () => {
    expect(validateMcpProductionEnv(validProductionEnv)).toEqual([]);
  });

  it('accepts explicit fail-closed rate limiting in production', () => {
    expect(
      validateMcpProductionEnv({
        ...validProductionEnv,
        MCP_RATE_LIMIT_FAIL_CLOSED: 'true',
      }),
    ).toEqual([]);
  });
});
