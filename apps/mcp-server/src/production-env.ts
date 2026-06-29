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

  if (trimmed(env, 'PII_FIELD_ENCRYPTION').toLowerCase() !== 'true') {
    errors.push('PII_FIELD_ENCRYPTION=true is required in production');
  }
  if (!HEX_32_BYTE_KEY.test(trimmed(env, 'PII_ENCRYPTION_MASTER_KEY'))) {
    errors.push('PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string in production');
  }

  return errors;
}

export function assertMcpProductionEnv(env: Env = process.env): void {
  const errors = validateMcpProductionEnv(env);
  if (errors.length > 0) {
    throw new Error(`Invalid MCP production env: ${errors.join('; ')}`);
  }
}
