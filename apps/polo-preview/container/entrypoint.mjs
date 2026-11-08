#!/usr/bin/env node
// Process supervisor and front listener for the Polo Cloudflare Container.
// :8080 answers at once (a "starting" page while booting), serves the built
// SPA, proxies API paths to Fastify on :4020, and exposes /__internal/* for
// the Durable Object only (shared key). Boot waits for the Durable Object to
// restore the latest R2 snapshot or ask for a fresh seed; if neither arrives
// it seeds by itself so the app never stays dark.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { isApiPath } from '../src/protocol.js';

const APP = '/app';
const WEB_ROOT = join(APP, 'apps/web/dist');
const DATA = '/data';
const PGDATA = join(DATA, 'pg');
const STORAGE = join(DATA, 'storage');
const API_PORT = 4020;
const PORT = 8080;
const SELF_SEED_AFTER_MS = 120_000;
const BOOT_ID = randomUUID();
const INTERNAL_KEY = process.env.POLO_INTERNAL_KEY || '';
const PG_USER = 'bidstack';
const DB = 'bidstack';
const DATABASE_URL = `postgres://${PG_USER}:${PG_USER}@127.0.0.1:5432/${DB}`;

let phase = 'booting';
let detail = '';
let apiChild = null;
let apiRestarts = 0;
let selfSeeded = false;

function log(message) {
  console.log(`[polo-container] ${new Date().toISOString()} ${message}`);
}

function setPhase(next, why = '') {
  phase = next;
  detail = why;
  log(`phase ${next}${why ? `: ${why}` : ''}`);
}

function pgUid() {
  const out = spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' });
  const gid = spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' });
  return { uid: Number(out.stdout.trim()), gid: Number(gid.stdout.trim()) };
}

function runSync(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${res.status}`);
}

function apiEnv() {
  return {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(API_PORT),
    PORT_API: String(API_PORT),
    DATABASE_URL,
    DATABASE_URL_UNPOOLED: DATABASE_URL,
    REDIS_URL: 'redis://polo-redis:6379',
    CF_ACCESS_AUTH: 'true',
    CF_ACCESS_TEAM_DOMAIN: 'tony-walteur.cloudflareaccess.com',
    CF_ACCESS_TRUST_LOOPBACK_EMAIL: 'true',
    POLO_DATA_MODE: 'demo',
    POLO_REAL_ORG_CLERK: 'org_seed_mantu',
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_ROOT: STORAGE,
    BIDSTACK_ALLOW_LOCAL_STORAGE: 'true',
    PII_FIELD_ENCRYPTION: 'true',
    BIDSTACK_TENANT_SCOPE_GUARD: 'warn',
    PUPPETEER_SKIP_DOWNLOAD: 'true',
  };
}

function startDatabase() {
  // The API refuses a loopback REDIS_URL in production; Redis is a sidecar in
  // this same container, reached through a named alias.
  writeFileSync('/etc/hosts', '127.0.0.1 polo-redis\n', { flag: 'a' });
  const { uid, gid } = pgUid();
  mkdirSync(PGDATA, { recursive: true });
  mkdirSync(STORAGE, { recursive: true });
  runSync('chown', ['-R', 'postgres:postgres', PGDATA]);
  if (!existsSync(join(PGDATA, 'PG_VERSION'))) {
    runSync('initdb', ['-D', PGDATA, '-U', PG_USER, '--auth=trust', '-E', 'UTF8'], { uid, gid });
  }
  const pg = spawn('postgres', ['-D', PGDATA, '-h', '127.0.0.1', '-k', '/tmp', '-c', 'shared_buffers=256MB'], {
    uid,
    gid,
    stdio: 'inherit',
  });
  pg.on('exit', (code) => {
    log(`postgres exited ${code}; stopping the container so it restarts clean`);
    process.exit(1);
  });
  const redis = spawn('redis-server', ['--bind', '127.0.0.1', '--port', '6379', '--save', '', '--appendonly', 'no'], {
    stdio: 'inherit',
  });
  redis.on('exit', (code) => {
    log(`redis exited ${code}; stopping the container`);
    process.exit(1);
  });
  for (let i = 0; i < 60; i++) {
    const ready = spawnSync('pg_isready', ['-h', '127.0.0.1', '-U', PG_USER]);
    if (ready.status === 0) break;
    spawnSync('sleep', ['1']);
  }
  const exists = spawnSync('psql', ['-h', '127.0.0.1', '-U', PG_USER, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB}'`], { encoding: 'utf8' });
  if (exists.stdout.trim() !== '1') runSync('createdb', ['-h', '127.0.0.1', '-U', PG_USER, DB]);
}

