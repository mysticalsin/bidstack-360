import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Database
  DATABASE_URL: z.string().min(1),
  SHADOW_DATABASE_URL: z.string().optional(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Auth
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  // Dust
  DUST_API_KEY: z.string().optional(),
  DUST_WORKSPACE_ID: z.string().optional(),
  DUST_DATA_SOURCE_ID: z.string().optional(),
  DUST_AGENT_EXEC_BRIEF: z.string().optional(),
  DUST_WEBHOOK_SECRET: z.string().optional(),
  DUST_MCP_PUBLIC_URL: z.string().optional(),

  // Observability
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('bidstack-api'),
  OTEL_SERVICE_VERSION: z.string().default('0.1.0'),

  // Security / Infra
  TRUSTED_PROXIES: z.string().optional(),
  BIDSTACK_JOB_SIGNING_SECRET: z.string().optional(),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // OCR
  BIDSTACK_OCR_ENABLED: z.enum(['true', 'false']).default('false'),
  BIDSTACK_OCRMYPDF_BIN: z.string().default('ocrmypdf'),
  BIDSTACK_TESSERACT_BIN: z.string().default('tesseract'),
  BIDSTACK_OCR_TIMEOUT_MS: z.coerce.number().default(120_000),
  BIDSTACK_OCR_LANGUAGES: z.string().default('eng'),

  // Microsoft SSO
  VITE_SSO_MICROSOFT_ENABLED: z.enum(['true', 'false']).default('false'),
  VITE_SSO_MICROSOFT_LABEL: z.string().optional(),
  SSO_ALLOWED_EMAIL_DOMAINS: z.string().optional(),
});

function parseConfig(): z.infer<typeof ConfigSchema> {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Config validation failed: ${issues}`);
  }
  return parsed.data;
}

export const config = parseConfig();
