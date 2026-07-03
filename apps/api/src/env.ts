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
  DEMO_PUBLIC_DEPLOYMENT_ACK: z.enum(['true', 'false']).default('false'),
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

  // ERP MCP connector. Off by default: v0.1 ships ONE global ERP connection
  // shared by every org in this deployment (see routes/erp-integration.ts
  // header) — an intentional single-tenant limitation, not a bug. Default-off
  // so a fresh multi-tenant deployment doesn't expose the shared backend
  // across orgs until an operator explicitly opts in.
  ERP_ENABLED: z.enum(['true', 'false']).default('false'),
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
  LOCAL_STORAGE_ROOT: z.string().min(1).optional().or(z.literal('')),
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
  // Per-org (tenant) aggregate request cap (requests/min/org). 0 = DISABLED
  // (default). Opt-in noisy-neighbor protection for MULTI-TENANT SaaS so one
  // tenant can't exhaust shared capacity. For a SINGLE large (e.g. 100k-employee)
  // tenant leave it 0 — aggregate legitimate traffic would trip a low cap. The
  // per-user/IP limit (API_RATE_LIMIT_MAX) always applies regardless.
  API_RATE_LIMIT_PER_ORG_MAX: z.coerce.number().int().nonnegative().default(0),
  // When true (default), the rate limiter MUST use the shared Redis store so
  // limits hold across replicas. In production we fail loud at boot rather than
  // silently falling back to per-process memory (which lets the global limit be
  // multiplied by the replica count). Set false only for single-process deploys.
  RATE_LIMIT_REDIS_REQUIRED: z.enum(['true', 'false']).default('true'),

  // Outbound communication abuse/spend caps. These are daily UTC counters backed
  // by Redis and checked before Gmail/Graph/Twilio egress. 0 disables a cap.
  OUTBOUND_COMM_REDIS_REQUIRED: z.enum(['true', 'false']).default('true'),
  OUTBOUND_EMAIL_DAILY_USER_LIMIT: z.coerce.number().int().nonnegative().default(500),
  OUTBOUND_EMAIL_DAILY_ORG_LIMIT: z.coerce.number().int().nonnegative().default(50_000),
  OUTBOUND_SMS_DAILY_USER_LIMIT: z.coerce.number().int().nonnegative().default(100),
  OUTBOUND_SMS_DAILY_ORG_LIMIT: z.coerce.number().int().nonnegative().default(10_000),
  OUTBOUND_SMS_DAILY_ORG_COST_CAP_MICROS: z.coerce.bigint().nonnegative().default(500_000_000n),
  OUTBOUND_SMS_ESTIMATED_SEGMENT_COST_MICROS: z.coerce.bigint().nonnegative().default(8_000n),

  // Query guard: reject (vs. only warn on) unbounded Prisma findMany calls.
  // Defaults true so production — where scale/DoS risk is highest — is protected.
  // Set false to downgrade to warn-only (e.g. while migrating a noisy caller).
  QUERY_GUARD_REJECT: z.enum(['true', 'false']).default('true'),

  // Tenant-scope guard (Prisma middleware, packages/db/src/middleware/tenant-scope-guard.ts)
  // applied to the shared Prisma client used by api, worker, and mcp-server.
  // 'off' disables it, 'warn' logs a violation and lets the query through,
  // 'enforce' throws before an unscoped tenant-table query can run. Defaults
  // 'off' so existing deployments aren't broken by a config oversight;
  // production requires 'warn' or 'enforce' (see semantic check below).
  BIDSTACK_TENANT_SCOPE_GUARD: z.enum(['off', 'warn', 'enforce']).default('off'),

  // ─── HTTP server timeouts (bound per-Node-worker resource pinning) ─────
  // Without these Fastify defaults to 0 (unbounded): a slow query or hung
  // downstream pins a Node worker + its DB connection forever, so at 100k
  // scale a handful of stuck requests can exhaust the process. REQUEST_TIMEOUT_MS
  // caps total request processing; KEEPALIVE_TIMEOUT_MS should sit just above a
  // typical load-balancer idle timeout (~60s) so the LB, not Node, closes idle
  // keep-alive sockets and we avoid races that surface as 502s.
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  KEEPALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(65_000),

  // Provider HTTP timeouts. These cap outbound fetches to Gmail/Google,
  // Microsoft Graph, Slack, Twilio, and OAuth token endpoints so a hung provider
  // cannot pin API workers until undici's much longer default timeout.
  OAUTH_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  GMAIL_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  GOOGLE_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  MICROSOFT_GRAPH_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  MICROSOFT_GRAPH_CLIENT_ID: z.string().optional().or(z.literal('')),
  MICROSOFT_GRAPH_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  ZOOM_SECRET_TOKEN: z.string().optional().or(z.literal('')),
  APOLLO_MCP_URL: z.string().url().optional().or(z.literal('')),
  APOLLO_MCP_BEARER_TOKEN: z.string().optional().or(z.literal('')),
  SLACK_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  TWILIO_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  TWILIO_RECORDING_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),

  // OAuth refresh single-flight. Redis is required in production so concurrent
  // refreshes across API replicas do not race a rotating provider refresh token.
  OAUTH_REFRESH_LOCK_REDIS_REQUIRED: z.enum(['true', 'false']).default('true'),
  OAUTH_REFRESH_LOCK_TTL_MS: z.coerce.number().int().positive().default(30_000),
  OAUTH_REFRESH_LOCK_WAIT_MS: z.coerce.number().int().positive().default(10_000),
  OAUTH_REFRESH_LOCK_POLL_MS: z.coerce.number().int().positive().default(250),

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
  // Win/Loss block — derived from the account's own Polo PreSales opportunity
  // pipeline (won/lost stages), so the data is real today. Default on; set
  // false only to hide the block.
  WIN_LOSS_DATA_AVAILABLE: z.enum(['true', 'false']).default('true'),
  // Revenue-evolution block — won-deal value by close month from the account's
  // own pipeline. Real today; default on (a richer ABC-sourced revenue feed can
  // replace the source later without changing the contract).
  SHOW_REVENUE_BLOCK: z.enum(['true', 'false']).default('true'),
  // InfoSearch lead-intel MCP integration.
  INFOSEARCH_ENABLED: z.enum(['true', 'false']).default('false'),
  INFOSEARCH_MCP_URL: z.string().url().optional().or(z.literal('')),
  INFOSEARCH_API_KEY: z.string().min(1).optional().or(z.literal('')),
  // Seamless.AI can run through an MCP gateway for source-pull workflows, with
  // the REST API retained as fallback when only SEAMLESS_API_KEY is set.
  SEAMLESS_MCP_URL: z.string().url().optional().or(z.literal('')),
  SEAMLESS_MCP_BEARER_TOKEN: z.string().min(1).optional().or(z.literal('')),
  SEAMLESS_MCP_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  SEAMLESS_MCP_SEARCH_COMPANIES_TOOL: z.string().min(1).optional().or(z.literal('')),
  SEAMLESS_API_KEY: z.string().min(1).optional().or(z.literal('')),
  SEAMLESS_API_BASE_URL: z.string().url().optional().or(z.literal('')),
  // Optional vendor-neutral technology-intelligence MCP. Use for BuiltWith,
  // Wappalyzer, or a private tech-source gateway only after that MCP is configured.
  TECH_STACK_MCP_URL: z.string().url().optional().or(z.literal('')),
  TECH_STACK_MCP_BEARER_TOKEN: z.string().min(1).optional().or(z.literal('')),
  TECH_STACK_MCP_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  TECH_STACK_MCP_TOOL: z.string().min(1).optional().or(z.literal('')),
  TECH_STACK_MCP_LABEL: z.string().min(1).optional().or(z.literal('')),
  TECH_STACK_MCP_SOURCE_IDS: z.string().optional().or(z.literal('')),
  // 360Learning LMS (Sales Toolkits). Env names cannot start with a digit,
  // so the brief's 360L_* arrive as LMS_360L_*.
  LMS_360L_ENABLED: z.enum(['true', 'false']).default('false'),
  LMS_360L_BASE_URL: z.string().url().optional().or(z.literal('')),
  LMS_360L_API_KEY: z.string().min(1).optional().or(z.literal('')),

  // SERUM control plane. Default-off by design: the UI must never imply live
  // agent loops, memory, or pattern learning before the backend is configured.
  SERUM_ENABLED: z.enum(['true', 'false']).default('false'),
  SERUM_DEMO_MODE_ENABLED: z.enum(['true', 'false']).default('false'),

  // Observability
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_SMOKE_ENABLED: z.enum(['true', 'false']).default('false'),
  SENTRY_SMOKE_TOKEN: z.string().optional().or(z.literal('')),
  BIDSTACK_RELEASE_COMMIT: z.string().optional().or(z.literal('')),
  BIDSTACK_RELEASE_BRANCH: z.string().optional().or(z.literal('')),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('bidstack-api'),
  OTEL_SERVICE_VERSION: z.string().default('0.1.0'),
  DD_SERVICE: z.string().optional(),
  DD_ENV: z.string().optional(),
  // Bearer token gating the /metrics route (health.ts): unset -> 404
  // (route doesn't exist to a prober), set -> 401 without it, 200 with it.
  METRICS_BEARER_TOKEN: z.string().optional().or(z.literal('')),

  // ─── Migration connectors (Wave 3) ────────────────────────────────────
  // HubSpot OAuth — create app at https://app.hubspot.com/developer
  HUBSPOT_CLIENT_ID: z.string().min(1).optional().or(z.literal('')),
  HUBSPOT_CLIENT_SECRET: z.string().min(1).optional().or(z.literal('')),
  HUBSPOT_REDIRECT_URI: z.string().url().optional().or(z.literal('')),
  // AES-256-GCM key for encrypting OAuth tokens at rest.
  INTEGRATION_TOKEN_KEY: z.string().min(1).optional().or(z.literal('')),
  // AES-256-GCM key for Contact/Lead/KamConsultant PII fields at rest.
  PII_ENCRYPTION_MASTER_KEY: z.string().min(1).optional().or(z.literal('')),
  PII_FIELD_ENCRYPTION: z.enum(['true', 'false']).default('false'),

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

