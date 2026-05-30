import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Public web origin — drives the CORS allowlist (server.ts). Defaults to the
  // local web dev origin so local/compose boot never crashes; production MUST
  // override it (enforced in parseConfig below) or browser requests from the
  // deployed frontend are rejected.
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),

  // Database
  DATABASE_URL: z.string().min(1),
  SHADOW_DATABASE_URL: z.string().optional(),

  // Redis — local default :6380 matches env.ts and the queue producers
  // (avoids colliding with a system Redis on the standard :6379).
  REDIS_URL: z.string().default('redis://localhost:6380'),

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

  // OpenAPI / Swagger UI — enable with OPENAPI_DOCS_ENABLED=true (admin only)
  OPENAPI_DOCS_ENABLED: z.enum(['true', 'false']).default('false'),
});

function parseConfig(): z.infer<typeof ConfigSchema> {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Config validation failed: ${issues}`);
  }
  // Production must set a real public origin; the localhost default would make
  // the CORS allowlist reject every browser request from the deployed frontend.
  if (parsed.data.NODE_ENV === 'production' && parsed.data.PUBLIC_BASE_URL.includes('localhost')) {
    throw new Error(
      'Config validation failed: PUBLIC_BASE_URL must be set to the public web origin in production',
    );
  }
  return parsed.data;
}

export const config = parseConfig();
