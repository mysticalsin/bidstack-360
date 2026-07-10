type Env = Record<string, string | undefined>;

const HEX_32_BYTE_KEY = /^[0-9a-fA-F]{64}$/;

function trimmed(env: Env, key: string): string {
  return env[key]?.trim() ?? '';
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  // 0.0.0.0 / [::] are the IPv4/IPv6 unspecified ("bind-all") addresses — a
  // common prod misconfig where the broker host is left as the listen address.
  // A host-less REDIS_URL (e.g. "redis://:6379") throws in new URL() and is
  // already caught upstream as 'invalid', so no empty-hostname case reaches here.
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized === '0.0.0.0' ||
    normalized === '[::]' ||
    normalized.startsWith('127.')
  );
}

function validateRedisUrl(value: string): 'ok' | 'invalid' | 'loopback' {
  try {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      return 'invalid';
    }
    return isLoopbackHost(url.hostname) ? 'loopback' : 'ok';
  } catch {
    return 'invalid';
  }
}

export function validateMcpProductionEnv(env: Env = process.env): string[] {
  if (trimmed(env, 'NODE_ENV') !== 'production') {
    return [];
  }

  const errors: string[] = [];
  if (!trimmed(env, 'DATABASE_URL')) {
    errors.push('DATABASE_URL is required in production');
  }

  const redisUrl = trimmed(env, 'REDIS_URL');
  if (!redisUrl) {
    errors.push('REDIS_URL is required in production');
  } else {
    const redisStatus = validateRedisUrl(redisUrl);
    if (redisStatus === 'invalid') {
      errors.push('REDIS_URL must be a valid Redis URL in production');
    } else if (redisStatus === 'loopback') {
      errors.push('REDIS_URL must not point at localhost or loopback in production');
    }
  }

  const failClosed = trimmed(env, 'MCP_RATE_LIMIT_FAIL_CLOSED').toLowerCase();
  if (failClosed === 'false' || failClosed === '0') {
    errors.push('MCP_RATE_LIMIT_FAIL_CLOSED cannot be false in production');
  }

  if (!HEX_32_BYTE_KEY.test(trimmed(env, 'INTEGRATION_TOKEN_KEY'))) {
    errors.push('INTEGRATION_TOKEN_KEY must be a 64-character hex string in production');
  }

  // The consumer (isPiiEncryptionEnabled in
  // packages/db/src/middleware/pii-encryption.ts) requires the RAW value to be
  // exactly 'true' — a trimmed/case-folded gate here would boot green while
  // encryption silently stays OFF.
  const piiFlag = env.PII_FIELD_ENCRYPTION ?? '';
  if (piiFlag !== 'true') {
    errors.push(
      piiFlag.trim().toLowerCase() === 'true'
        ? "PII_FIELD_ENCRYPTION must be set to exactly 'true' (lowercase, no surrounding whitespace/newline) in production"
        : 'PII_FIELD_ENCRYPTION=true is required in production',
    );
  }
  // getMasterKeyBuffer (packages/shared/src/crypto/pii-field-cipher.ts) reads
  // the RAW value, so validating a trimmed copy would boot green and then
  // throw on the first PII operation.
  const piiMasterKey = env.PII_ENCRYPTION_MASTER_KEY ?? '';
  if (!HEX_32_BYTE_KEY.test(piiMasterKey)) {
    errors.push(
      HEX_32_BYTE_KEY.test(piiMasterKey.trim())
        ? 'PII_ENCRYPTION_MASTER_KEY has surrounding whitespace or a newline — the PII cipher reads the raw value; remove the padding'
        : 'PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string in production',
    );
  }

  // The tenant-scope guard (packages/db/src/middleware/tenant-scope-guard.ts)
  // is applied to the shared Prisma client this server imports from
  // @bidstack/db, so a missing/'off' value here leaves MCP tool queries just
  // as exposed to an all-tenants leak as the API. Defaults to 'off' when unset.
  const tenantScopeGuardMode = trimmed(env, 'BIDSTACK_TENANT_SCOPE_GUARD').toLowerCase();
  if (tenantScopeGuardMode !== 'warn' && tenantScopeGuardMode !== 'enforce') {
    errors.push("BIDSTACK_TENANT_SCOPE_GUARD must be 'warn' or 'enforce' in production");
  }

  return errors;
}

export function assertMcpProductionEnv(env: Env = process.env): void {
  const errors = validateMcpProductionEnv(env);
  if (errors.length > 0) {
    throw new Error(`Invalid MCP production env: ${errors.join('; ')}`);
  }
}
