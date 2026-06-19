#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STRICT_DEPLOY_ENVS = new Set(['staging', 'production']);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = resolve(repoRoot, 'scripts/load-test.js');
const scriptsDir = resolve(repoRoot, 'scripts');
const reportDir = resolve(repoRoot, process.env.K6_REPORT_DIR ?? 'load-test-report');
const rawSummaryPath = resolve(reportDir, 'k6-summary-latest.json');
const certificationPath = resolve(reportDir, 'production-load-latest.json');
const dockerImage = process.env.K6_DOCKER_IMAGE ?? 'grafana/k6:2.0.0';
const profile = process.env.K6_DURATION_PROFILE ?? 'full';
const deployEnv = normalizeDeployEnv(process.env.BIDSTACK_DEPLOY_ENV || '');
const strictEvidence =
  parseOptionalBoolean(process.env.BIDSTACK_LOAD_EVIDENCE_STRICT) ??
  STRICT_DEPLOY_ENVS.has(deployEnv);
const requestedApiBaseUrl = process.env.API_BASE_URL ?? (strictEvidence ? '' : 'http://localhost:4000');
const guardApiBaseUrl = process.env.K6_DOCKER_API_BASE_URL ?? requestedApiBaseUrl;

if (!existsSync(scriptPath)) {
  console.error(`Missing k6 script: ${scriptPath}`);
  process.exit(1);
}

if (process.argv.includes('--selftest')) {
  runSelftest();
  process.exit(0);
}

function commandWorks(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore', shell: false });
  return result.status === 0;
}

function normalizeDockerVolumePath(path) {
  return process.platform === 'win32' ? path.replace(/\\/g, '/') : path;
}

function redactUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

function normalizeDeployEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'prod') return 'production';
  if (normalized === 'stage') return 'staging';
  return normalized;
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseApiTarget(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function isLocalApiTarget(raw) {
  const url = parseApiTarget(raw);
  if (!url) return true;
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal'].includes(
    url.hostname.toLowerCase(),
  );
}

function validateLoadTarget(options) {
  const skipAuthenticatedRoutes = options.skipAuthenticatedRoutes === true;
  const hasToken = String(options.apiToken || '').trim().length > 0;
  const target = String(options.guardApiBaseUrl || options.requestedApiBaseUrl || '');
  const normalizedDeployEnv = normalizeDeployEnv(options.deployEnv || '');
  const parsedTarget = parseApiTarget(target);
  const isLocalTarget = isLocalApiTarget(target);
  const failures = [];

  if (options.strictEvidence) {
    if (!STRICT_DEPLOY_ENVS.has(normalizedDeployEnv)) {
      failures.push(
        `Strict load evidence requires BIDSTACK_DEPLOY_ENV=staging or production; got ${normalizedDeployEnv || 'missing'}.`,
      );
    }
    if (options.profile !== 'certification') {
      failures.push(
        `Strict load evidence requires K6_DURATION_PROFILE=certification; got ${options.profile || 'missing'}.`,
      );
    }
    if (!parsedTarget) {
      failures.push(
        `Strict load evidence requires an absolute http(s) API target; got ${redactUrl(target)}.`,
      );
    } else if (isLocalTarget) {
      failures.push(
        `Strict load evidence cannot target a local API; got ${redactUrl(target)}.`,
      );
    }
    if (!hasToken) {
      failures.push('Strict load evidence requires API_TOKEN for authenticated routes.');
    }
  }

  if (options.profile === 'certification' && skipAuthenticatedRoutes) {
    failures.push(
      [
        'Certification profile cannot run with SKIP_AUTHENTICATED_ROUTES=true.',
        'Use the smoke profile for health-only checks, or provide API_TOKEN for authenticated routes.',
      ].join(' '),
    );
  }

  if (!isLocalTarget && !hasToken && !skipAuthenticatedRoutes) {
    failures.push(
      [
        'Non-local load tests must provide API_TOKEN or explicitly set SKIP_AUTHENTICATED_ROUTES=true.',
        'This prevents a production/staging run from accidentally proving only public unauthenticated behavior.',
        `Target: ${redactUrl(target)}`,
      ].join(' '),
    );
  }

  return failures;
}

