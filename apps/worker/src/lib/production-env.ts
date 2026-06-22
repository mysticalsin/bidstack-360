type Env = Record<string, string | undefined>;

const REQUIRED_PRODUCTION_KEYS = ['DATABASE_URL', 'REDIS_URL'] as const;
const INTEGRATION_TOKEN_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

function trimmed(env: Env, key: string): string {
  return env[key]?.trim() ?? '';
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

  if (!INTEGRATION_TOKEN_KEY_PATTERN.test(trimmed(env, 'INTEGRATION_TOKEN_KEY'))) {
    errors.push('INTEGRATION_TOKEN_KEY must be a 64-character hex string in production');
  }

  // HMAC secret for Apollo enrichment jobs. Without it the worker's
  // verifyApolloEnrichJobSignature rejects EVERY job in production (returns
  // false when no secret + NODE_ENV=production), so enrichment silently dies.
  // Fail loud at boot instead. JOB_SIGNING_SECRET is the accepted fallback the
  // queue resolves (BIDSTACK_JOB_SIGNING_SECRET ?? JOB_SIGNING_SECRET).
  if (!trimmed(env, 'BIDSTACK_JOB_SIGNING_SECRET') && !trimmed(env, 'JOB_SIGNING_SECRET')) {
    errors.push('BIDSTACK_JOB_SIGNING_SECRET is required in production');
  }

  const storageDriver = trimmed(env, 'STORAGE_DRIVER').toLowerCase();
  if (trimmed(env, 'DEMO_MODE') !== 'true' && storageDriver !== 's3') {
    errors.push('STORAGE_DRIVER=s3 is required in production');
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
