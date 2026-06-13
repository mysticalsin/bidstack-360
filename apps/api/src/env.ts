import { z } from 'zod';

/**
 * Boot-time environment validation.
 * Fails fast with a clear message if any required variable is missing.
 * All optional variables have sensible defaults applied in main.ts / server.ts.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT_API: z.coerce.number().int().min(1).max(65535).default(4000),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000), // kept for backwards compat with config.ts PORT logic
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().min(1),
  SHADOW_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().min(1).default('redis://localhost:6380'),

  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().url().optional(),

  CLERK_SECRET_KEY: z.string().min(1).optional().or(z.literal('')),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional().or(z.literal('')),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional().or(z.literal('')),

  SSO_ALLOWED_EMAIL_DOMAINS: z.string().optional().or(z.literal('')),

  // Microsoft SSO
  VITE_SSO_MICROSOFT_ENABLED: z.enum(['true', 'false']).default('false'),
  VITE_SSO_MICROSOFT_LABEL: z.string().optional(),

  // ─── Demo mode (public passwordless "try the demo" door) ──────────────
  // DEMO_MODE=true arms a PUBLIC sign-in: any email → its own freshly-seeded
  // org. Mutually exclusive with Clerk (enforced in the semantic checks below).
  // Use ONLY for the public demo deployment, never a real tenant.
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  DEMO_SESSION_SECRET: z.string().min(1).optional().or(z.literal('')),
  DEMO_ORG_TTL_HOURS: z.coerce.number().int().positive().default(24),
  DEMO_MAX_ORGS: z.coerce.number().int().positive().default(500),
  // When true (demo mode only), each new visitor org kicks off a LIVE Apollo
  // enrichment refresh of its seeded companies. Needs APOLLO_API_KEY (worker) +
  // BIDSTACK_JOB_SIGNING_SECRET. Off by default to bound Apollo credit usage —
  // the seed already ships realistic employee/revenue values.
  DEMO_AUTO_ENRICH: z.enum(['true', 'false']).default('false'),

  DUST_API_KEY: z.string().min(1).optional().or(z.literal('')),
  DUST_WORKSPACE_ID: z.string().min(1).optional().or(z.literal('')),
  DUST_DATA_SOURCE_ID: z.string().min(1).optional().or(z.literal('')),
  DUST_AGENT_EXEC_BRIEF: z.string().optional(),
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

  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // OCR
  BIDSTACK_OCR_ENABLED: z.enum(['true', 'false']).default('false'),
  BIDSTACK_OCRMYPDF_BIN: z.string().default('ocrmypdf'),
  BIDSTACK_TESSERACT_BIN: z.string().default('tesseract'),
  BIDSTACK_OCR_TIMEOUT_MS: z.coerce.number().default(120_000),
  BIDSTACK_OCR_LANGUAGES: z.string().default('eng'),

  // OpenAPI / Swagger UI — enable with OPENAPI_DOCS_ENABLED=true (admin only)
  OPENAPI_DOCS_ENABLED: z.enum(['true', 'false']).default('false'),

  // ─── Feature flags (demo-feedback program) ────────────────────────────
  // Served to the SPA via GET /api/v1/config/features so a flag flip is a
  // restart, not a rebuild. Default false: dependent blocks hide entirely
  // (the brief forbids empty/null states for unavailable data sources).
  // Win/Loss block — Opportunity Management API does not expose the field yet.
  WIN_LOSS_DATA_AVAILABLE: z.enum(['true', 'false']).default('false'),
  // Account revenue + evolution block — ABC revenue API not yet available.
  SHOW_REVENUE_BLOCK: z.enum(['true', 'false']).default('false'),
  // InfoSearch lead-intel MCP integration.
  INFOSEARCH_ENABLED: z.enum(['true', 'false']).default('false'),
  INFOSEARCH_MCP_URL: z.string().url().optional().or(z.literal('')),
  INFOSEARCH_API_KEY: z.string().min(1).optional().or(z.literal('')),
  // 360Learning LMS (Sales Toolkits). Env names cannot start with a digit,
  // so the brief's 360L_* arrive as LMS_360L_*.
  LMS_360L_ENABLED: z.enum(['true', 'false']).default('false'),
  LMS_360L_BASE_URL: z.string().url().optional().or(z.literal('')),
  LMS_360L_API_KEY: z.string().min(1).optional().or(z.literal('')),

  // Observability
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('bidstack-api'),
  OTEL_SERVICE_VERSION: z.string().default('0.1.0'),

  // ─── Migration connectors (Wave 3) ────────────────────────────────────
  // HubSpot OAuth — create app at https://app.hubspot.com/developer
  HUBSPOT_CLIENT_ID: z.string().min(1).optional().or(z.literal('')),
  HUBSPOT_CLIENT_SECRET: z.string().min(1).optional().or(z.literal('')),
  HUBSPOT_REDIRECT_URI: z.string().url().optional().or(z.literal('')),
  // AES-256-GCM key for encrypting OAuth tokens at rest.
  INTEGRATION_TOKEN_KEY: z.string().min(1).optional().or(z.literal('')),

  // ─── E-signature (DocuSign JWT bearer integration) ────────────────────
  // All optional. When unset, the signature service throws a 503 at call time
  // (getDocuSignAccessToken / sendDocuSignEnvelope / handleDocuSignWebhook)
  // rather than failing boot — so local/dev and the INTERNAL signing provider
  // work without DocuSign credentials. Secrets: never hardcode; supply via the
  // deployment secret store.
  DOCUSIGN_INTEGRATION_KEY: z.string().min(1).optional().or(z.literal('')),
  DOCUSIGN_USER_ID: z.string().min(1).optional().or(z.literal('')),
  DOCUSIGN_PRIVATE_KEY: z.string().min(1).optional().or(z.literal('')), // base64-encoded RSA PEM
  DOCUSIGN_ACCOUNT_ID: z.string().min(1).optional().or(z.literal('')),
  DOCUSIGN_BASE_URL: z.string().url().optional().or(z.literal('')),
  DOCUSIGN_WEBHOOK_HMAC_KEY: z.string().min(1).optional().or(z.literal('')),
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

  // Production must set a real public origin; the localhost default would make
  // the CORS allowlist reject every browser request from the deployed frontend.
  if (env.NODE_ENV === 'production' && env.PUBLIC_BASE_URL.includes('localhost')) {
    semanticErrors.push('PUBLIC_BASE_URL must be set to the public web origin in production (cannot contain localhost)');
  }

  // Production normally requires S3 object storage. The public demo runs without
  // an S3 bucket and its data is ephemeral by design, so demo mode may use local
  // disk storage (lost on restart — acceptable for a throwaway demo).
  if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER !== 's3' && env.DEMO_MODE !== 'true') {
    semanticErrors.push('STORAGE_DRIVER=s3 is required in production');
  }
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
    semanticErrors.push('S3_BUCKET is required when STORAGE_DRIVER=s3');
  }
  // The AES-256-GCM key that encrypts per-org Dust credentials and OAuth tokens
  // at rest. Optional in dev (those features degrade gracefully) but mandatory
  // in production — booting without it would let admins save secrets the app
  // then can't decrypt, or (worse) store them weakly.
  if (env.NODE_ENV === 'production' && !env.INTEGRATION_TOKEN_KEY) {
    semanticErrors.push(
      'INTEGRATION_TOKEN_KEY is required in production (encrypts per-org Dust + OAuth secrets at rest)',
    );
  }
  // Demo-mode gate: the public passwordless door must never run alongside real
  // Clerk auth, and needs its own HMAC secret to sign session tokens.
  if (env.DEMO_MODE === 'true') {
    if (env.CLERK_SECRET_KEY) {
      semanticErrors.push('DEMO_MODE=true is mutually exclusive with CLERK_SECRET_KEY');
    }
    if (!env.DEMO_SESSION_SECRET) {
      semanticErrors.push('DEMO_SESSION_SECRET is required when DEMO_MODE=true');
    }
  }
  // Flag-gated integrations fail closed: an enabled flag without its
  // credentials would render a section that can only error.
  if (env.INFOSEARCH_ENABLED === 'true' && (!env.INFOSEARCH_MCP_URL || !env.INFOSEARCH_API_KEY)) {
    semanticErrors.push(
      'INFOSEARCH_ENABLED=true requires INFOSEARCH_MCP_URL and INFOSEARCH_API_KEY',
    );
  }
  if (env.LMS_360L_ENABLED === 'true' && (!env.LMS_360L_BASE_URL || !env.LMS_360L_API_KEY)) {
    semanticErrors.push('LMS_360L_ENABLED=true requires LMS_360L_BASE_URL and LMS_360L_API_KEY');
  }
  if (semanticErrors.length > 0) {
    throw new Error(`Environment validation failed:\n  Invalid: ${semanticErrors.join(', ')}`);
  }
  _env = env;
  return _env;
}

export const config = getEnv();
