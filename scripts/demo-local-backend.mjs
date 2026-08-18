#!/usr/bin/env node
// Bring the public demo back up when the Railway backend is unavailable.
//
// WHY THIS EXISTS: the demo SPA on Vercel is static and calls an absolute API
// origin that is inlined at BUILD time (`VITE_API_URL`). Railway normally serves
// that origin. When it is down, the fallback is a local API behind a Cloudflare
// quick tunnel — and a quick tunnel gets a NEW random hostname every start, so
// reviving the demo is not "restart a process", it is "restart a process, then
// rebuild and redeploy the SPA against its new address". Four coupled steps that
// are easy to get half-right by hand. This does them in order and verifies each.
//
//   node scripts/demo-local-backend.mjs
//   node scripts/demo-local-backend.mjs --no-deploy   # bring the API + tunnel up only
//
// It is a STOPGAP. The durable fix is a Railway plan: the services, env and
// domain are all still configured there, and `VITE_API_URL` goes back to
// https://api-production-3437.up.railway.app. See DEPLOY.md.
//
// Two traps this encodes, both of which cost real time when hit by hand:
//
//  1. `VITE_API_URL` is stored on Vercel as a SENSITIVE variable, so
//     `vercel env pull` returns "[SENSITIVE]" and a local `vercel build` silently
//     produces a bundle with an EMPTY api base — every request then hits the SPA
//     origin, gets index.html back through the catch-all rewrite, and the app
//     fails in a way that looks like a backend outage. So the URL is exported
//     into the build environment here; vite.config.ts prefers `process.env`.
//  2. A stale `.vercel/.env.production.local` from an earlier session overrides
//     the pull, so a rebuild happily re-inlines the OLD api host. It is deleted
//     before every build.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = Number(process.env.PORT_API ?? 4100);
const DEMO_ORIGIN = 'https://bidstack-demo.vercel.app';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://bidstack:bidstack@localhost:5433/bidstack_demo';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

// The demo session secret is a real secret: it lives outside the repo so it can
// never be committed, and it is reused across restarts so tokens issued before a
// restart keep working.
const SECRET_FILE = join(
  process.env.LOCALAPPDATA ?? process.env.HOME ?? REPO,
  'bidstack-demo',
  'demo-session-secret',
);

const log = (msg) => console.log(`[demo] ${msg}`);
const die = (msg) => {
  console.error(`[demo] FAILED: ${msg}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: REPO,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    shell: process.platform === 'win32',
    encoding: 'utf8',
    ...opts,
  });
  return res;
}

function demoSessionSecret() {
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, 'utf8').trim();
  mkdirSync(dirname(SECRET_FILE), { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  log(`generated a demo session secret at ${SECRET_FILE}`);
  return secret;
}

async function waitFor(label, check, { timeoutMs = 120_000, everyMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) die(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

const ok = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
};

// ── 1. Datastores ──────────────────────────────────────────────────────────
log('starting postgres + redis');
run('docker', ['compose', 'up', '-d', 'postgres', 'redis']);

// ── 1b. OmniRoute AI gateway ────────────────────────────────────────────────
// The free, keyless AI gateway that powers every AI feature (copilot + RFP).
// Start it if it isn't already listening on :20128.
const OMNIROUTE_URL = (process.env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128/v1').replace(
  /\/v1\/?$/,
  '',
);
if (await ok(`${OMNIROUTE_URL}/v1/models`)) {
  log('OmniRoute already running');
} else {
  log('starting OmniRoute AI gateway');
  const omni = spawn('omniroute', [], {
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  omni.unref();
  // Non-fatal bounded wait (NOT waitFor, which would die() the whole launch):
  // if OmniRoute doesn't come up, AI features fall back to Dust/stub.
  const omniDeadline = Date.now() + 60_000;
  let omniUp = false;
  while (Date.now() < omniDeadline) {
    if (await ok(`${OMNIROUTE_URL}/v1/models`)) {
      omniUp = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  log(omniUp ? 'OmniRoute up' : 'OmniRoute not up — AI features will use Dust/stub fallback');
}

// ── 2. API ─────────────────────────────────────────────────────────────────
if (await ok(`http://127.0.0.1:${API_PORT}/health`)) {
  log(`api already healthy on :${API_PORT}`);
} else {
  log('building the api');
  if (run('pnpm', ['--filter', '@bidstack/api', 'build']).status !== 0) die('api build');

  log(`starting the api on :${API_PORT}`);
  const api = spawn('node', ['dist/main.js'], {
    cwd: join(REPO, 'apps', 'api'),
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      // development, not production: the production config refuses a loopback
      // REDIS_URL outright, and this backend is loopback by definition.
      NODE_ENV: 'development',
      PORT_API: String(API_PORT),
      HOST: '0.0.0.0',
      DATABASE_URL,
      REDIS_URL,
      DEMO_MODE: 'true',
      DEMO_PUBLIC_DEPLOYMENT_ACK: 'true',
      DEMO_SESSION_SECRET: demoSessionSecret(),
      // Drives CORS: the api only accepts browser origins derived from this.
      PUBLIC_BASE_URL: DEMO_ORIGIN,
      STORAGE_DRIVER: 'local',
      CLERK_SECRET_KEY: '',
      // Route every AI feature through the local OmniRoute gateway (free,
      // keyless, auto-fallback across many providers). The copilot services
      // fall back to it when Dust isn't configured; the worker's RFP steps use
      // it too. Override OMNIROUTE_BASE_URL if the gateway runs elsewhere.
      RFP_LLM_PROVIDER: process.env.RFP_LLM_PROVIDER ?? 'omniroute',
      OMNIROUTE_BASE_URL: process.env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128/v1',
    },
  });
  api.unref();
  await waitFor('api health', () => ok(`http://127.0.0.1:${API_PORT}/health`));
}
log('api healthy');

