#!/usr/bin/env node
// Mac package/preview Playwright gate.
//
// Linux `pnpm e2e` lets apps/web/playwright.config.ts build the web app itself
// and boot an API on 4010. This runner is the other path: the package `build`
// and `preview` scripts, the API's own default port 4000, then WebKit and
// Chromium one at a time. Playwright is pointed at that preview with
// E2E_BASE_URL so its webServer does not start a second stack.
//
// It refuses to install browsers or boot servers when the repo filesystem or
// the Playwright browser cache has under 6 GiB free. WebKit plus Chromium
// downloads are large enough to wedge a Mac mid-install otherwise.
//
//   node scripts/run-mac-playwright-preview.mjs
//   node scripts/run-mac-playwright-preview.mjs --preflight-only
//   node scripts/run-mac-playwright-preview.mjs --dry-run
//   node scripts/run-mac-playwright-preview.mjs --selftest

import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statfsSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = 4000;
const MIN_FREE_BYTES = 6n * 1024n * 1024n * 1024n;
const GIB = 1024n * 1024n * 1024n;
const HEALTH_TIMEOUT_MS = 120_000;
const SMOKE_SPEC = 'e2e/smoke.spec.ts';

const children = [];
let shutdownPromise = null;

function parseArgs(argv) {
  const options = {
    help: false,
    selftest: false,
    preflightOnly: false,
    dryRun: false,
    allowNonDarwin: false,
    chromiumSmoke: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--selftest') options.selftest = true;
    else if (arg === '--preflight-only') options.preflightOnly = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--allow-non-darwin') options.allowNonDarwin = true;
    else if (arg === '--chromium-smoke') {
      options.chromiumSmoke = true;
      options.allowNonDarwin = true;
    } else {
      throw Object.assign(new Error(`Unknown argument: ${arg}`), { exitCode: 2 });
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Mac package/preview Playwright gate

Usage:
  node scripts/run-mac-playwright-preview.mjs
  node scripts/run-mac-playwright-preview.mjs --preflight-only
  node scripts/run-mac-playwright-preview.mjs --dry-run
  node scripts/run-mac-playwright-preview.mjs --selftest

The real suite runs on macOS (Node 24). It builds @bidstack/web, starts the API
on 127.0.0.1:4000, starts vite preview from the package script, then runs
webkit-desktop and chromium-desktop one after another with one worker.

--chromium-smoke runs e2e/smoke.spec.ts on chromium-desktop only. It is not
the Mac gate.
`);
}

function nodeEngineOk(version = process.versions.node) {
  const major = Number(String(version).replace(/^v/, '').split('.')[0]);
  return major >= 24 && major < 25;
}

function playwrightBrowsersPath(env = process.env, platform = process.platform, home = homedir()) {
  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  if (override === '0') return null;
  if (override) return path.resolve(override);
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
  if (platform === 'win32') {
    return path.join(env.USERPROFILE || home, 'AppData', 'Local', 'ms-playwright');
  }
  return path.join(home, '.cache', 'ms-playwright');
}

function diskTargets({
  repo = repoRoot,
  env = process.env,
  platform = process.platform,
  home = homedir(),
} = {}) {
  const targets = [{ label: 'repo', path: repo }];
  const browsers = playwrightBrowsersPath(env, platform, home);
  if (browsers) targets.push({ label: 'playwright-browsers', path: browsers });
  return targets;
}

function existingPathForStat(target) {
  let current = path.resolve(target);
  const root = path.parse(current).root;
  while (!existsSync(current)) {
    if (current === root) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function freeBytes(target) {
  const stats = statfsSync(existingPathForStat(target));
  return BigInt(stats.bavail) * BigInt(stats.bsize);
}

function readDisk(targets) {
  return targets.map((target) => {
    const statPath = existingPathForStat(target.path);
    return {
      ...target,
      statPath,
      freeBytes: freeBytes(target.path),
    };
  });
}

function assessDisk(readings, minFreeBytes = MIN_FREE_BYTES) {
  const failures = readings.filter((reading) => reading.freeBytes < minFreeBytes);
  return { ok: failures.length === 0, failures, minFreeBytes };
}

function formatGiB(bytes) {
  const whole = bytes / GIB;
  const frac = ((bytes % GIB) * 100n) / GIB;
  return `${whole}.${frac.toString().padStart(2, '0')}`;
}

function diskLocation(reading) {
  if (!reading.path || reading.path === reading.statPath) return reading.statPath ?? reading.path;
  return `${reading.path} via ${reading.statPath}`;
}

function printDisk(readings, disk) {
  const parts = readings.map(
    (reading) => `${reading.label} ${formatGiB(reading.freeBytes)} GiB (${diskLocation(reading)})`,
  );
  const summary = parts.join('; ');
  if (disk.ok) {
    console.log(`[mac-preview] disk ok: ${summary}; floor ${formatGiB(disk.minFreeBytes)} GiB`);
    return;
  }
  console.error(
    `[mac-preview] refusing to start: free disk is under ${formatGiB(disk.minFreeBytes)} GiB (${summary})`,
  );
}

function hostGate(platform, options) {
  if (platform === 'darwin' || options.allowNonDarwin) {
    return { ok: true, reason: platform === 'darwin' ? 'darwin' : 'allow-non-darwin' };
  }
  return {
    ok: false,
    reason:
      `refusing Playwright on ${platform}. This gate is macOS WebKit plus Chromium ` +
      'against the package preview. Pass --allow-non-darwin only for a non-Safari host.',
  };
}

function loadWebPackage() {
  const packagePath = path.join(repoRoot, 'apps', 'web', 'package.json');
  return JSON.parse(readFileSync(packagePath, 'utf8'));
}

function assertPackageScripts(webPackage) {
  for (const name of ['build', 'preview', 'e2e']) {
    if (!webPackage.scripts?.[name]) {
      throw new Error(`@bidstack/web is missing the ${name} script this runner reuses`);
    }
  }
}

function readPreviewPort(webPackage) {
  const script = webPackage.scripts?.preview ?? '';
  const match = /(?:^|\s)--port(?:=|\s+)(\d+)/.exec(script);
  if (!match) {
    throw new Error(
      'apps/web package preview script must pass --port so the runner can target that preview',
    );
  }
  return Number(match[1]);
}

function childEnv(overrides) {
  return { ...process.env, ...overrides };
}

function buildPlan({ previewPort, chromiumSmoke = false }) {
  const previewOrigin = `http://127.0.0.1:${previewPort}`;
  const apiOrigin = `http://127.0.0.1:${API_PORT}`;
  const browserArgs = chromiumSmoke ? ['chromium'] : ['webkit', 'chromium'];
  const playwrightEnv = childEnv({
    E2E_BASE_URL: previewOrigin,
    E2E_API_URL: apiOrigin,
    E2E_API_PORT: String(API_PORT),
    E2E_WEB_PORT: String(previewPort),
    E2E_WORKERS: '1',
    E2E_AUTH_MODE: 'stub',
    VITE_AUTH_MODE: 'stub',
    // Empty blocks a Clerk key in the environment from turning off stub storage.
    VITE_CLERK_PUBLISHABLE_KEY: '',
  });
  const projects = chromiumSmoke
    ? [{ project: 'chromium-desktop', spec: SMOKE_SPEC }]
    : [
        { project: 'webkit-desktop', spec: null },
        { project: 'chromium-desktop', spec: null },
      ];

  return {
    previewOrigin,
    apiOrigin,
    previewPort,
    install: {
      argv: [
        'corepack',
        'pnpm',
        '--filter',
        '@bidstack/web',
        'exec',
        'playwright',
        'install',
        ...browserArgs,
      ],
    },
    build: {
      argv: ['corepack', 'pnpm', '--filter', '@bidstack/web', 'build'],
      env: childEnv({
        VITE_AUTH_MODE: 'stub',
        BIDSTACK_ALLOW_STUB_AUTH: 'true',
        VITE_ENABLE_E2E_ROLE_HEADER: 'true',
        // Empty keeps the package preview same-origin. The preview proxy carries /api.
        VITE_API_URL: '',
        VITE_CLERK_PUBLISHABLE_KEY: '',
      }),
    },
    api: {
      argv: ['corepack', 'pnpm', '--filter', '@bidstack/api', 'exec', 'tsx', 'src/main.ts'],
      env: childEnv({
        PORT_API: String(API_PORT),
        PUBLIC_BASE_URL: previewOrigin,
        PUBLIC_API_URL: apiOrigin,
        BIDSTACK_ALLOW_STUB_ROLE_HEADER: 'true',
        API_RATE_LIMIT_MAX: '5000',
        PUBLIC_BOOKING_RATE_LIMIT_MAX: '5000',
      }),
    },
    preview: {
      argv: [
        'corepack',
        'pnpm',
        '--filter',
        '@bidstack/web',
        'preview',
        '--',
        '--host',
        '127.0.0.1',
      ],
      env: childEnv({
        BIDSTACK_DEV_API_URL: apiOrigin,
        BIDSTACK_ALLOW_STUB_AUTH: 'true',
        VITE_AUTH_MODE: 'stub',
      }),
    },
    playwright: projects.map((entry) => ({
      project: entry.project,
      spec: entry.spec,
      argv: [
        'corepack',
        'pnpm',
        '--filter',
        '@bidstack/web',
        'exec',
        'playwright',
        'test',
        ...(entry.spec ? [entry.spec] : []),
        `--project=${entry.project}`,
        '--workers=1',
      ],
      env: playwrightEnv,
    })),
  };
}

function printPlan(plan) {
  const lines = [
    `install: ${plan.install.argv.join(' ')}`,
    `build: ${plan.build.argv.join(' ')}`,
    'build env: VITE_AUTH_MODE=stub BIDSTACK_ALLOW_STUB_AUTH=true VITE_ENABLE_E2E_ROLE_HEADER=true VITE_API_URL=(empty, same-origin) VITE_CLERK_PUBLISHABLE_KEY=(cleared)',
    `api: ${plan.api.argv.join(' ')}`,
    `api env: PORT_API=${API_PORT} PUBLIC_BASE_URL=${plan.previewOrigin} PUBLIC_API_URL=${plan.apiOrigin} BIDSTACK_ALLOW_STUB_ROLE_HEADER=true API_RATE_LIMIT_MAX=5000 PUBLIC_BOOKING_RATE_LIMIT_MAX=5000`,
    `preview: ${plan.preview.argv.join(' ')}`,
    `preview env: BIDSTACK_DEV_API_URL=${plan.apiOrigin}`,
  ];
  for (const step of plan.playwright) {
    lines.push(`playwright: ${step.argv.join(' ')}`);
  }
  lines.push(
    `playwright env: E2E_BASE_URL=${plan.previewOrigin} E2E_API_URL=${plan.apiOrigin} E2E_WORKERS=1 E2E_AUTH_MODE=stub VITE_AUTH_MODE=stub VITE_CLERK_PUBLISHABLE_KEY=(cleared)`,
  );
  console.log(`[mac-preview] dry-run\n${lines.map((line) => `  ${line}`).join('\n')}`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

function runForeground(argv, env) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw Object.assign(result.error, { exitCode: 1 });
  }
  if (result.status !== 0) {
    throw Object.assign(new Error(`${argv.join(' ')} exited ${result.status ?? 'from a signal'}`), {
      exitCode: result.status ?? 1,
    });
  }
}

function startServer(label, argv, env, logPath) {
  const logFd = openSync(logPath, 'a');
  const child = spawn(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  closeSync(logFd);
  children.push({ label, child, logPath });
  return child;
}

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
  }
  const deadline = Date.now() + 2_000;
  while (child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

function shutdown() {
  if (!shutdownPromise) {
    shutdownPromise = (async () => {
      for (const entry of children) {
        await stopChild(entry.child);
      }
    })();
  }
  return shutdownPromise;
}

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHttp(url, child) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${url} process exited ${child.exitCode} before it was healthy`);
    }
    if (await probe(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function redact(text) {
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://[redacted]')
    .replace(/redis:\/\/\S+/gi, 'redis://[redacted]')
    .replace(/(secret|token|password|api[_-]?key)(["'\s:=]+)(\S+)/gi, '$1$2[redacted]');
}

function tail(file) {
  try {
    return redact(readFileSync(file, 'utf8')).split(/\r?\n/u).slice(-40).join('\n');
  } catch {
    return '';
  }
}

function runSelfTest() {
  assert.equal(assessDisk([{ freeBytes: MIN_FREE_BYTES - 1n }]).ok, false);
  assert.equal(assessDisk([{ freeBytes: MIN_FREE_BYTES }]).ok, true);
  assert.equal(assessDisk([{ freeBytes: MIN_FREE_BYTES + 1n }]).ok, true);
  assert.equal(formatGiB(MIN_FREE_BYTES), '6.00');
  assert.equal(
    diskLocation({
      path: '/Users/tony/Library/Caches/ms-playwright',
      statPath: '/Users/tony/Library/Caches',
    }),
    '/Users/tony/Library/Caches/ms-playwright via /Users/tony/Library/Caches',
  );
  assert.equal(
    diskLocation({ path: '/work/bidstack', statPath: '/work/bidstack' }),
    '/work/bidstack',
  );

  assert.equal(nodeEngineOk('22.23.4'), false);
  assert.equal(nodeEngineOk('v24.0.0'), true);
  assert.equal(nodeEngineOk('25.0.0'), false);

  assert.equal(hostGate('darwin', { allowNonDarwin: false }).ok, true);
  assert.equal(hostGate('linux', { allowNonDarwin: false }).ok, false);
  assert.equal(hostGate('linux', { allowNonDarwin: true }).ok, true);

  const darwinBrowsers = playwrightBrowsersPath({}, 'darwin', '/Users/tony');
  assert.equal(darwinBrowsers, path.join('/Users/tony', 'Library', 'Caches', 'ms-playwright'));
  assert.equal(
    playwrightBrowsersPath({ PLAYWRIGHT_BROWSERS_PATH: '0' }, 'darwin', '/Users/tony'),
    null,
  );
  const targets = diskTargets({
    repo: '/work/bidstack',
    env: { PLAYWRIGHT_BROWSERS_PATH: '0' },
    platform: 'darwin',
    home: '/Users/tony',
  });
  assert.deepEqual(targets, [{ label: 'repo', path: '/work/bidstack' }]);

  const scratch = mkdtempSync(path.join(tmpdir(), 'mac-preview-stat-'));
  try {
    const missing = path.join(scratch, 'missing', 'browsers');
    assert.equal(existingPathForStat(missing), scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  assert.equal(typeof freeBytes(repoRoot), 'bigint');
  assert.ok(freeBytes(repoRoot) >= 0n);

  const webPackage = loadWebPackage();
  assertPackageScripts(webPackage);
  const previewPort = readPreviewPort(webPackage);
  assert.equal(previewPort, 4173);
  const plan = buildPlan({ previewPort });
  assert.deepEqual(
    plan.playwright.map((step) => step.project),
    ['webkit-desktop', 'chromium-desktop'],
  );
  for (const step of plan.playwright) {
    assert.ok(step.argv.includes('--workers=1'));
    assert.equal(step.argv.filter((arg) => arg.startsWith('--project=')).length, 1);
    assert.equal(step.env.E2E_BASE_URL, `http://127.0.0.1:${previewPort}`);
    assert.equal(step.env.E2E_API_URL, 'http://127.0.0.1:4000');
    assert.equal(step.env.E2E_WORKERS, '1');
    assert.equal(step.env.VITE_CLERK_PUBLISHABLE_KEY, '');
  }
  assert.ok(plan.install.argv.includes('webkit'));
  assert.ok(plan.install.argv.includes('chromium'));
  assert.equal(plan.install.argv.includes('firefox'), false);
  assert.equal(plan.install.argv.includes('--with-deps'), false);
  assert.deepEqual(plan.build.argv, ['corepack', 'pnpm', '--filter', '@bidstack/web', 'build']);
  assert.equal(plan.build.env.VITE_API_URL, '');
  assert.equal(plan.build.env.VITE_ENABLE_E2E_ROLE_HEADER, 'true');
  assert.ok(plan.api.argv.includes('src/main.ts'));
  assert.equal(plan.api.argv.includes('dev'), false);
  assert.equal(plan.api.env.PORT_API, '4000');
  assert.ok(plan.preview.argv.includes('preview'));
  assert.equal(plan.preview.env.BIDSTACK_DEV_API_URL, 'http://127.0.0.1:4000');

  const smoke = buildPlan({ previewPort, chromiumSmoke: true });
  assert.equal(smoke.playwright.length, 1);
  assert.equal(smoke.playwright[0].project, 'chromium-desktop');
  assert.ok(smoke.playwright[0].argv.includes(SMOKE_SPEC));
  assert.equal(smoke.install.argv.includes('webkit'), false);

  const rendered = [];
  const originalLog = console.log;
  console.log = (line) => rendered.push(String(line));
  try {
    printPlan(plan);
    printDisk(
      [
        {
          label: 'repo',
          path: '/work/bidstack',
          statPath: '/work/bidstack',
          freeBytes: MIN_FREE_BYTES,
        },
      ],
      assessDisk([{ freeBytes: MIN_FREE_BYTES }]),
    );
  } finally {
    console.log = originalLog;
  }
  const text = rendered.join('\n');
  assert.match(text, /webkit-desktop/);
  assert.match(text, /chromium-desktop/);
  assert.equal(text.includes('firefox'), false);
  assert.equal(/postgres(?:ql)?:\/\//i.test(text), false);
  assert.equal(text.includes('sk_'), false);
}

async function run(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  if (options.selftest) {
    runSelfTest();
    console.log('[mac-preview] selftest passed');
    return;
  }

  const webPackage = loadWebPackage();
  assertPackageScripts(webPackage);
  const previewPort = readPreviewPort(webPackage);
  const plan = buildPlan({ previewPort, chromiumSmoke: options.chromiumSmoke });
  const readings = readDisk(diskTargets());
  const disk = assessDisk(readings);
  printDisk(readings, disk);
  if (!disk.ok) {
    process.exitCode = 1;
    return;
  }
  if (options.preflightOnly) {
    const notes = [`host ${process.platform}`];
    if (nodeEngineOk()) notes.push(`node ${process.versions.node} matches .nvmrc`);
    else {
      notes.push(
        `node ${process.versions.node} is outside engines >=24 <25; the suite refuses that`,
      );
    }
    if (process.platform !== 'darwin') {
      notes.push('the suite refuses non-macOS hosts unless --allow-non-darwin');
    }
    console.log(`[mac-preview] preflight only. ${notes.join('. ')}.`);
    return;
  }
  if (options.dryRun) {
    printPlan(plan);
    const host = hostGate(process.platform, options);
    if (!host.ok) {
      console.log(`[mac-preview] a real run stops here: ${host.reason}`);
    }
    return;
  }

  const host = hostGate(process.platform, options);
  if (!host.ok) {
    console.error(`[mac-preview] ${host.reason}`);
    process.exitCode = 2;
    return;
  }
  if (!nodeEngineOk()) {
    throw Object.assign(
      new Error(
        `Node ${process.versions.node} is outside the repo engines (>=24 <25). Use the version in .nvmrc.`,
      ),
      { exitCode: 1 },
    );
  }

  for (const port of [API_PORT, previewPort]) {
    if (!(await portFree(port))) {
      throw Object.assign(new Error(`127.0.0.1:${port} is already in use`), { exitCode: 1 });
    }
  }

  const logDir = mkdtempSync(path.join(tmpdir(), 'bidstack-mac-preview-'));
  console.log(`[mac-preview] server logs: ${logDir}`);
  runForeground(plan.install.argv, process.env);
  runForeground(plan.build.argv, plan.build.env);

  const apiLog = path.join(logDir, 'api.log');
  const api = startServer('api', plan.api.argv, plan.api.env, apiLog);
  try {
    await waitForHttp(`${plan.apiOrigin}/health`, api);
  } catch (error) {
    const excerpt = tail(apiLog);
    if (excerpt.trim()) console.error(excerpt);
    throw error;
  }
  console.log(`[mac-preview] API healthy at ${plan.apiOrigin}`);

  const previewLog = path.join(logDir, 'preview.log');
  const preview = startServer('preview', plan.preview.argv, plan.preview.env, previewLog);
  try {
    await waitForHttp(plan.previewOrigin, preview);
  } catch (error) {
    const excerpt = tail(previewLog);
    if (excerpt.trim()) console.error(excerpt);
    throw error;
  }
  console.log(`[mac-preview] preview healthy at ${plan.previewOrigin}`);

  for (const step of plan.playwright) {
    console.log(`[mac-preview] ${step.project}`);
    runForeground(step.argv, step.env);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.on('SIGINT', () => {
    shutdown().finally(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    shutdown().finally(() => process.exit(143));
  });

  try {
    await run(process.argv.slice(2));
  } catch (error) {
    console.error(`[mac-preview] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error.exitCode ?? 1;
  } finally {
    await shutdown();
  }
}
