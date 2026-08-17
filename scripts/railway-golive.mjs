#!/usr/bin/env node
// Railway 24/7 go-live: deploy the API + worker + OmniRoute to Railway so the
// app runs independently of this PC. Run AFTER (1) a Railway plan is active on
// project bidstack-360-demo and (2) .env.production.local is filled (Clerk + R2
// especially — Railway runs NODE_ENV=production, which requires them).
//
//   node scripts/railway-golive.mjs
//
// It: validates the prod env, pushes every runtime var to the api + worker
// services, ensures an OmniRoute service exists (Docker image, private network),
// points the API's AI at it, runs migrations, and redeploys api + worker.
// Secret values are read from .env.production.local and piped to `railway
// variables` — never printed here.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(REPO, '.env.production.local');
const PROJECT = 'bidstack-360-demo';

const log = (m) => console.log(`[railway] ${m}`);
const die = (m) => { console.error(`[railway] FAILED: ${m}`); process.exit(1); };

if (!existsSync(ENV_FILE)) die('.env.production.local missing — run scripts/gen-prod-secrets.mjs and fill it');
const env = {};
for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

// Railway = production = the full env.ts prod contract must be satisfied.
const REQUIRED = [
  'DATABASE_URL', 'REDIS_URL', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY',
  'CLERK_ORG_ID', 'ORG_NAME', 'INTEGRATION_TOKEN_KEY', 'PII_ENCRYPTION_MASTER_KEY',
  'BIDSTACK_JOB_SIGNING_SECRET', 'S3_BUCKET', 'S3_ENDPOINT', 'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'PUBLIC_BASE_URL',
];
const blank = (v) => !v || v.trim() === '' || v.trim() === '__GEN__' || /^<.*>$|sk_live_<|pk_live_<|org_<|whsec_</.test(v.trim());
const missing = REQUIRED.filter((k) => blank(env[k]));
if (missing.length) die(`fill these in .env.production.local first:\n    ${missing.join('\n    ')}`);

function railway(args, opts = {}) {
  const res = spawnSync('railway', args, {
    cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32', ...opts,
  });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

// Link project (idempotent).
railway(['link', '--project', PROJECT, '--environment', 'production']);

// ── 1. OmniRoute service (so the cloud API has a cloud AI gateway) ───────────
// The API on Railway can't reach this PC's localhost:20128, so OmniRoute runs
// as its own Railway service; the API reaches it over the private network.
const services = railway(['status']).out;
if (!/omniroute/i.test(services)) {
  log('adding OmniRoute service (Docker image)');
  const add = railway(['add', '--service', 'omniroute', '--image', 'diegosouzapw/omniroute',
    '--variables', 'PORT=20128']);
  if (!add.ok && !/exists|already/i.test(add.out)) log(`omniroute add warning: ${add.out.split('\n').slice(-3).join(' ')}`);
} else {
  log('OmniRoute service already present');
}
const OMNI_INTERNAL = 'http://omniroute.railway.internal:20128/v1';

// ── 2. Push runtime env to api + worker ─────────────────────────────────────
// Vars every backend service needs. PC-only vars (PORT_API/HOST/STORAGE local)
// are excluded; Railway injects PORT and we run production storage on R2.
const RUNTIME_KEYS = [
  'DATABASE_URL', 'REDIS_URL', 'PUBLIC_BASE_URL', 'PUBLIC_API_URL',
  'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_WEBHOOK_SECRET', 'SSO_ALLOWED_EMAIL_DOMAINS',
  'INTEGRATION_TOKEN_KEY', 'PII_FIELD_ENCRYPTION', 'PII_ENCRYPTION_MASTER_KEY',
  'BIDSTACK_JOB_SIGNING_SECRET', 'BIDSTACK_TENANT_SCOPE_GUARD', 'QUERY_GUARD_REJECT',
  'RATE_LIMIT_REDIS_REQUIRED', 'STORAGE_DRIVER', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT',
  'S3_FORCE_PATH_STYLE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
  'RFP_LLM_PROVIDER', 'OMNIROUTE_MODEL', 'SENTRY_DSN', 'SENTRY_ENVIRONMENT',
  // Cloudflare Workers AI. Both the token AND the account id are required —
  // the account id is part of the endpoint URL, so shipping one without the
  // other resolves to "no provider" and every AI step silently stubs.
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_MODEL', 'CLOUDFLARE_BASE_URL',
];
function setVars(service) {
  log(`setting env on ${service}`);
  const pairs = [];
  for (const k of RUNTIME_KEYS) if (env[k] !== undefined && env[k] !== '') pairs.push(`${k}=${env[k]}`);
  pairs.push('NODE_ENV=production');
  pairs.push(`OMNIROUTE_BASE_URL=${OMNI_INTERNAL}`);
  // Build one call: repeated --set flags, --skip-deploys (we deploy explicitly after).
  const args = ['variables', '--service', service, '--skip-deploys'];
  for (const p of pairs) args.push('--set', p);
  const r = railway(args);
  if (!r.ok) die(`setting vars on ${service}: ${r.out.split('\n').slice(-4).join(' ')}`);
}
setVars('api');
setVars('worker');

// ── 3. Migrate the cloud DB (safe: idempotent deploy of applied migrations) ──
log('running migrations against the cloud DB');
const mig = spawnSync('pnpm', ['--filter', '@bidstack/db', 'migrate:deploy'], {
  cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
});
if (mig.status !== 0) die('migrate:deploy');
log('seeding org + RBAC');
spawnSync('pnpm', ['db:seed:prod', '--', '--clerk-org', env.CLERK_ORG_ID, '--name', env.ORG_NAME], {
  cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
});

// ── 4. Deploy api + worker ──────────────────────────────────────────────────
for (const svc of ['api', 'worker']) {
  log(`deploying ${svc}`);
  const up = railway(['redeploy', '--service', svc, '--yes'], { stdio: 'inherit' });
  if (!up.ok) {
    // Fall back to `up` if the service needs a fresh build.
    const alt = railway(['up', '--service', svc, '--ci'], { stdio: 'inherit' });
    if (!alt.ok) die(`deploy ${svc}`);
  }
}

log('Deployed. API: https://api-production-3437.up.railway.app (verify /health).');
log('Next: build+deploy the SPA with VITE_AUTH_MODE=clerk, VITE_API_URL=<railway api url>, VITE_CLERK_PUBLISHABLE_KEY=<pk>.');
log('Then sign in at the SPA as your Clerk admin, change password, invite team from Clerk → Organizations.');
