#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_REPORT_PATH = 'deploy-evidence/playwright-a11y.json';
const DEFAULT_OUTPUT_PATH = 'deploy-evidence/a11y-latest.json';
const DEFAULT_PROJECTS = ['chromium-desktop'];
const DEFAULT_SPECS = [
  'e2e/a11y/axe.spec.ts',
  'e2e/a11y/color-contrast.spec.ts',
  'e2e/a11y/keyboard-nav.spec.ts',
];
const ACCEPTED_PROFILES = new Set(['wcag-keyboard-regression', 'release-a11y']);
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function parseArgs(argv) {
  const parsed = {
    reportPath: process.env.BIDSTACK_A11Y_PLAYWRIGHT_JSON_REPORT || DEFAULT_REPORT_PATH,
    outputPath: process.env.BIDSTACK_A11Y_EVIDENCE || DEFAULT_OUTPUT_PATH,
    deployEnv: process.env.BIDSTACK_DEPLOY_ENV || process.env.E2E_ENVIRONMENT || 'staging',
    target:
      process.env.BIDSTACK_A11Y_TARGET ||
      process.env.BIDSTACK_BROWSER_REGRESSION_TARGET ||
      process.env.E2E_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      '',
    authMode:
      process.env.BIDSTACK_A11Y_AUTH_MODE ||
      process.env.E2E_AUTH_MODE ||
      process.env.VITE_AUTH_MODE ||
      '',
    productionBuild:
      process.env.BIDSTACK_A11Y_PRODUCTION_BUILD === 'true' ||
      process.env.BIDSTACK_A11Y_PRODUCTION_BUILD === '1' ||
      process.env.BIDSTACK_BROWSER_PRODUCTION_BUILD === 'true' ||
      process.env.BIDSTACK_BROWSER_PRODUCTION_BUILD === '1',
    commandExitCode: Number(process.env.BIDSTACK_A11Y_COMMAND_EXIT_CODE ?? 0),
    profile: process.env.BIDSTACK_A11Y_PROFILE || 'wcag-keyboard-regression',
    projects: parseList(process.env.BIDSTACK_A11Y_PROJECTS, DEFAULT_PROJECTS),
    specs: parseList(process.env.BIDSTACK_A11Y_SPECS, DEFAULT_SPECS),
    runPlaywright: parseOptionalBoolean(process.env.BIDSTACK_A11Y_RUN_PLAYWRIGHT) ?? false,
    strict: process.env.BIDSTACK_A11Y_EVIDENCE_STRICT !== 'false',
    selftest: false,
  };
  const cliProjects = [];
  const cliSpecs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--report') {
      parsed.reportPath = argv[index + 1] ?? parsed.reportPath;
      index += 1;
    } else if (arg.startsWith('--report=')) {
      parsed.reportPath = arg.slice('--report='.length);
    } else if (arg === '--out') {
      parsed.outputPath = argv[index + 1] ?? parsed.outputPath;
      index += 1;
    } else if (arg.startsWith('--out=')) {
      parsed.outputPath = arg.slice('--out='.length);
    } else if (arg === '--env') {
      parsed.deployEnv = argv[index + 1] ?? parsed.deployEnv;
      index += 1;
    } else if (arg.startsWith('--env=')) {
      parsed.deployEnv = arg.slice('--env='.length);
    } else if (arg === '--target') {
      parsed.target = argv[index + 1] ?? parsed.target;
      index += 1;
    } else if (arg.startsWith('--target=')) {
      parsed.target = arg.slice('--target='.length);
    } else if (arg === '--auth-mode') {
      parsed.authMode = argv[index + 1] ?? parsed.authMode;
      index += 1;
    } else if (arg.startsWith('--auth-mode=')) {
      parsed.authMode = arg.slice('--auth-mode='.length);
    } else if (arg === '--profile') {
      parsed.profile = argv[index + 1] ?? parsed.profile;
      index += 1;
    } else if (arg.startsWith('--profile=')) {
      parsed.profile = arg.slice('--profile='.length);
    } else if (arg === '--project') {
      cliProjects.push(...parseList(argv[index + 1] ?? '', []));
      index += 1;
    } else if (arg.startsWith('--project=')) {
      cliProjects.push(...parseList(arg.slice('--project='.length), []));
    } else if (arg === '--spec') {
      cliSpecs.push(...parseList(argv[index + 1] ?? '', []));
      index += 1;
    } else if (arg.startsWith('--spec=')) {
      cliSpecs.push(...parseList(arg.slice('--spec='.length), []));
    } else if (arg === '--command-exit-code') {
      parsed.commandExitCode = Number(argv[index + 1] ?? parsed.commandExitCode);
      index += 1;
    } else if (arg.startsWith('--command-exit-code=')) {
      parsed.commandExitCode = Number(arg.slice('--command-exit-code='.length));
    } else if (arg === '--production-build') {
      parsed.productionBuild = true;
    } else if (arg === '--run-playwright') {
      parsed.runPlaywright = true;
    } else if (arg === '--no-strict') {
      parsed.strict = false;
    } else if (arg === '--selftest') {
      parsed.selftest = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.deployEnv = normalizeEnvironment(parsed.deployEnv);
  if (cliProjects.length > 0) parsed.projects = unique(cliProjects);
  if (cliSpecs.length > 0) parsed.specs = unique(cliSpecs);
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack accessibility evidence writer

Usage:
  node scripts/write-a11y-evidence.mjs --run-playwright --target https://staging.example --auth-mode clerk --production-build
  node scripts/write-a11y-evidence.mjs --report deploy-evidence/playwright-a11y.json --target https://staging.example --auth-mode clerk --production-build
  node scripts/write-a11y-evidence.mjs --selftest

Environment:
  BIDSTACK_A11Y_PLAYWRIGHT_JSON_REPORT
  BIDSTACK_A11Y_EVIDENCE
  BIDSTACK_A11Y_TARGET
  BIDSTACK_A11Y_AUTH_MODE
  BIDSTACK_A11Y_PRODUCTION_BUILD
  BIDSTACK_A11Y_COMMAND_EXIT_CODE
  BIDSTACK_A11Y_PROFILE
  BIDSTACK_A11Y_PROJECTS
  BIDSTACK_A11Y_SPECS
  BIDSTACK_A11Y_RUN_PLAYWRIGHT=true
  BIDSTACK_A11Y_EVIDENCE_STRICT=false
`);
}

function normalizeEnvironment(value) {
  const normalized = String(value || 'staging')
    .trim()
    .toLowerCase();
  if (normalized === 'prod') return 'production';
  if (normalized === 'stage') return 'staging';
  return normalized || 'staging';
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseList(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return [...fallback];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toPosix(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function normalizeSpecPath(value) {
  const file = toPosix(value);
  if (!file) return '';
  return file.startsWith('e2e/') ? file : `e2e/${file}`;
}

function isLocalTarget(target) {
  try {
    const hostname = new URL(target).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      hostname === 'host.docker.internal' ||
      hostname.endsWith('.local')
    );
  } catch {
    return true;
  }
}

function readJson(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Playwright JSON report is missing: ${filePath}`);
  }
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function statusFromTest(test) {
  const status = String(test?.status || '').trim();
  const results = Array.isArray(test?.results) ? test.results : [];
  if (['passed', 'failed', 'timedOut', 'interrupted', 'skipped'].includes(status)) return status;
  if (status === 'unexpected' || status === 'flaky') return 'failed';
  if (status === 'expected' && String(test?.expectedStatus || '') === 'skipped') return 'skipped';
  if (status === 'expected' && results.some((result) => result?.status === 'passed')) {
    return 'passed';
  }
  if (results.some((result) => ['failed', 'timedOut', 'interrupted'].includes(result?.status))) {
    return 'failed';
  }
  if (results.some((result) => result?.status === 'passed')) return 'passed';
  if (results.some((result) => result?.status === 'skipped')) return 'skipped';
  return 'unknown';
}

