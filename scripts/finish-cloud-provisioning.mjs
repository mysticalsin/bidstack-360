#!/usr/bin/env node
// Finish provisioning the managed data layer AFTER you've accepted the two
// Vercel Marketplace terms pages (Neon + Upstash) in the browser — the only
// step that legally needs a human. Run:
//
//   node scripts/finish-cloud-provisioning.mjs
//
// It provisions Neon Postgres + Upstash Redis under your Vercel account, pulls
// their connection strings, and merges DATABASE_URL + REDIS_URL into
// .env.production.local. Secret values are read by THIS process only and are
// never printed. Idempotent: re-running reuses existing resources.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(REPO, '.env.production.local');
const PULL_FILE = join(REPO, '.vercel', '.env.provisioned.local');

const log = (m) => console.log(`[provision] ${m}`);
const die = (m) => {
  console.error(`[provision] FAILED: ${m}`);
  process.exit(1);
};

function vercel(args) {
  const res = spawnSync('npx', ['vercel', ...args], {
    cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32',
  });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

// ── 1. Provision (retry after terms acceptance) ──────────────────────────────
for (const slug of ['neon', 'upstash/upstash-kv']) {
  log(`provisioning ${slug}`);
  const r = vercel(['integration', 'add', slug, '--no-claim', '--no-env-pull']);
  if (!r.ok) {
    if (/terms_acceptance_required|action_required/.test(r.out)) {
      die(`${slug} still needs its Vercel terms accepted in the browser. Open:\n` +
          `    Neon:    https://vercel.com/~/integrations/accept-terms/neon?source=cli\n` +
          `    Upstash: https://vercel.com/~/integrations/accept-terms/upstash?source=cli\n` +
          `  then re-run this script.`);
    }
    // "already installed / resource exists" is success for our purposes.
    if (!/already|exists|installed/i.test(r.out)) {
      die(`${slug}: ${r.out.split('\n').slice(-5).join(' ')}`);
    }
    log(`${slug} already provisioned — reusing`);
  }
}

// ── 2. Pull the connection strings (production env) ──────────────────────────
log('pulling connection strings');
const pull = vercel(['env', 'pull', PULL_FILE, '--environment=production', '--yes']);
if (!pull.ok || !existsSync(PULL_FILE)) die(`env pull: ${pull.out.split('\n').slice(-5).join(' ')}`);

const pulled = {};
for (const line of readFileSync(PULL_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(?:"?)(.*?)(?:"?)$/);
  if (m) pulled[m[1]] = m[2];
}

const databaseUrl = pulled.DATABASE_URL || pulled.POSTGRES_URL || pulled.DATABASE_URL_UNPOOLED;
// Upstash exposes a TCP redis URL under one of these depending on product.
const redisUrl = pulled.REDIS_URL || pulled.KV_URL || pulled.UPSTASH_REDIS_URL;
if (!databaseUrl) die('no DATABASE_URL/POSTGRES_URL in the pulled env — check the Neon install');
if (!redisUrl) {
  die('no TCP Redis URL in the pulled env (found only a REST URL?). The app needs a rediss:// URL — ' +
      'in Upstash, use the "for Redis" database and copy its TLS URL, or paste REDIS_URL by hand.');
}
if (!/^rediss?:\/\//.test(redisUrl)) {
  log(`WARNING: REDIS_URL is "${redisUrl.split('://')[0]}://…" — production wants rediss:// (TLS). Verify it.`);
}

// ── 3. Merge into .env.production.local (create skeleton if missing) ─────────
if (!existsSync(ENV_FILE)) {
  const gen = spawnSync('node', ['scripts/gen-prod-secrets.mjs'], {
    cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (gen.status !== 0) die('gen-prod-secrets.mjs');
}
const lines = readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
const set = { DATABASE_URL: databaseUrl, REDIS_URL: redisUrl };
const seen = new Set();
const merged = lines.map((line) => {
  const m = line.match(/^([A-Z0-9_]+)=/);
  if (m && set[m[1]] !== undefined) {
    seen.add(m[1]);
    return `${m[1]}=${set[m[1]]}`;
  }
  return line;
});
for (const [k, v] of Object.entries(set)) if (!seen.has(k)) merged.push(`${k}=${v}`);
writeFileSync(ENV_FILE, merged.join('\n'), { mode: 0o600 });

log('DATABASE_URL + REDIS_URL wired into .env.production.local (values not shown).');
log('Still to fill by you: Clerk keys, CLERK_ORG_ID, R2, PUBLIC_BASE_URL/PUBLIC_API_URL, CF_TUNNEL_NAME.');
log('Then: node scripts/go-live-selfhost.mjs');
