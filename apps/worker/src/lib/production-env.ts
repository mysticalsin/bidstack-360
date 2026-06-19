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
