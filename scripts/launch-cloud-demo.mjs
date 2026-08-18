#!/usr/bin/env node
// Bring the app up on the DURABLE managed cloud data (Neon + Upstash) instead
// of the throwaway local Docker Postgres — passwordless mode, so real data
// entered now persists (and is backed up) across restarts and the demo reaper.
//
//   node scripts/launch-cloud-demo.mjs
//
// It reads DATABASE_URL + REDIS_URL from .env.production.local (values stay in
// this process), disables the org reaper, and hands off to
// demo-local-backend.mjs which starts the API + tunnel and redeploys the SPA.
// This is the "usable today with no accounts" bridge; the shared/invite/RBAC
// experience still needs Clerk (see docs/GO-LIVE-SELFHOST.md).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(REPO, '.env.production.local');
if (!existsSync(ENV_FILE)) {
  console.error('[cloud-demo] .env.production.local not found — run finish-cloud-provisioning.mjs first');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(ENV_FILE, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
if (!env.DATABASE_URL || /[<]/.test(env.DATABASE_URL)) {
  console.error('[cloud-demo] DATABASE_URL not provisioned — run finish-cloud-provisioning.mjs');
  process.exit(1);
}
if (!env.REDIS_URL || /[<]/.test(env.REDIS_URL)) {
  console.error('[cloud-demo] REDIS_URL not provisioned — run finish-cloud-provisioning.mjs');
  process.exit(1);
}

console.log('[cloud-demo] launching on cloud Neon + Upstash (durable), reaper disabled');
const res = spawnSync('node', ['scripts/demo-local-backend.mjs'], {
  cwd: REPO,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    VITE_AUTH_MODE: 'demo',
    // ~10 years — real data entered in the demo persists instead of being reaped.
    DEMO_ORG_TTL_HOURS: '87600',
  },
});
process.exit(res.status ?? 1);
