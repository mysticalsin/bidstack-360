#!/usr/bin/env node
// Production self-host go-live: API + worker on THIS PC behind a stable
// Cloudflare named tunnel, data in managed cloud (Neon + Upstash), real Clerk
// auth, SPA on Vercel. One command:
//
//   node scripts/go-live-selfhost.mjs                 # full: migrate, seed, build, run, deploy
//   node scripts/go-live-selfhost.mjs --backend-only  # skip the SPA build+deploy
//   node scripts/go-live-selfhost.mjs --no-migrate    # skip DB migrate+seed (already bootstrapped)
//
// Reads .env.production.local (create it with `node scripts/gen-prod-secrets.mjs`
// then fill the <placeholders>). See docs/GO-LIVE-SELFHOST.md.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(REPO, '.env.production.local');
const argv = process.argv.slice(2);
// --run-only: reboot-recovery path — start API + worker + tunnel from the
// existing build; no migrate, no rebuild, no SPA redeploy. This is what the
// Windows auto-start task runs on boot.
const RUN_ONLY = argv.includes('--run-only');
const BACKEND_ONLY = argv.includes('--backend-only') || RUN_ONLY;
const NO_MIGRATE = argv.includes('--no-migrate') || RUN_ONLY;
const NO_BUILD = RUN_ONLY;

const log = (m) => console.log(`[go-live] ${m}`);
const die = (m) => {
  console.error(`[go-live] FAILED: ${m}`);
  process.exit(1);
};

// ── Load + validate env ──────────────────────────────────────────────────────
if (!existsSync(ENV_FILE)) {
  die('.env.production.local not found — run: node scripts/gen-prod-secrets.mjs, then fill it.');
}
const envVars = {};
for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) envVars[m[1]] = m[2];
}

const REQUIRED = [
  'DATABASE_URL', 'REDIS_URL', 'PUBLIC_BASE_URL', 'PUBLIC_API_URL',
  'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'CLERK_ORG_ID', 'ORG_NAME',
  'CF_TUNNEL_NAME', 'S3_BUCKET', 'S3_ENDPOINT', 'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'INTEGRATION_TOKEN_KEY', 'PII_ENCRYPTION_MASTER_KEY',
  'BIDSTACK_JOB_SIGNING_SECRET',
];
const unset = REQUIRED.filter((k) => {
  const v = envVars[k];
  return !v || v.trim() === '' || v.trim() === '__GEN__' || /^<.*>$/.test(v.trim());
});
if (unset.length) {
  die(`these .env.production.local values are still unset:\n    ${unset.join('\n    ')}\n  Fill them (docs/GO-LIVE-SELFHOST.md) and re-run.`);
}

const childEnv = { ...process.env, ...envVars };
const API_PORT = Number(envVars.PORT_API || 4100);
const apiOrigin = envVars.PUBLIC_API_URL.replace(/\/+$/, '');

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32', env: childEnv, ...opts,
  });
  return res.status === 0;
}
const ok = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(8000) })).ok;
  } catch {
    return false;
  }
};
async function waitFor(label, check, { timeoutMs = 120_000, everyMs = 2000 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) die(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

// ── 1. Ensure pgvector + migrate + seed the org (cloud DB) ───────────────────
if (!NO_MIGRATE) {
  log('applying migrations to the cloud database');
  if (!run('pnpm', ['--filter', '@bidstack/db', 'migrate:deploy'])) {
    die('migrate:deploy — check DATABASE_URL and that the Neon DB has the vector extension available');
  }
  log(`seeding org "${envVars.ORG_NAME}" (${envVars.CLERK_ORG_ID}) + RBAC`);
  if (!run('pnpm', ['db:seed:prod', '--', '--clerk-org', envVars.CLERK_ORG_ID, '--name', envVars.ORG_NAME])) {
    die('db:seed:prod');
  }
}

// ── 2. Build API + worker ────────────────────────────────────────────────────
if (NO_BUILD) {
  log('run-only: skipping build (using existing dist)');
  if (!existsSync(join(REPO, 'apps/api/dist/main.js'))) die('api not built — run full go-live once before --run-only');
} else {
  log('building api + worker');
  if (!run('pnpm', ['--filter', '@bidstack/api', 'build'])) die('api build');
  if (!run('pnpm', ['--filter', '@bidstack/worker', 'build'])) die('worker build');
}

// ── 3. Start API + worker (detached, reading the prod env) ───────────────────
function startService(name, cwd) {
  log(`starting ${name}`);
  const child = spawn('node', ['dist/main.js'], {
    cwd: join(REPO, cwd), detached: true, stdio: 'ignore',
    shell: process.platform === 'win32', env: childEnv,
  });
  child.unref();
  return child;
}
if (await ok(`http://127.0.0.1:${API_PORT}/health`)) {
  log(`api already healthy on :${API_PORT} — reusing`);
} else {
  startService('api', 'apps/api');
  await waitFor('api local health', () => ok(`http://127.0.0.1:${API_PORT}/health`));
}
startService('worker', 'apps/worker');
log('api + worker up');

// ── 4. Named Cloudflare tunnel → stable public API hostname ──────────────────
log(`starting Cloudflare named tunnel "${envVars.CF_TUNNEL_NAME}" (→ ${apiOrigin})`);
const tunnel = spawn('cloudflared', ['tunnel', 'run', envVars.CF_TUNNEL_NAME], {
  detached: true, stdio: 'ignore', shell: process.platform === 'win32', env: childEnv,
});
tunnel.unref();
await waitFor('public API via tunnel', () => ok(`${apiOrigin}/health`), { timeoutMs: 90_000 });
log(`API is live at ${apiOrigin}`);

// ── 5. Build + deploy the SPA (Clerk mode, pointed at the public API) ────────
if (BACKEND_ONLY) {
  log('backend-only: skipping SPA build/deploy.');
  log(`Done. API live at ${apiOrigin}. Deploy the SPA separately with VITE_API_URL=${apiOrigin}.`);
  process.exit(0);
}
log('building the SPA (Clerk auth) against the public API');
const spaEnv = {
  ...childEnv,
  VITE_AUTH_MODE: 'clerk',
  VITE_API_URL: apiOrigin,
  VITE_CLERK_PUBLISHABLE_KEY: envVars.CLERK_PUBLISHABLE_KEY,
};
// Vercel stores VITE_API_URL as sensitive → export it into the build env, then
// build prebuilt and deploy (mirrors scripts/demo-local-backend.mjs).
if (!run('vercel', ['build', '--prod', '--yes'], { env: spaEnv })) die('vercel build');
if (!run('vercel', ['deploy', '--prebuilt', '--prod', '--yes'], { env: spaEnv })) die('vercel deploy');
await waitFor('SPA origin', () => ok(envVars.PUBLIC_BASE_URL), { timeoutMs: 60_000 });

log(`LIVE — ${envVars.PUBLIC_BASE_URL} (SPA) → ${apiOrigin} (API on this PC)`);
log('Invite teammates from Clerk → Organizations → Members → Invite; they sign in at the SPA URL.');
log('The tunnel + API run on this machine. Use the Windows auto-start task so they survive a reboot.');