function collectPlaywrightTests(report) {
  const tests = [];

  function visit(node, context) {
    if (!node || typeof node !== 'object') return;
    const nextContext = {
      file: toPosix(node.file || context.file),
      titleParts: [...context.titleParts],
      projectName: node.projectName || context.projectName,
    };

    if (typeof node.title === 'string' && node.title.trim()) {
      nextContext.titleParts.push(node.title.trim());
    }

    for (const suite of Array.isArray(node.suites) ? node.suites : []) {
      visit(suite, nextContext);
    }

    for (const spec of Array.isArray(node.specs) ? node.specs : []) {
      visit(spec, nextContext);
    }

    for (const test of Array.isArray(node.tests) ? node.tests : []) {
      const titleParts = [...nextContext.titleParts];
      if (typeof test.title === 'string' && test.title.trim()) {
        titleParts.push(test.title.trim());
      }
      tests.push({
        title: titleParts.join(' > '),
        file: toPosix(test.file || nextContext.file),
        projectName: String(
          test.projectName || test.projectId || nextContext.projectName || '',
        ).trim(),
        status: statusFromTest(test),
      });
    }
  }

  visit(report, { file: '', titleParts: [], projectName: '' });
  return tests;
}

function summarizeTests(tests) {
  const summary = { passed: 0, failed: 0, skipped: 0, unknown: 0 };
  for (const test of tests) {
    if (test.status === 'passed') summary.passed += 1;
    else if (test.status === 'skipped') summary.skipped += 1;
    else if (
      test.status === 'failed' ||
      test.status === 'timedOut' ||
      test.status === 'interrupted'
    ) {
      summary.failed += 1;
    } else {
      summary.unknown += 1;
    }
  }
  return summary;
}