function migrate() {
  runSync(join(APP, 'packages/db/node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', 'packages/db/prisma/schema.prisma'], {
    cwd: APP,
    env: apiEnv(),
  });
}

function seed() {
  // The preview is a demo instance: its database holds only the fixture org.
  runSync(join(APP, 'packages/db/node_modules/.bin/tsx'), ['src/seed.ts'], {
    cwd: join(APP, 'packages/db'),
    env: { ...apiEnv(), BIDSTACK_ALLOW_FIXTURE_SEED: 'true' },
  });
}

function startApi() {
  apiChild = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: APP, env: apiEnv(), stdio: 'inherit' });
  apiChild.on('exit', (code) => {
    apiChild = null;
    if (phase !== 'ready') return;
    const delay = Math.min(30_000, 1_000 * 2 ** apiRestarts++);
    log(`api exited ${code}; restarting in ${delay}ms`);
    setTimeout(startApi, delay);
  });
}

async function waitForApi() {
  for (let i = 0; i < 120; i++) {
    const ok = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: API_PORT, path: '/livez', timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('api did not answer /livez');
}

async function finishBoot(how) {
  try {
    if (how === 'seed') {
      setPhase('seeding');
      migrate();
      seed();
    } else {
      setPhase('migrating', 'after restore');
      migrate();
    }
    startApi();
    await waitForApi();
    apiRestarts = 0;
    setPhase('ready', how);
  } catch (err) {
    setPhase('failed', String(err));
  }
}

function changeCounter() {
  const out = spawnSync(
    'psql',
    ['-h', '127.0.0.1', '-U', PG_USER, '-d', DB, '-tAc', 'SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) FROM pg_stat_user_tables'],
    { encoding: 'utf8' },
  );
  return Number(out.stdout.trim() || 0);
}

function snapshotFile() {
  const dir = '/tmp/snapshot';
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  runSync('pg_dump', ['-h', '127.0.0.1', '-U', PG_USER, '-Fc', '-f', join(dir, 'db.dump'), DB]);
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ at: new Date().toISOString(), bootId: BOOT_ID }));
  const out = '/tmp/snapshot.tgz';
  runSync('tar', ['-czf', out, '-C', dir, 'db.dump', 'meta.json', '-C', DATA, 'storage']);
  return out;
}

async function restoreFrom(req) {
  const dir = '/tmp/restore';
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'snapshot.tgz');
  await pipeline(req, createWriteStream(file));
  runSync('tar', ['-xzf', file, '-C', dir]);
  // The database is fresh on every boot, so restore without --clean. pg_restore
  // exits 1 on harmless warnings; the row check below is the real verdict.
  spawnSync('pg_restore', ['-h', '127.0.0.1', '-U', PG_USER, '-d', DB, '--no-owner', join(dir, 'db.dump')], { stdio: 'inherit' });
  const orgs = spawnSync('psql', ['-h', '127.0.0.1', '-U', PG_USER, '-d', DB, '-tAc', 'SELECT count(*) FROM orgs'], { encoding: 'utf8' });
  if (!(Number(orgs.stdout.trim()) > 0)) throw new Error('restored database has no orgs');
  if (existsSync(join(dir, 'storage'))) {
    rmSync(STORAGE, { recursive: true, force: true });
    runSync('cp', ['-a', join(dir, 'storage'), STORAGE]);
  }
}

