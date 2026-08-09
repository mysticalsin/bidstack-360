#!/usr/bin/env node
// Create/populate `.env.production.local` for a production self-host.
//
//   node scripts/gen-prod-secrets.mjs
//
// On first run it writes the full env skeleton (below) with the three
// app-owned secrets already generated; you fill the DB / Redis / Clerk / R2 /
// domain <PLACEHOLDER>s by hand (see docs/GO-LIVE-SELFHOST.md). Re-running is
// idempotent: it fills ONLY still-blank generated secrets and never rotates a
// value that already exists — rotating INTEGRATION_TOKEN_KEY or
// PII_ENCRYPTION_MASTER_KEY after data exists would orphan every encrypted
// secret + PII field. The file is gitignored (.env.*.local); never commit it.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(REPO, '.env.production.local');

const GENERATORS = {
  INTEGRATION_TOKEN_KEY: () => randomBytes(32).toString('hex'),
  PII_ENCRYPTION_MASTER_KEY: () => randomBytes(32).toString('hex'),
  BIDSTACK_JOB_SIGNING_SECRET: () => randomBytes(48).toString('base64url'),
};

// The skeleton written on first run. Generated secrets are the literal token
// __GEN__ so the fill pass below replaces them; everything else is a <...>
// placeholder the operator completes.
const SKELETON = `NODE_ENV=production

# ── Compute (this PC) ─────────────────────────────────────────────
PORT_API=4100
HOST=0.0.0.0
LOG_LEVEL=info

# ── Public origins ────────────────────────────────────────────────
# PUBLIC_BASE_URL = the URL users open (the SPA). https, not loopback.
PUBLIC_BASE_URL=https://<your-app-domain>
# PUBLIC_API_URL = the stable Cloudflare named-tunnel hostname fronting THIS PC.
PUBLIC_API_URL=https://<api.your-domain>

# ── Managed data (cloud) ──────────────────────────────────────────
# Neon Postgres (has pgvector). Include ?sslmode=require.
DATABASE_URL=postgresql://<user>:<pass>@<neon-host>/<db>?sslmode=require
# Upstash Redis — MUST be the TLS rediss:// URL.
REDIS_URL=rediss://default:<pass>@<upstash-host>:6379

# ── Auth (Clerk) ──────────────────────────────────────────────────
CLERK_SECRET_KEY=sk_live_<...>
CLERK_PUBLISHABLE_KEY=pk_live_<...>
# Clerk webhook pointed at <PUBLIC_API_URL>/api/v1/webhooks/clerk
CLERK_WEBHOOK_SECRET=whsec_<...>
SSO_ALLOWED_EMAIL_DOMAINS=
DEMO_MODE=false

# ── Org bootstrap (go-live seeds this org + RBAC) ─────────────────
# Create the org in Clerk first, then paste its id (org_...).
CLERK_ORG_ID=org_<...>
ORG_NAME=<Your Company>

# ── Cloudflare named tunnel (stable public API hostname) ──────────
CF_TUNNEL_NAME=bidstack

# ── File storage (S3-compatible — Cloudflare R2 recommended) ──────
STORAGE_DRIVER=s3
S3_BUCKET=<bucket-name>
S3_REGION=auto
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=<r2-access-key-id>
AWS_SECRET_ACCESS_KEY=<r2-secret-access-key>

# ── Encryption + signing (generated — never hand-edit / rotate) ───
INTEGRATION_TOKEN_KEY=__GEN__
PII_FIELD_ENCRYPTION=true
PII_ENCRYPTION_MASTER_KEY=__GEN__
BIDSTACK_JOB_SIGNING_SECRET=__GEN__

# ── AI gateway (OmniRoute — free, keyless, runs on this PC) ───────
# Every AI feature (copilot + RFP) routes through OmniRoute unless an org picks
# a specific provider in Settings. go-live starts it on :20128 automatically.
RFP_LLM_PROVIDER=omniroute
OMNIROUTE_BASE_URL=http://localhost:20128/v1
OMNIROUTE_MODEL=auto

# ── Multi-tenant safety (leave as-is) ─────────────────────────────
BIDSTACK_TENANT_SCOPE_GUARD=enforce
QUERY_GUARD_REJECT=true
RATE_LIMIT_REDIS_REQUIRED=true

# ── Observability (optional) ──────────────────────────────────────
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
`;

const isBlank = (v) => !v || v.trim() === '' || v.trim() === '__GEN__' || /^<.*>$/.test(v.trim());

if (!existsSync(TARGET)) {
  writeFileSync(TARGET, SKELETON, { mode: 0o600 });
  console.log('[secrets] wrote .env.production.local skeleton');
}

const lines = readFileSync(TARGET, 'utf8').split(/\r?\n/);
let filled = 0;
const out = lines.map((line) => {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) return line;
  const [, key, value] = m;
  if (GENERATORS[key] && isBlank(value)) {
    filled += 1;
    return `${key}=${GENERATORS[key]()}`;
  }
  return line;
});

writeFileSync(TARGET, out.join('\n'), { mode: 0o600 });
console.log(
  filled > 0
    ? `[secrets] generated ${filled} app-owned secret(s); fill the remaining <placeholders> by hand`
    : '[secrets] app-owned secrets already set — nothing rotated',
);