function summarizeControls(tests) {
  const bySpec = new Map();
  for (const spec of DEFAULT_SPECS) {
    bySpec.set(spec, { passed: 0, failed: 0, skipped: 0, unknown: 0 });
  }
  for (const test of tests) {
    const spec = normalizeSpecPath(test.file);
    const bucket = bySpec.get(spec);
    if (!bucket) continue;
    if (test.status === 'passed') bucket.passed += 1;
    else if (test.status === 'skipped') bucket.skipped += 1;
    else if (
      test.status === 'failed' ||
      test.status === 'timedOut' ||
      test.status === 'interrupted'
    ) {
      bucket.failed += 1;
    } else {
      bucket.unknown += 1;
    }
  }

  return {
    axeCriticalSerious: statusFromSummary(bySpec.get('e2e/a11y/axe.spec.ts')),
    colorContrast: statusFromSummary(bySpec.get('e2e/a11y/color-contrast.spec.ts')),
    keyboardNavigation: statusFromSummary(bySpec.get('e2e/a11y/keyboard-nav.spec.ts')),
  };
}

function statusFromSummary(summary = {}) {
  const passed = Number(summary.passed || 0);
  const failed = Number(summary.failed || 0);
  const skipped = Number(summary.skipped || 0);
  const unknown = Number(summary.unknown || 0);
  return {
    passed,
    failed,
    skipped,
    unknown,
    ok: passed > 0 && failed === 0 && skipped === 0 && unknown === 0,
  };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

function buildPlaywrightRun(root, options) {
  const reportPath = path.resolve(root, options.reportPath);
  const env = {
    ...process.env,
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
    BIDSTACK_A11Y_PLAYWRIGHT_JSON_REPORT: reportPath,
  };

  if (options.target) {
    env.E2E_BASE_URL = options.target;
  }
  if (options.authMode) {
    env.E2E_AUTH_MODE = options.authMode;
    env.VITE_AUTH_MODE = options.authMode;
  }

  const args = [
    '--filter',
    '@bidstack/web',
    'exec',
    'playwright',
    'test',
    ...options.specs,
    ...options.projects.flatMap((project) => ['--project', project]),
    '--reporter=json',
  ];

  return {
    command: PNPM_COMMAND,
    args,
    cwd: root,
    env,
    reportPath,
    label: commandLabel(PNPM_COMMAND, args),
  };
}

function tail(text, maxLines = 80) {
  return String(text || '')
    .split(/\r?\n/)
    .slice(-maxLines)
    .join('\n');
}

function runPlaywrightReport(options) {
  const run = buildPlaywrightRun(process.cwd(), options);
  mkdirSync(path.dirname(run.reportPath), { recursive: true });
  rmSync(run.reportPath, { force: true });

  process.stdout.write(`Running accessibility evidence: ${run.label}\n`);
  const result = spawnSync(run.command, run.args, {
    cwd: run.cwd,
    env: run.env,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    shell: process.platform === 'win32',
  });

  if (result.error) {
    process.stderr.write(`Playwright failed to start: ${result.error.message}\n`);
    options.playwrightCommand = run.label;
    return 1;
  }

  if (result.status !== 0) {
    process.stderr.write(tail(result.stdout));
    process.stderr.write(tail(result.stderr));
  } else {
    process.stdout.write('Accessibility Playwright run completed\n');
  }

  options.playwrightCommand = run.label;
  return result.status ?? 1;
}

function buildArtifact(options, report) {
  const tests = collectPlaywrightTests(report);
  const projects = unique(tests.map((test) => test.projectName));
  const specs = unique(
    tests.map((test) => normalizeSpecPath(test.file)).filter((file) => file.endsWith('.spec.ts')),
  );
  const testCounts = summarizeTests(tests);
  const controls = summarizeControls(tests);
  const commandExitCode = Number.isFinite(options.commandExitCode) ? options.commandExitCode : 1;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: 'a11y-evidence',
    environment: options.deployEnv,
    profile: options.profile,
    target: options.target,
    productionBuild: options.productionBuild,
    clerkBackedAuth: String(options.authMode).toLowerCase() === 'clerk',
    authMode: String(options.authMode || '').toLowerCase() || null,
    commandExitCode,
    passed:
      commandExitCode === 0 &&
      testCounts.failed === 0 &&
      testCounts.skipped === 0 &&
      testCounts.unknown === 0 &&
      testCounts.passed > 0 &&
      Object.values(controls).every((control) => control.ok === true),
    projects,
    specs,
    tests: testCounts,
    controls,
    sourceReport: path.relative(process.cwd(), path.resolve(process.cwd(), options.reportPath)),
    playwrightCommand: options.playwrightCommand ?? null,
  };
}