function authorized(req) {
  const given = Buffer.from(String(req.headers['x-polo-internal-key'] || ''));
  const want = Buffer.from(INTERNAL_KEY);
  return INTERNAL_KEY.length > 0 && given.length === want.length && timingSafeEqual(given, want);
}

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

async function handleInternal(req, res, url) {
  if (!authorized(req)) return sendJson(res, 404, { error: 'not_found' });
  if (url.pathname === '/__internal/state') {
    return sendJson(res, 200, { phase, detail, bootId: BOOT_ID, apiUp: Boolean(apiChild) });
  }
  if (url.pathname === '/__internal/restore' && req.method === 'PUT') {
    if (phase !== 'awaiting-data') return sendJson(res, 409, { phase });
    setPhase('restoring');
    try {
      await restoreFrom(req);
    } catch (err) {
      setPhase('failed', `restore: ${String(err)}`);
      return sendJson(res, 500, { phase, detail });
    }
    sendJson(res, 202, { phase: 'migrating' });
    void finishBoot('restore');
    return;
  }
  if (url.pathname === '/__internal/seed' && req.method === 'POST') {
    if (phase !== 'awaiting-data') return sendJson(res, 409, { phase });
    sendJson(res, 202, { phase: 'seeding' });
    void finishBoot('seed');
    return;
  }
  if (url.pathname === '/__internal/snapshot') {
    if (phase !== 'ready') return sendJson(res, 409, { phase });
    if (selfSeeded) return sendJson(res, 409, { phase, detail: 'self-seeded; keeping the R2 snapshot' });
    const counter = changeCounter();
    const since = Number(url.searchParams.get('since'));
    if (Number.isFinite(since) && since === counter) {
      res.writeHead(204);
      return res.end();
    }
    const file = snapshotFile();
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-length': String(statSync(file).size),
      'x-polo-change-counter': String(counter),
    });
    createReadStream(file).pipe(res);
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

function serveStatic(req, res, pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(WEB_ROOT, safe);
  let isFile = false;
  try {
    isFile = file.startsWith(WEB_ROOT) && statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) file = join(WEB_ROOT, 'index.html');
  const type = TYPES[extname(file)] || 'application/octet-stream';
  const immutable = isFile && pathname.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function proxyApi(req, res) {
  const headers = { ...req.headers };
  delete headers['x-forwarded-for'];
  delete headers['x-real-ip'];
  delete headers['x-polo-internal-key'];
  const upstream = http.request(
    { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => sendJson(res, 503, { error: 'api_restarting', retryAfterSeconds: 5 }, { 'retry-after': '5' }));
  req.pipe(upstream);
}

function startingPage(req, res, pathname) {
  const accept = String(req.headers.accept || '');
  if (isApiPath(pathname) || !accept.includes('text/html')) {
    return sendJson(res, 503, { error: 'polo_starting', phase, retryAfterSeconds: 5 }, { 'retry-after': '5' });
  }
  res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Polo is starting</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1f2430}p{color:#5b6270}</style></head>
<body><div><h1>Polo is starting</h1><p>Loading your data. This page reloads by itself.</p></div></body></html>`);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://polo.internal');
    if (url.pathname.startsWith('/__internal/')) {
      handleInternal(req, res, url).catch((err) => sendJson(res, 500, { error: String(err) }));
      return;
    }
    if (phase !== 'ready') return startingPage(req, res, url.pathname);
    if (isApiPath(url.pathname)) return proxyApi(req, res);
    return serveStatic(req, res, url.pathname);
  })
  .listen(PORT, '0.0.0.0', () => log(`listening on ${PORT}, boot ${BOOT_ID}`));

try {
  startDatabase();
  setPhase('awaiting-data');
  setTimeout(() => {
    if (phase === 'awaiting-data') {
      log('no restore or seed request arrived; seeding by itself');
      selfSeeded = true;
      void finishBoot('seed');
    }
  }, SELF_SEED_AFTER_MS);
} catch (err) {
  setPhase('failed', String(err));
}

process.on('SIGTERM', () => {
  log('SIGTERM: stopping');
  apiChild?.kill('SIGTERM');
  process.exit(0);
});
