#!/usr/bin/env node
// Build the always-on public demo for Vercel: SPA + API on ONE origin.
//
// Writes a Build Output API v3 tree (.vercel/output by default):
//   static/                      the SPA (VITE_AUTH_MODE=demo, same-origin API)
//   functions/api.func/          apps/api/dist/serverless.js + traced deps
//   config.json                  /api, /health, /livez, /readyz, /metrics and
//                                /webhooks go to the function; everything
//                                else is a file or falls back to index.html
//
// Run from the repo root after `pnpm install`. With POLO_SERVERLESS_MIGRATE=1
// it also applies Prisma migrations to the Neon database (direct, unpooled
// URL). Secret values are only read from the environment, never printed.
//
// Why a hand-written output instead of a root api/ entry: Vercel's
// @vercel/node tracing does not converge on this monorepo (see .vercelignore).
// Tracing the compiled entry with @vercel/nft here is bounded and predictable.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.env.VERCEL_OUTPUT_DIR || path.join(ROOT, '.vercel/output'));
const FUNC = path.join(OUT, 'functions/api.func');
const ENTRY = 'apps/api/dist/serverless.js';
const log = (m) => console.log(`[serverless-build] ${m}`);

function run(cmd, args, env = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

const pnpm = process.env.PNPM_BIN || 'pnpm';
const skipBuild = process.env.POLO_SERVERLESS_SKIP_BUILD === '1';

if (!skipBuild) {
  // 1. Prisma client + workspace packages + API (same order as apps/api/Dockerfile).
  run(pnpm, ['db:generate']);
  for (const pkg of ['shared', 'db', 'dust-client', 'memos', 'odoo-mcp-client', 'api']) {
    run(pnpm, ['--filter', `@bidstack/${pkg}`, 'build']);
  }

  // 2. SPA. VITE_API_URL is forced empty so the browser calls /api on its own
  // origin; project-level VITE_* values from the old split-origin demo must not leak in.
  run(pnpm, ['--filter', '@bidstack/web', 'exec', 'vite', 'build'], {
    NODE_ENV: 'production',
    VITE_AUTH_MODE: 'demo',
    VITE_API_URL: '',
    // Demo sign-in only: a project-level Clerk key would make Settings and the
    // login navbar act as if Clerk were active.
    VITE_CLERK_PUBLISHABLE_KEY: '',
    NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=6144',
  });
}

// 3. Migrations (opt-in). Neon's pooled URL is PgBouncer; migrate needs a direct one.
if (process.env.POLO_SERVERLESS_MIGRATE === '1') {
  const direct =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL;
  if (!direct) throw new Error('POLO_SERVERLESS_MIGRATE=1 but no database URL is set');
  run(pnpm, ['--filter', '@bidstack/db', 'migrate:deploy'], { DATABASE_URL: direct });
}

// 4. Trace the function's files.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FUNC, { recursive: true });

let nftEntry;
try {
  nftEntry = createRequire(import.meta.url).resolve('@vercel/nft', {
    paths: [process.env.NFT_PATH || ROOT, ROOT],
  });
} catch {
  throw new Error('@vercel/nft is not installed; set NFT_PATH to a directory that has it');
}
const { nodeFileTrace } = await import(pathToFileURL(nftEntry).href);

const { fileList, warnings } = await nodeFileTrace([path.join(ROOT, ENTRY)], {
  base: ROOT,
  processCwd: path.join(ROOT, 'apps/api'),
});
const files = new Set(fileList);
// The generated Prisma client is loaded through a computed path, so ship it
// whole (schema + query engine), keeping only the engine Vercel's Amazon Linux needs.
for (const f of walk(path.join(ROOT, 'packages/db/generated/client')))
  files.add(path.relative(ROOT, f));
files.add('apps/api/package.json');
let dropped = 0;
for (const f of [...files]) {
  const base = path.basename(f);
  const otherEngine =
    /query_engine-.*\.(so\.node|node)$/.test(base) && !base.includes('rhel-openssl-3.0.x');
  if (otherEngine || base.endsWith('.map') || base.endsWith('.d.ts')) {
    files.delete(f);
    dropped += 1;
  }
}

let bytes = 0;
for (const rel of files) {
  const src = path.join(ROOT, rel);
  const dst = path.join(FUNC, rel);
  let st;
  try {
    st = fs.lstatSync(src);
  } catch {
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (st.isSymbolicLink()) {
    if (!fs.existsSync(dst)) fs.symlinkSync(fs.readlinkSync(src), dst);
  } else if (st.isFile()) {
    fs.copyFileSync(src, dst);
    bytes += st.size;
  }
}
log(
  `function: ${files.size} files, ${(bytes / 1048576).toFixed(1)} MB (dropped ${dropped}); ${warnings.size} trace warnings`,
);

fs.writeFileSync(
  path.join(FUNC, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: process.env.POLO_SERVERLESS_RUNTIME || 'nodejs22.x',
      handler: ENTRY,
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: Number(process.env.POLO_SERVERLESS_MAX_DURATION || 60),
      memory: Number(process.env.POLO_SERVERLESS_MEMORY || 1024),
    },
    null,
    2,
  ),
);

// 5. Static SPA + routing.
fs.cpSync(path.join(ROOT, 'apps/web/dist'), path.join(OUT, 'static'), { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/(?:api|health|livez|readyz|metrics|webhooks)(?:/.*)?$', dest: '/api' },
        { handle: 'filesystem' },
        { src: '^/assets/.*$', status: 404 },
        { src: '^/.*$', dest: '/index.html', headers: { 'cache-control': 'no-cache' } },
      ],
    },
    null,
    2,
  ),
);
log(`wrote ${OUT}`);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}
