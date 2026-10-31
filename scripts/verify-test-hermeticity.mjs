#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const DEFAULT_SCAN_ROOTS = ['apps/api/src'];
const VITEST_CONFIG_RE = /^vitest\.config\.(?:ts|mts|js|mjs)$/u;

// A vitest config that loads the whole repo-root .env lets local feature flags
// (API-key scope policy, Redis-required switches, ...) flip test outcomes.
// Configs must go through scripts/load-test-env.mjs, which only copies an
// allowlist of connection settings.
const BANNED_CONFIG_PATTERNS = [
  {
    id: 'full-dotenv-load',
    regex: /\bdotenv(?:Flow)?\.config\s*\(|['"]dotenv(?:-flow)?\/config['"]/u,
    message:
      'vitest configs must not load the full .env; use loadTestEnv() from scripts/load-test-env.mjs (connection-settings allowlist).',
  },
];

function collectVitestConfigs(rootDir) {
  const configs = [];
  for (const group of ['apps', 'packages']) {
    let entries = [];
    try {
      entries = readdirSync(join(rootDir, group), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(rootDir, group, entry.name);
      let files = [];
      try {
        files = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of files) if (VITEST_CONFIG_RE.test(name)) configs.push(join(dir, name));
    }
  }
  return configs;
}
const TEST_FILE_RE = /\.(?:integration\.)?test\.ts$/u;

const BANNED_PATTERNS = [
  {
    id: 'shared-seed-org',
    regex: /\borg_seed_mantu\b/u,
    message:
      'API tests must not bind to the shared org_seed_mantu tenant; use createIsolatedOrg() + useIsolatedOrgAuth() instead.',
  },
];

function collectTestFiles(rootDir, scanRoot) {
  const absoluteRoot = join(rootDir, scanRoot);
  const files = [];

  function walk(dir) {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(path);
      } else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
        files.push(path);
      }
    }
  }

  walk(absoluteRoot);
  return files;
}

export function scanTestHermeticity({
  rootDir = process.cwd(),
  scanRoots = DEFAULT_SCAN_ROOTS,
} = {}) {
  const files = scanRoots.flatMap((scanRoot) => collectTestFiles(rootDir, scanRoot));
  const failures = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const pattern of BANNED_PATTERNS) {
        if (!pattern.regex.test(line)) continue;
        failures.push({
          id: pattern.id,
          file: relative(rootDir, file).replaceAll('\\', '/'),
          line: index + 1,
          message: pattern.message,
        });
      }
    }
  }

  const configs = collectVitestConfigs(rootDir);
  for (const file of configs) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      for (const pattern of BANNED_CONFIG_PATTERNS) {
        if (!pattern.regex.test(line)) continue;
        failures.push({
          id: pattern.id,
          file: relative(rootDir, file).replaceAll('\\', '/'),
          line: index + 1,
          message: pattern.message,
        });
      }
    });
  }

  return {
    ok: failures.length === 0,
    checkedFiles: files.length,
    checkedConfigs: configs.length,
    failures,
  };
}

function printResult(result) {
  if (result.ok) {
    console.log(
      `[test-hermeticity] PASS checked ${result.checkedFiles} API test files and ${result.checkedConfigs} vitest configs; no shared seed org references or full .env loads found.`,
    );
    return;
  }

  console.error(
    `[test-hermeticity] FAIL found ${result.failures.length} hermeticity violation(s).`,
  );
  for (const failure of result.failures) {
    console.error(`- ${failure.file}:${failure.line} [${failure.id}] ${failure.message}`);
  }
}

async function runSelftest() {
  const root = mkdtempSync(join(tmpdir(), 'bidstack-test-hermeticity-'));
  try {
    const routeDir = join(root, 'apps/api/src/routes');
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(
      join(routeDir, 'good.integration.test.ts'),
      "import { createIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org';\n",
    );
    writeFileSync(
      join(routeDir, 'bad.integration.test.ts'),
      "const seed = { clerkOrg: 'org_seed_mantu' };\n",
    );

    const bad = scanTestHermeticity({ rootDir: root });
    assert.equal(bad.ok, false);
    assert.equal(bad.failures.length, 1);
    assert.equal(bad.failures[0].file, 'apps/api/src/routes/bad.integration.test.ts');

    rmSync(join(routeDir, 'bad.integration.test.ts'));
    const good = scanTestHermeticity({ rootDir: root });
    assert.equal(good.ok, true);
    assert.equal(good.checkedFiles, 1);

    // Config guard: a full .env load is flagged, the allowlisted loader is not.
    const apiDir = join(root, 'apps/api');
    writeFileSync(
      join(apiDir, 'vitest.config.ts'),
      "import dotenvFlow from 'dotenv-flow';\ndotenvFlow.config({ path: '../..' });\n",
    );
    const leaky = scanTestHermeticity({ rootDir: root });
    assert.equal(leaky.ok, false);
    assert.equal(leaky.failures[0].id, 'full-dotenv-load');
    writeFileSync(
      join(apiDir, 'vitest.config.ts'),
      "import dotenvFlow from 'dotenv-flow';\nloadTestEnv(dotenvFlow, '../..');\n",
    );
    assert.equal(scanTestHermeticity({ rootDir: root }).ok, true);

    // Loader: only allowlisted keys are copied and existing values win.
    const { loadTestEnv } = await import('./load-test-env.mjs');
    const fakeFlow = {
      listFiles: () => ['.env'],
      parse: () => ({
        DATABASE_URL: 'postgresql://from-file',
        REDIS_URL: 'redis://from-file',
        BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES: 'true',
        OUTBOUND_COMM_REDIS_REQUIRED: 'true',
      }),
    };
    const env = { REDIS_URL: 'redis://already-set' };
    loadTestEnv(fakeFlow, root, { env });
    assert.equal(env.DATABASE_URL, 'postgresql://from-file');
    assert.equal(env.REDIS_URL, 'redis://already-set');
    assert.equal(env.BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES, undefined);
    assert.equal(env.OUTBOUND_COMM_REDIS_REQUIRED, undefined);

    console.log('[test-hermeticity] selftest PASS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const args = new Set(process.argv.slice(2));
if (args.has('--selftest')) {
  await runSelftest();
} else {
  const result = scanTestHermeticity();
  printResult(result);
  if (!result.ok) process.exitCode = 1;
}