// ── 3. Tunnel ──────────────────────────────────────────────────────────────
log('opening a Cloudflare quick tunnel');
const tunnelLog = join(REPO, '.tmp', 'demo-tunnel.log');
mkdirSync(dirname(tunnelLog), { recursive: true });
writeFileSync(tunnelLog, '');
const tunnel = spawn(
  'cloudflared',
  ['tunnel', '--url', `http://localhost:${API_PORT}`, '--no-autoupdate', '--logfile', tunnelLog],
  { detached: true, stdio: 'ignore', shell: process.platform === 'win32' },
);
tunnel.unref();

let apiOrigin = '';
await waitFor(
  'tunnel hostname',
  async () => {
    const match = readFileSync(tunnelLog, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!match) return false;
    apiOrigin = match[0];
    return true;
  },
  { timeoutMs: 90_000, everyMs: 1500 },
);
log(`tunnel: ${apiOrigin}`);
await waitFor('tunnel reachability', () => ok(`${apiOrigin}/health`), { timeoutMs: 90_000 });
log('api reachable through the tunnel');

if (process.argv.includes('--no-deploy')) {
  log(`done. Point VITE_API_URL at ${apiOrigin} when you deploy.`);
  process.exit(0);
}

// ── 4. Rebuild + redeploy the SPA against the new origin ───────────────────
log('updating VITE_API_URL on Vercel');
run('vercel', ['env', 'rm', 'VITE_API_URL', 'production', '--yes'], { quiet: true });
const added = run('vercel', ['env', 'add', 'VITE_API_URL', 'production'], {
  input: apiOrigin,
  quiet: true,
});
if (added.status !== 0) die(`vercel env add: ${added.stderr}`);

// Trap 2: a stale pull would override the value exported below.
rmSync(join(REPO, '.vercel', '.env.production.local'), { force: true });
rmSync(join(REPO, '.vercel', 'output'), { recursive: true, force: true });

log('building the SPA');
// Trap 1: exported explicitly, because the Vercel variable is sensitive and
// cannot be pulled back down for a local build.
if (run('vercel', ['build', '--prod', '--yes'], { env: { ...process.env, VITE_API_URL: apiOrigin } }).status !== 0) {
  die('vercel build');
}

log('deploying');
if (run('vercel', ['deploy', '--prebuilt', '--prod', '--yes']).status !== 0) die('vercel deploy');

await waitFor('demo origin', () => ok(DEMO_ORIGIN), { timeoutMs: 60_000 });
log(`done — ${DEMO_ORIGIN} is served by ${apiOrigin}`);
log('the tunnel dies with this machine; re-run to get the demo back.');