function buildUnavailableReportArtifact(options, reportError) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: 'a11y-evidence',
    environment: options.deployEnv,
    profile: options.profile,
    target: options.target,
    productionBuild: options.productionBuild,
    clerkBackedAuth: String(options.authMode).toLowerCase() === 'clerk',
    authMode: String(options.authMode || '').toLowerCase() || null,
    commandExitCode: Number.isFinite(options.commandExitCode) ? options.commandExitCode : 1,
    passed: false,
    projects: [],
    specs: [],
    tests: { passed: 0, failed: 0, skipped: 0, unknown: 1 },
    controls: {
      axeCriticalSerious: { passed: 0, failed: 0, skipped: 0, unknown: 1, ok: false },
      colorContrast: { passed: 0, failed: 0, skipped: 0, unknown: 1, ok: false },
      keyboardNavigation: { passed: 0, failed: 0, skipped: 0, unknown: 1, ok: false },
    },
    sourceReport: path.relative(process.cwd(), path.resolve(process.cwd(), options.reportPath)),
    playwrightCommand: options.playwrightCommand ?? null,
    reportReadError: reportError,
  };
}

function missingValues(actual, expected) {
  const actualSet = new Set(actual.map(toPosix));
  return expected.filter((value) => !actualSet.has(toPosix(value)));
}

