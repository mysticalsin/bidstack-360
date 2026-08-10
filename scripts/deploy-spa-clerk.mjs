#!/usr/bin/env node
// Build + deploy the SPA to Vercel in CLERK auth mode, pointed at the Railway
// (or any) production API. Run after scripts/railway-golive.mjs.
//
//   node scripts/deploy-spa-clerk.mjs
//
// Reads VITE_API_URL (the public API origin), VITE_CLERK_PUBLISHABLE_KEY, and
// PUBLIC_BASE_URL from .env.production.local. The Clerk publishable key is not a
// secret (it ships in the browser bundle by design). Mirrors the trap-handling
// in demo-local-backend.mjs: exports the sensitive Vercel var into the build env
// and clears a stale prebuilt output.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(REPO, '.env.production.local');
const log = (m) => console.log(`[spa] ${m}`);
const die = (m) => { console.error(`[spa] FAILED: ${m}`); process.exit(1); };

if (!existsSync(ENV_FILE)) die('.env.production.local missing');
const env = {};
for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

// The Railway API origin. Default to the known project URL; override by adding
// VITE_API_URL to .env.production.local (or PUBLIC_API_URL).
const apiUrl = (env.VITE_API_URL || env.PUBLIC_API_URL || 'https://api-production-3437.up.railway.app').replace(/\/+$/, '');
const pk = env.CLERK_PUBLISHABLE_KEY;
if (!pk || /^<|pk_live_<|^$/.test(pk)) die('CLERK_PUBLISHABLE_KEY not set in .env.production.local');
const spaOrigin = env.PUBLIC_BASE_URL;

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...extraEnv } });
  return r.status === 0;
}

const buildEnv = {
  VITE_AUTH_MODE: 'clerk',
  VITE_API_URL: apiUrl,
  VITE_CLERK_PUBLISHABLE_KEY: pk,
};

// Push VITE_API_URL to Vercel (sensitive) so a dashboard-triggered rebuild also
// gets it; then build prebuilt locally with the value exported (trap 1).
run('vercel', ['env', 'rm', 'VITE_API_URL', 'production', '--yes']);
spawnSync('vercel', ['env', 'add', 'VITE_API_URL', 'production'], {
  cwd: REPO, input: apiUrl, encoding: 'utf8', shell: process.platform === 'win32',
});
rmSync(join(REPO, '.vercel', '.env.production.local'), { force: true });
rmSync(join(REPO, '.vercel', 'output'), { recursive: true, force: true });

log(`building SPA (clerk) against ${apiUrl}`);
if (!run('vercel', ['build', '--prod', '--yes'], buildEnv)) die('vercel build');
log('deploying');
if (!run('vercel', ['deploy', '--prebuilt', '--prod', '--yes'], buildEnv)) die('vercel deploy');
log(`LIVE — ${spaOrigin || 'your Vercel URL'} (Clerk sign-in) → ${apiUrl}`);
log('Sign in as your Clerk admin, change your password in Clerk, invite the team from Clerk → Organizations → Members.');
