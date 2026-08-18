type Env = Record<string, string | undefined>;

const REQUIRED_PRODUCTION_KEYS = ['DATABASE_URL', 'REDIS_URL'] as const;
const HEX_32_BYTE_KEY = /^[0-9a-fA-F]{64}$/;

function trimmed(env: Env, key: string): string {
  return env[key]?.trim() ?? '';
}

function redisUrlError(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      return 'REDIS_URL must be a valid Redis URL in production';
    }
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0' ||
      hostname === '[::]' ||
      hostname.startsWith('127.')
    ) {
      return 'REDIS_URL must not point at localhost or loopback in production';
    }
    return null;
  } catch {
    return 'REDIS_URL must be a valid Redis URL in production';
  }
}

export function validateWorkerProductionEnv(env: Env = process.env): string[] {
  if (trimmed(env, 'NODE_ENV') !== 'production') {
    return [];
  }

  const errors: string[] = [];
  for (const key of REQUIRED_PRODUCTION_KEYS) {
    if (!trimmed(env, key)) {
      errors.push(`${key} is required in production`);
    }
  }

  const redisUrl = trimmed(env, 'REDIS_URL');
  if (redisUrl) {
    const redisError = redisUrlError(redisUrl);
    if (redisError) errors.push(redisError);
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

  // HMAC secret for Apollo enrichment jobs. Without it the worker's
  // verifyApolloEnrichJobSignature rejects EVERY job in production (returns
  // false when no secret + NODE_ENV=production), so enrichment silently dies.
  // Fail loud at boot instead. JOB_SIGNING_SECRET is the accepted fallback the
  // queue resolves (BIDSTACK_JOB_SIGNING_SECRET ?? JOB_SIGNING_SECRET).
  if (!trimmed(env, 'BIDSTACK_JOB_SIGNING_SECRET') && !trimmed(env, 'JOB_SIGNING_SECRET')) {
    errors.push('BIDSTACK_JOB_SIGNING_SECRET is required in production');
  }

  // The tenant-scope guard (packages/db/src/middleware/tenant-scope-guard.ts)
  // is applied to the shared Prisma client this worker imports from
  // @bidstack/db, so a missing/'off' value here leaves worker queries just as
  // exposed to an all-tenants leak as the API. Defaults to 'off' when unset.
  const tenantScopeGuardMode = trimmed(env, 'BIDSTACK_TENANT_SCOPE_GUARD').toLowerCase();
  if (tenantScopeGuardMode !== 'warn' && tenantScopeGuardMode !== 'enforce') {
    errors.push("BIDSTACK_TENANT_SCOPE_GUARD must be 'warn' or 'enforce' in production");
  }

  const storageDriver = trimmed(env, 'STORAGE_DRIVER').toLowerCase();
  // BIDSTACK_ALLOW_LOCAL_STORAGE=true is the explicit opt-in to run production on
  // ephemeral local disk before object storage is wired (mirrors apps/api env.ts).
  if (
    trimmed(env, 'DEMO_MODE') !== 'true' &&
    storageDriver !== 's3' &&
    trimmed(env, 'BIDSTACK_ALLOW_LOCAL_STORAGE') !== 'true'
  ) {
    errors.push(
      'STORAGE_DRIVER=s3 is required in production (or set BIDSTACK_ALLOW_LOCAL_STORAGE=true to launch on ephemeral local disk)',
    );
  }

  if (storageDriver === 's3') {
    if (!trimmed(env, 'S3_BUCKET')) {
      errors.push('S3_BUCKET is required when STORAGE_DRIVER=s3');
    }
    if (!trimmed(env, 'S3_REGION')) {
      errors.push('S3_REGION is required when STORAGE_DRIVER=s3');
    }
  }

  return errors;
}

export function assertWorkerProductionEnv(env: Env = process.env): void {
  const errors = validateWorkerProductionEnv(env);
  if (errors.length > 0) {
    throw new Error(`Invalid worker production env: ${errors.join('; ')}`);
  }
}