function isHex32ByteKey(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-fA-F]{64}$/.test(value));
}

function publicBaseUrlIsLoopback(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  // Node's URL parser keeps IPv6 hosts bracketed, so '::1' arrives as '[::1]'.
  // Also treat the IPv4 unspecified range (0.0.0.0/8) as non-public — binding
  // there is not a deployable web origin.
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.') ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('0.')
  );
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

  if (env.NODE_ENV === 'production') {
    const publicBaseUrl = new URL(env.PUBLIC_BASE_URL);
    if (publicBaseUrl.protocol !== 'https:') {
      semanticErrors.push('PUBLIC_BASE_URL must use https in production');
    }
    // Production must set a real public origin; loopback defaults would make
    // the CORS allowlist reject deployed browsers and mask a bad release config.
    if (publicBaseUrlIsLoopback(env.PUBLIC_BASE_URL)) {
      semanticErrors.push(
        'PUBLIC_BASE_URL must be set to the public web origin in production (cannot be loopback)',
      );
    }

    const rawRedisUrl = process.env.REDIS_URL?.trim() ?? '';
    if (!rawRedisUrl) {
      semanticErrors.push('REDIS_URL is required in production');
    } else {
      const redisError = redisUrlError(rawRedisUrl);
      if (redisError) semanticErrors.push(redisError);
    }
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
  if (env.NODE_ENV === 'production' && !isHex32ByteKey(env.INTEGRATION_TOKEN_KEY)) {
    semanticErrors.push(
      'INTEGRATION_TOKEN_KEY must be a 64-character hex string in production (encrypts per-org Dust + OAuth secrets at rest)',
    );
  }
  if (env.NODE_ENV === 'production' && env.PII_FIELD_ENCRYPTION !== 'true') {
    semanticErrors.push(
      'PII_FIELD_ENCRYPTION=true is required in production (field-encrypts Contact/Lead/KamConsultant email+phone at rest; User.email is storage-encryption-only pending a User.emailHash migration)',
    );
  }
  if (env.NODE_ENV === 'production' && !isHex32ByteKey(env.PII_ENCRYPTION_MASTER_KEY)) {
    semanticErrors.push(
      'PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string in production',
    );
  }
  // HMAC secret for Apollo enrichment jobs, shared by api (signs/enqueues) and
  // worker (verifies). Missing in production, enqueueApolloEnrich skips silently
  // and the worker rejects every job — enrichment dies with no error. Fail loud
  // at boot. JOB_SIGNING_SECRET is the accepted fallback the queue resolves
  // (BIDSTACK_JOB_SIGNING_SECRET ?? JOB_SIGNING_SECRET).
  if (
    env.NODE_ENV === 'production' &&
    !env.BIDSTACK_JOB_SIGNING_SECRET &&
    !env.JOB_SIGNING_SECRET
  ) {
    semanticErrors.push(
      'BIDSTACK_JOB_SIGNING_SECRET is required in production (HMAC-signs Apollo enrichment jobs; must match the worker)',
    );
  }
  // Tenant-scope guard defends the shared Prisma client (api + worker +
  // mcp-server) against a `where` missing orgId compiling to an all-tenants
  // query. Off by default so an existing deployment isn't broken by a config
  // oversight, but production must run at least 'warn'.
  if (env.NODE_ENV === 'production' && env.BIDSTACK_TENANT_SCOPE_GUARD === 'off') {
    semanticErrors.push(
      "BIDSTACK_TENANT_SCOPE_GUARD must be 'warn' or 'enforce' in production (recommend 'enforce')",
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
    if (env.NODE_ENV === 'production' && env.DEMO_PUBLIC_DEPLOYMENT_ACK !== 'true') {
      semanticErrors.push('DEMO_MODE=true in production requires DEMO_PUBLIC_DEPLOYMENT_ACK=true');
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
  if (env.ERP_ENABLED === 'true' && !env.ERP_MCP_URL && !env.ODOO_MCP_URL) {
    semanticErrors.push('ERP_ENABLED=true requires ERP_MCP_URL (or the legacy ODOO_MCP_URL)');
  }
  if (env.SERUM_DEMO_MODE_ENABLED === 'true' && env.NODE_ENV === 'production') {
    semanticErrors.push('SERUM_DEMO_MODE_ENABLED=true is not allowed in production');
  }
  if (semanticErrors.length > 0) {
    throw new Error(`Environment validation failed:\n  Invalid: ${semanticErrors.join(', ')}`);
  }
  _env = env;
  return _env;
}

export const config = getEnv();
