import { describe, expect, it } from 'vitest';

import { validateMcpProductionEnv } from './production-env.js';

const validProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://bidstack:test@postgres:5432/bidstack',
  REDIS_URL: 'redis://:test@redis:6379',
  INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
  PII_FIELD_ENCRYPTION: 'true',
  PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
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
    ]);
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
