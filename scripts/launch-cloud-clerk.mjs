#!/usr/bin/env node
// Bring the REAL (Clerk-authenticated) CRM online on this PC: OmniRoute + API
// (cloud Neon/Upstash data) behind a Cloudflare tunnel, and redeploy the SPA in
// Clerk mode against the fresh tunnel URL. This is the durable, reboot-safe
// launcher for the on-PC hosting of the real app (vs launch-cloud-demo.mjs,
// which runs the passwordless demo).
//
//   node scripts/launch-cloud-clerk.mjs
//
// Reads Clerk keys + DB/Redis from .env.production.local. Because a Cloudflare
// quick tunnel gets a new hostname each start, this rebuilds + redeploys the SPA
// so bidstack-demo.vercel.app always points at the current API. For a stable URL
// with no per-boot redeploy, deploy to Railway instead (scripts/railway-golive.mjs).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(REPO, '.env.production.local');
const API_PORT = Number(process.env.PORT_API ?? 4100);
const DEMO_ORIGIN = 'https://bidstack-demo.vercel.app';
const log = (m) => console.log(`[clerk] ${m}`);
const die = (m) => { console.error(`[clerk] FAILED: ${m}`); process.exit(1); };

if (!existsSync(ENV_FILE)) die('.env.production.local missing');
const env = Object.fromEntries(
  readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
for (const k of ['DATABASE_URL', 'REDIS_URL', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY']) {
  if (!env[k] || /^<|_live_<|pk_live_</.test(env[k])) die(`${k} not set in .env.production.local`);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
}
const ok = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(8000) })).ok; } catch { return false; } };
async function waitUp(url, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ok(url)) return true; await new Promise((r) => setTimeout(r, 2000)); }
  return false;
}

// 1. OmniRoute
if (!(await ok('http://localhost:20128/v1/models'))) {
  log('starting OmniRoute');
  spawn('omniroute', [], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  await waitUp('http://localhost:20128/v1/models', 60_000);
}

// 2. API (Clerk mode). NODE_ENV=development so the prod S3-storage requirement
// is skipped (files use local disk until R2 is configured); Clerk auth is active.
if (await ok(`http://127.0.0.1:${API_PORT}/health`)) {
  log('api already healthy');
} else {
  if (run('pnpm', ['--filter', '@bidstack/api', 'build']).status !== 0) die('api build');
  const api = spawn('node', ['dist/main.js'], {
    cwd: join(REPO, 'apps', 'api'), detached: true, stdio: 'ignore', shell: process.platform === 'win32',
    env: {
      ...process.env, NODE_ENV: 'development', PORT_API: String(API_PORT), HOST: '0.0.0.0',
      DATABASE_URL: env.DATABASE_URL, REDIS_URL: env.REDIS_URL,
      CLERK_SECRET_KEY: env.CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY: env.CLERK_PUBLISHABLE_KEY,
      PUBLIC_BASE_URL: DEMO_ORIGIN, STORAGE_DRIVER: 'local',
      RFP_LLM_PROVIDER: 'omniroute', OMNIROUTE_BASE_URL: 'http://localhost:20128/v1', OMNIROUTE_MODEL: 'auto/best-free',
    },
  });
  api.unref();
  if (!(await waitUp(`http://127.0.0.1:${API_PORT}/health`))) die('api health');
}
log('api healthy (Clerk mode)');

// 3. Tunnel
log('opening Cloudflare tunnel');
const tunnelLog = join(REPO, '.tmp', 'clerk-tunnel.log');
mkdirSync(dirname(tunnelLog), { recursive: true });
writeFileSync(tunnelLog, '');
spawn('cloudflared', ['tunnel', '--url', `http://localhost:${API_PORT}`, '--no-autoupdate', '--logfile', tunnelLog],
  { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
let apiOrigin = '';
const deadline = Date.now() + 90_000;
while (Date.now() < deadline && !apiOrigin) {
  const m = readFileSync(tunnelLog, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) apiOrigin = m[0]; else await new Promise((r) => setTimeout(r, 1500));
}
if (!apiOrigin || !(await waitUp(`${apiOrigin}/health`))) die('tunnel');
log(`tunnel: ${apiOrigin}`);

// 4. Redeploy the SPA (Clerk) against the fresh tunnel URL.
run('vercel', ['env', 'rm', 'VITE_API_URL', 'production', '--yes'], { stdio: 'ignore' });
spawnSync('vercel', ['env', 'add', 'VITE_API_URL', 'production'], { cwd: REPO, input: apiOrigin, encoding: 'utf8', shell: process.platform === 'win32' });
rmSync(join(REPO, '.vercel', 'output'), { recursive: true, force: true });
rmSync(join(REPO, '.vercel', '.env.production.local'), { force: true });
const spaEnv = { ...process.env, VITE_AUTH_MODE: 'clerk', VITE_API_URL: apiOrigin, VITE_CLERK_PUBLISHABLE_KEY: env.CLERK_PUBLISHABLE_KEY };
if (run('vercel', ['build', '--prod', '--yes'], { env: spaEnv }).status !== 0) die('vercel build');
if (run('vercel', ['deploy', '--prebuilt', '--prod', '--yes'], { env: spaEnv }).status !== 0) die('vercel deploy');
await waitUp(DEMO_ORIGIN, 60_000);
log(`LIVE — ${DEMO_ORIGIN} (real Clerk login) → ${apiOrigin}`);
