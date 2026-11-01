#!/usr/bin/env node
// Bring the Access-gated preview up from the `main` checkout on the box.
//
//   git fetch origin main && git checkout --detach origin/main
//   RELAY_KEY=... node apps/polo-preview/src/start-box.mjs
//
// This does not upload the Worker. The live Worker stays as the Access front
// door. Redeploying it from CI (or without RELAY_KEY / the existing DO) is
// what takes the preview down.

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const API_PORT = Number(process.env.PORT_API ?? 4020);
const WEB_PORT = Number(process.env.POLO_PREVIEW_WEB_PORT ?? 4180);
const PUBLIC_ORIGIN =
  process.env.POLO_PREVIEW_PUBLIC_ORIGIN ?? 'https://polo-preview.tony-walteur.workers.dev';

function log(message) {
  console.error(`[polo-preview-box] ${message}`);
}

function die(message) {
  log(`FAILED: ${message}`);
  process.exit(1);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

function run(command, args, env) {
  const child = spawn(command, args, {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) die(`${command} ${args.join(' ')} exited ${code}`);
  });
  return child;
}

async function waitFor(label, port, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) {
      log(`${label} is listening on ${port}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  die(`${label} did not open :${port}`);
}

if (!process.env.RELAY_KEY) die('RELAY_KEY is required (Worker secret; never commit it)');

if (!(await portOpen(API_PORT))) {
  log(`starting API on ${API_PORT}`);
  run('pnpm', ['--filter', '@bidstack/api', 'dev'], {
    PORT_API: String(API_PORT),
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
    PUBLIC_BASE_URL: PUBLIC_ORIGIN,
    PUBLIC_API_URL: PUBLIC_ORIGIN,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  });
  await waitFor('api', API_PORT);
} else {
  log(`reusing API already on ${API_PORT}`);
}

if (!(await portOpen(WEB_PORT))) {
  log(`starting web preview on ${WEB_PORT} (empty VITE_API_URL = same origin)`);
  run(
    'pnpm',
    ['--filter', '@bidstack/web', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(WEB_PORT)],
    {
      BIDSTACK_ALLOW_STUB_AUTH: 'true',
      VITE_AUTH_MODE: process.env.VITE_AUTH_MODE ?? 'stub',
      BIDSTACK_DEV_API_URL: `http://127.0.0.1:${API_PORT}`,
      POLO_PREVIEW_WEB_PORT: String(WEB_PORT),
    },
  );
  await waitFor('web', WEB_PORT);
} else {
  log(`reusing web already on ${WEB_PORT}`);
}

log('starting box relay');
run(process.execPath, [join(REPO, 'apps/polo-preview/src/box-relay.mjs')], {
  RELAY_KEY: process.env.RELAY_KEY,
  POLO_PREVIEW_API_ORIGIN: `http://127.0.0.1:${API_PORT}`,
  POLO_PREVIEW_WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
  POLO_PREVIEW_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
});