function validateArtifact(artifact, options) {
  const failures = [];
  if (!ACCEPTED_PROFILES.has(artifact.profile)) {
    failures.push(`profile must be one of ${Array.from(ACCEPTED_PROFILES).join(', ')}`);
  }
  if (artifact.commandExitCode !== 0)
    failures.push(`command exit code is ${artifact.commandExitCode}`);
  if (!artifact.passed) failures.push('accessibility evidence did not pass cleanly');
  if (options.strict && isLocalTarget(artifact.target))
    failures.push(`target is local or invalid: ${artifact.target || 'missing'}`);
  if (options.strict && artifact.productionBuild !== true)
    failures.push('productionBuild must be true');
  if (options.strict && artifact.clerkBackedAuth !== true)
    failures.push('Clerk-backed auth is required');

  const missingProjects = missingValues(artifact.projects, DEFAULT_PROJECTS);
  if (missingProjects.length > 0) failures.push(`missing projects: ${missingProjects.join(', ')}`);
  const missingSpecs = missingValues(artifact.specs, DEFAULT_SPECS);
  if (missingSpecs.length > 0) failures.push(`missing specs: ${missingSpecs.join(', ')}`);
  if (
    artifact.tests.failed !== 0 ||
    artifact.tests.skipped !== 0 ||
    artifact.tests.unknown !== 0 ||
    artifact.tests.passed <= 0
  ) {
    failures.push(
      `test counts are not clean: passed=${artifact.tests.passed} failed=${artifact.tests.failed} skipped=${artifact.tests.skipped} unknown=${artifact.tests.unknown}`,
    );
  }
  for (const [id, control] of Object.entries(artifact.controls || {})) {
    if (control?.ok !== true) {
      failures.push(`control ${id} did not pass cleanly`);
    }
  }
  return failures;
}