function assertLoadTargetIsHonest() {
  const failures = validateLoadTarget({
    profile,
    requestedApiBaseUrl,
    guardApiBaseUrl,
    deployEnv,
    apiToken: process.env.API_TOKEN,
    skipAuthenticatedRoutes: process.env.SKIP_AUTHENTICATED_ROUTES === 'true',
    strictEvidence,
  });

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    mkdirSync(reportDir, { recursive: true });
    writeCertificationSummary(1, 'preflight', { validationFailures: failures });
    process.exit(1);
  }
}

function dockerApiBaseUrl() {
  if (process.env.K6_DOCKER_API_BASE_URL) return process.env.K6_DOCKER_API_BASE_URL;

  const raw = requestedApiBaseUrl;
  try {
    const url = new URL(raw);
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      url.hostname = 'host.docker.internal';
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    // Let k6 surface the invalid URL; this wrapper should not hide script errors.
  }
  return raw;
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function metricValue(data, metricName, valueName) {
  const metric = data?.metrics?.[metricName];
  const value = (metric?.values ?? metric)?.[valueName];
  return typeof value === 'number' ? value : null;
}

function rateMetricValue(data, metricName) {
  return metricValue(data, metricName, 'rate') ?? metricValue(data, metricName, 'value');
}

function evaluateThreshold(metricDefinition, expression) {
  const match = /^(?<selector>[a-z0-9_()]+)\s*(?<operator><=|>=|<|>)\s*(?<expected>[0-9.]+)$/i.exec(
    expression,
  );
  if (!match?.groups) return { actual: null, expected: null, ok: null };

  const { selector, operator } = match.groups;
  const expected = Number(match.groups.expected);
  const metricValues = metricDefinition?.values ?? metricDefinition;
  const actual = metricValues?.[selector] ?? (selector === 'rate' ? metricValues?.value : undefined);

  if (typeof actual !== 'number' || !Number.isFinite(expected)) {
    return { actual: null, expected: Number.isFinite(expected) ? expected : null, ok: null };
  }

  const ok =
    operator === '<'
      ? actual < expected
      : operator === '<='
        ? actual <= expected
        : operator === '>'
          ? actual > expected
          : actual >= expected;

  return { actual, expected, ok };
}

function collectThresholds(data) {
  return Object.entries(data?.metrics ?? {}).flatMap(([metric, definition]) =>
    Object.entries(definition?.thresholds ?? {}).map(([expression, rawResult]) => {
      const evaluation = evaluateThreshold(definition, expression);
      return {
        metric,
        expression,
        actual: evaluation.actual,
        expected: evaluation.expected,
        ok: evaluation.ok ?? (typeof rawResult === 'boolean' ? null : Boolean(rawResult?.ok)),
      };
    }),
  );
}

function buildCertificationSummary(exitCode, runner, options = {}) {
  const validationFailures = Array.isArray(options.validationFailures)
    ? options.validationFailures
    : [];
  const rawSummaryFound = validationFailures.length === 0 && existsSync(rawSummaryPath);
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner,
    dockerImage: runner === 'docker' ? dockerImage : null,
    profile,
    environment: deployEnv || null,
    strictEvidence,
    target: redactUrl(requestedApiBaseUrl),
    authenticatedRoutes: process.env.SKIP_AUTHENTICATED_ROUTES !== 'true',
    commandExitCode: exitCode,
    rawSummaryPath,
    rawSummaryFound,
    passed: exitCode === 0,
    validationFailures,
    thresholds: [],
    metrics: {},
  };

  if (rawSummaryFound) {
    try {
      const data = JSON.parse(readFileSync(rawSummaryPath, 'utf8'));
      const thresholds = collectThresholds(data);
      summary.thresholds = thresholds;
      summary.passed =
        exitCode === 0 && (thresholds.length === 0 || thresholds.every((threshold) => threshold.ok));
      summary.metrics = {
        httpReqDurationP95Ms: metricValue(data, 'http_req_duration', 'p(95)'),
        httpReqDurationP99Ms: metricValue(data, 'http_req_duration', 'p(99)'),
        httpReqDurationAvgMs: metricValue(data, 'http_req_duration', 'avg'),
        httpReqFailedRate: rateMetricValue(data, 'http_req_failed'),
        checksRate: rateMetricValue(data, 'checks'),
        checksPassed: metricValue(data, 'checks', 'passes'),
        checksFailed: metricValue(data, 'checks', 'fails'),
        iterations: metricValue(data, 'iterations', 'count'),
        httpRequests: metricValue(data, 'http_reqs', 'count'),
        vusMax: metricValue(data, 'vus_max', 'max'),
      };
    } catch (error) {
      summary.parseError = error instanceof Error ? error.message : String(error);
      summary.passed = false;
    }
  }

  return summary;
}

