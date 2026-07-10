#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const DEFAULT_SCAN_ROOTS = ['apps/api/src'];
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

  return {
    ok: failures.length === 0,
    checkedFiles: files.length,
    failures,
  };
}

function printResult(result) {
  if (result.ok) {
    console.log(
      `[test-hermeticity] PASS checked ${result.checkedFiles} API test files; no shared seed org references found.`,
    );
    return;
  }

  console.error(
    `[test-hermeticity] FAIL found ${result.failures.length} shared seed org reference(s).`,
  );
  for (const failure of result.failures) {
    console.error(`- ${failure.file}:${failure.line} [${failure.id}] ${failure.message}`);
  }
}

function runSelftest() {
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

    console.log('[test-hermeticity] selftest PASS');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const args = new Set(process.argv.slice(2));
if (args.has('--selftest')) {
  runSelftest();
} else {
  const result = scanTestHermeticity();
  printResult(result);
  if (!result.ok) process.exitCode = 1;
}