function writeArtifact(outputPath, artifact) {
  const absolutePath = path.resolve(process.cwd(), outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return absolutePath;
}

function runWriter(options) {
  if (options.runPlaywright) {
    options.commandExitCode = runPlaywrightReport(options);
  }

  let artifact;
  let readFailure = '';
  try {
    artifact = buildArtifact(options, readJson(options.reportPath));
  } catch (error) {
    readFailure = error.message;
    artifact = buildUnavailableReportArtifact(options, readFailure);
  }
  const failures = [...(readFailure ? [readFailure] : []), ...validateArtifact(artifact, options)];
  artifact.validationFailures = [...new Set(failures)];
  const absolutePath = writeArtifact(options.outputPath, artifact);

  process.stdout.write(`Accessibility evidence: ${path.relative(process.cwd(), absolutePath)}\n`);
  process.stdout.write(`Projects: ${artifact.projects.join(', ') || 'none'}\n`);
  process.stdout.write(`Specs: ${artifact.specs.join(', ') || 'none'}\n`);

  if (artifact.validationFailures.length > 0) {
    for (const failure of artifact.validationFailures) {
      process.stderr.write(`FAIL ${failure}\n`);
    }
    return 1;
  }

  process.stdout.write('Accessibility evidence passed\n');
  return 0;
}

function writeJson(root, relativePath, value) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function testEntry(projectName, title, file, status = 'passed') {
  return { projectName, title, file, status, results: [{ status }] };
}

function createPlaywrightReport({ omitKeyboard = false, skippedContrast = false } = {}) {
  const specs = [
    {
      title: 'a11y/axe.spec.ts',
      file: 'e2e/a11y/axe.spec.ts',
      tests: DEFAULT_PROJECTS.map((project) =>
        testEntry(project, 'dashboard: 0 critical/serious axe violations', 'e2e/a11y/axe.spec.ts'),
      ),
    },
    {
      title: 'a11y/color-contrast.spec.ts',
      file: 'e2e/a11y/color-contrast.spec.ts',
      tests: DEFAULT_PROJECTS.map((project) =>
        testEntry(
          project,
          '/dashboard (dark): color-contrast axe rule passes',
          'e2e/a11y/color-contrast.spec.ts',
          skippedContrast ? 'skipped' : 'passed',
        ),
      ),
    },
    ...(omitKeyboard
      ? []
      : [
          {
            title: 'a11y/keyboard-nav.spec.ts',
            file: 'e2e/a11y/keyboard-nav.spec.ts',
            tests: DEFAULT_PROJECTS.map((project) =>
              testEntry(
                project,
                '/dashboard: tab order is logical and no focus trap exists',
                'e2e/a11y/keyboard-nav.spec.ts',
              ),
            ),
          },
        ]),
  ];

  return {
    suites: [
      {
        title: 'a11y',
        suites: specs.map((spec) => ({
          title: spec.title,
          file: spec.file,
          specs: [
            {
              title: spec.title,
              file: spec.file,
              tests: spec.tests,
            },
          ],
        })),
      },
    ],
  };
}

function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidcrm-a11y-evidence-'));
  const cwd = process.cwd();
  try {
    process.chdir(root);
    writeJson(root, DEFAULT_REPORT_PATH, createPlaywrightReport());
    const good = runWriter({
      reportPath: DEFAULT_REPORT_PATH,
      outputPath: DEFAULT_OUTPUT_PATH,
      deployEnv: 'staging',
      target: 'https://staging.bidstack.example',
      authMode: 'clerk',
      productionBuild: true,
      commandExitCode: 0,
      profile: 'wcag-keyboard-regression',
      strict: true,
    });
    assert.equal(good, 0, 'expected clean a11y fixture to pass');

    writeJson(root, DEFAULT_REPORT_PATH, createPlaywrightReport({ omitKeyboard: true }));
    const missingKeyboard = runWriter({
      reportPath: DEFAULT_REPORT_PATH,
      outputPath: DEFAULT_OUTPUT_PATH,
      deployEnv: 'staging',
      target: 'https://staging.bidstack.example',
      authMode: 'clerk',
      productionBuild: true,
      commandExitCode: 0,
      profile: 'wcag-keyboard-regression',
      strict: true,
    });
    assert.notEqual(missingKeyboard, 0, 'expected missing keyboard spec to fail');

    writeJson(root, DEFAULT_REPORT_PATH, createPlaywrightReport({ skippedContrast: true }));
    const skippedContrast = runWriter({
      reportPath: DEFAULT_REPORT_PATH,
      outputPath: DEFAULT_OUTPUT_PATH,
      deployEnv: 'staging',
      target: 'https://staging.bidstack.example',
      authMode: 'clerk',
      productionBuild: true,
      commandExitCode: 0,
      profile: 'wcag-keyboard-regression',
      strict: true,
    });
    assert.notEqual(skippedContrast, 0, 'expected skipped contrast control to fail');

    writeJson(root, DEFAULT_REPORT_PATH, createPlaywrightReport());
    const localStub = runWriter({
      reportPath: DEFAULT_REPORT_PATH,
      outputPath: DEFAULT_OUTPUT_PATH,
      deployEnv: 'staging',
      target: 'http://127.0.0.1:4174',
      authMode: 'stub',
      productionBuild: true,
      commandExitCode: 0,
      profile: 'wcag-keyboard-regression',
      strict: true,
    });
    assert.notEqual(localStub, 0, 'expected local stub-auth target to fail strict evidence');

    const playwrightRun = buildPlaywrightRun(root, {
      reportPath: DEFAULT_REPORT_PATH,
      target: 'https://staging.bidstack.example',
      authMode: 'clerk',
      specs: DEFAULT_SPECS,
      projects: DEFAULT_PROJECTS,
    });
    assert.equal(playwrightRun.env.E2E_BASE_URL, 'https://staging.bidstack.example');
    assert.equal(playwrightRun.env.E2E_AUTH_MODE, 'clerk');
    assert.equal(playwrightRun.env.VITE_AUTH_MODE, 'clerk');
    assert.equal(
      playwrightRun.env.PLAYWRIGHT_JSON_OUTPUT_NAME,
      path.join(root, DEFAULT_REPORT_PATH),
    );
    assert.deepEqual(
      playwrightRun.args.filter((arg, index, args) => args[index - 1] === '--project'),
      DEFAULT_PROJECTS,
    );
    assert.equal(playwrightRun.args.includes('e2e/a11y/axe.spec.ts'), true);
    assert.equal(playwrightRun.args.includes('e2e/a11y/color-contrast.spec.ts'), true);
    assert.equal(playwrightRun.args.includes('e2e/a11y/keyboard-nav.spec.ts'), true);

    process.stdout.write('accessibility evidence selftest passed\n');
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    runSelftest();
  } else {
    process.exit(runWriter(args));
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