function writeCertificationSummary(exitCode, runner, options = {}) {
  const summary = buildCertificationSummary(exitCode, runner, options);
  writeFileSync(certificationPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.warn(`\n[load-test] Certification artifact: ${certificationPath}`);
}

function runSelftest() {
  assert.deepEqual(
    validateLoadTarget({
      profile: 'certification',
      requestedApiBaseUrl: 'https://staging-api.bidstack.example',
      guardApiBaseUrl: 'https://staging-api.bidstack.example',
      deployEnv: 'staging',
      apiToken: 'token-123',
      skipAuthenticatedRoutes: false,
      strictEvidence: true,
    }),
    [],
    'expected strict non-local authenticated certification to pass preflight',
  );

  assert.match(
    validateLoadTarget({
      profile: 'smoke',
      requestedApiBaseUrl: 'https://staging-api.bidstack.example',
      guardApiBaseUrl: 'https://staging-api.bidstack.example',
      deployEnv: 'staging',
      apiToken: 'token-123',
      skipAuthenticatedRoutes: false,
      strictEvidence: true,
    }).join('\n'),
    /certification/,
    'expected strict evidence to require certification profile',
  );

  assert.match(
    validateLoadTarget({
      profile: 'certification',
      requestedApiBaseUrl: 'http://127.0.0.1:4000',
      guardApiBaseUrl: 'http://127.0.0.1:4000',
      deployEnv: 'staging',
      apiToken: 'token-123',
      skipAuthenticatedRoutes: false,
      strictEvidence: true,
    }).join('\n'),
    /local API/,
    'expected strict evidence to reject local targets',
  );

  assert.match(
    validateLoadTarget({
      profile: 'certification',
      requestedApiBaseUrl: 'https://staging-api.bidstack.example',
      guardApiBaseUrl: 'https://staging-api.bidstack.example',
      deployEnv: 'staging',
      apiToken: '',
      skipAuthenticatedRoutes: false,
      strictEvidence: true,
    }).join('\n'),
    /API_TOKEN/,
    'expected strict evidence to require a bearer token',
  );

  assert.match(
    validateLoadTarget({
      profile: 'certification',
      requestedApiBaseUrl: 'https://staging-api.bidstack.example',
      guardApiBaseUrl: 'https://staging-api.bidstack.example',
      deployEnv: 'staging',
      apiToken: 'token-123',
      skipAuthenticatedRoutes: true,
      strictEvidence: true,
    }).join('\n'),
    /SKIP_AUTHENTICATED_ROUTES/,
    'expected certification to reject health-only mode',
  );

  assert.deepEqual(
    validateLoadTarget({
      profile: 'smoke',
      requestedApiBaseUrl: 'http://127.0.0.1:4000',
      guardApiBaseUrl: 'http://host.docker.internal:4000',
      deployEnv: '',
      apiToken: '',
      skipAuthenticatedRoutes: false,
      strictEvidence: false,
    }),
    [],
    'expected local smoke/dev-stub runs to remain available',
  );

  assert.match(
    validateLoadTarget({
      profile: 'certification',
      requestedApiBaseUrl: 'https://staging-api.bidstack.example',
      guardApiBaseUrl: 'https://staging-api.bidstack.example',
      deployEnv: '',
      apiToken: 'token-123',
      skipAuthenticatedRoutes: false,
      strictEvidence: true,
    }).join('\n'),
    /BIDSTACK_DEPLOY_ENV/,
    'expected strict evidence to require an explicit deploy environment',
  );

  assert.match(
    validateLoadTarget({
      profile: 'certification',
      requestedApiBaseUrl: '',
      guardApiBaseUrl: '',
      deployEnv: 'production',
      apiToken: 'token-123',
      skipAuthenticatedRoutes: false,
      strictEvidence: true,
    }).join('\n'),
    /absolute http\(s\) API target/,
    'expected strict evidence to require a configured API target instead of falling back to local dev',
  );

  const redPreflightSummary = buildCertificationSummary(1, 'preflight', {
    validationFailures: ['Strict load evidence requires API_TOKEN for authenticated routes.'],
  });
  assert.equal(redPreflightSummary.runner, 'preflight');
  assert.equal(redPreflightSummary.strictEvidence, strictEvidence);
  assert.equal(redPreflightSummary.profile, profile);
  assert.equal(redPreflightSummary.passed, false);
  assert.equal(redPreflightSummary.rawSummaryFound, false);
  assert.deepEqual(redPreflightSummary.thresholds, []);
  assert.deepEqual(redPreflightSummary.validationFailures, [
    'Strict load evidence requires API_TOKEN for authenticated routes.',
  ]);

  process.stdout.write('k6 load evidence selftest passed\n');
}

assertLoadTargetIsHonest();
mkdirSync(reportDir, { recursive: true });

if (commandWorks('k6', ['version'])) {
  const status = run('k6', ['run', '--summary-export', rawSummaryPath, scriptPath]);
  writeCertificationSummary(status, 'local');
  process.exit(status);
}

if (!commandWorks('docker', ['version', '--format', '{{.Server.Version}}'])) {
  console.error(
    [
      'k6 is not installed and Docker is not available.',
      'Install k6, start Docker, or set K6_DOCKER_IMAGE to a reachable Grafana k6 image.',
      `Script: ${pathToFileURL(scriptPath).href}`,
      `Certification artifact: ${certificationPath}`,
    ].join('\n'),
  );
  writeCertificationSummary(1, 'unavailable');
  process.exit(1);
}

const dockerEnvKeys = [
  'API_TOKEN',
  'BIDSTACK_LOAD_ROLE',
  'SKIP_AUTHENTICATED_ROUTES',
  'K6_DURATION_PROFILE',
  'K6_P95_MS',
  'K6_FAILURE_RATE',
  'K6_CHECK_RATE',
];
const dockerArgs = [
  'run',
  '--rm',
  '-i',
  '-e',
  `API_BASE_URL=${dockerApiBaseUrl()}`,
  ...dockerEnvKeys.flatMap((key) =>
    process.env[key] === undefined ? [] : ['-e', `${key}=${process.env[key]}`],
  ),
  '-v',
  `${normalizeDockerVolumePath(scriptsDir)}:/scripts:ro`,
  '-v',
  `${normalizeDockerVolumePath(reportDir)}:/reports`,
  dockerImage,
  'run',
  '--summary-export',
  '/reports/k6-summary-latest.json',
  '/scripts/load-test.js',
];

const status = run('docker', dockerArgs);
writeCertificationSummary(status, 'docker');
process.exit(status);
