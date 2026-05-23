import { z } from 'zod';

/**
 * Boot-time environment validation.
 * Fails fast with a clear message if any required variable is missing.
 * All optional variables have sensible defaults applied in main.ts / server.ts.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT_API: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6380'),

  PUBLIC_BASE_URL: z.string().url(),
  PUBLIC_API_URL: z.string().url().optional(),

  CLERK_SECRET_KEY: z.string().min(1).optional().or(z.literal('')),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional().or(z.literal('')),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional().or(z.literal('')),

  SSO_ALLOWED_EMAIL_DOMAINS: z.string().optional().or(z.literal('')),

  DUST_API_KEY: z.string().min(1).optional().or(z.literal('')),
  DUST_WORKSPACE_ID: z.string().min(1).optional().or(z.literal('')),
  DUST_DATA_SOURCE_ID: z.string().min(1).optional().or(z.literal('')),
  DUST_WEBHOOK_SECRET: z.string().min(1).optional().or(z.literal('')),
  DUST_BASE_URL: z.string().url().optional().or(z.literal('')),
  DUST_MCP_PUBLIC_URL: z.string().url().optional().or(z.literal('')),

  ERP_URL: z.string().url().optional().or(z.literal('')),
  ERP_DB: z.string().min(1).optional().or(z.literal('')),
  ERP_API_KEY: z.string().min(1).optional().or(z.literal('')),
  ERP_USER: z.string().min(1).optional().or(z.literal('')),
  ERP_PASSWORD: z.string().min(1).optional().or(z.literal('')),
  ERP_MCP_URL: z.string().url().optional().or(z.literal('')),
  ERP_MCP_BEARER_TOKEN: z.string().min(1).optional().or(z.literal('')),
  ERP_MCP_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  ODOO_URL: z.string().url().optional().or(z.literal('')),
  ODOO_DB: z.string().min(1).optional().or(z.literal('')),
  ODOO_API_KEY: z.string().min(1).optional().or(z.literal('')),
  ODOO_USER: z.string().min(1).optional().or(z.literal('')),
  ODOO_PASSWORD: z.string().min(1).optional().or(z.literal('')),
  ODOO_MCP_URL: z.string().url().optional().or(z.literal('')),
  ODOO_MCP_BEARER_TOKEN: z.string().min(1).optional().or(z.literal('')),
  ODOO_MCP_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().min(1).optional().or(z.literal('')),
  S3_REGION: z.string().min(1).optional().or(z.literal('')),
  S3_ENDPOINT: z.string().url().optional().or(z.literal('')),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  STORAGE_UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),
  STORAGE_SCAN_REQUIRED: z.enum(['true', 'false']).default('false'),

  TRUSTED_PROXIES: z.string().optional().or(z.literal('')),
  BIDSTACK_JOB_SIGNING_SECRET: z.string().min(1).optional().or(z.literal('')),
  JOB_SIGNING_SECRET: z.string().min(1).optional().or(z.literal('')),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .filter((i) => i.message === 'Required')
      .map((i) => i.path.join('.'));
    const invalid = parsed.error.issues
      .filter((i) => i.message !== 'Required')
      .map((i) => `${i.path.join('.')}: ${i.message}`);
    const lines: string[] = ['Environment validation failed:'];
    if (missing.length) lines.push(`  Missing: ${missing.join(', ')}`);
    if (invalid.length) lines.push(`  Invalid: ${invalid.join(', ')}`);
    throw new Error(lines.join('\n'));
  }
  const env = parsed.data;
  const semanticErrors: string[] = [];
  if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER !== 's3') {
    semanticErrors.push('STORAGE_DRIVER=s3 is required in production');
  }
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
    semanticErrors.push('S3_BUCKET is required when STORAGE_DRIVER=s3');
  }
  if (semanticErrors.length > 0) {
    throw new Error(`Environment validation failed:\n  Invalid: ${semanticErrors.join(', ')}`);
  }
  _env = env;
  return _env;
}
