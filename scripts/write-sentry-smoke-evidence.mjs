#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/sentry-smoke-latest.json';
const DEFAULT_PERIOD = '24h';
const DEFAULT_LIMIT = 25;
const DEFAULT_API_MARKER = 'bidstack-api-sentry-smoke';
const DEFAULT_WORKER_MARKER = 'bidstack-worker-sentry-smoke';
const DEFAULT_TRIGGER_TIMEOUT_MS = 15_000;
const DEFAULT_OBSERVE_DELAY_MS = 15_000;
const PLACEHOLDER_EXACT_VALUES = new Set([
  'abc123',
  'change-me',
  'changeme',
  'dummy',
  'example',
  'fake',
  'release-token',
  'sample',
  'todo',
]);
const PLACEHOLDER_VALUE_PATTERNS = [
  /<[^>]+>/,
  /\bexample\b/,
  /\bplaceholder\b/,
  /\breplace[-_ ]?me\b/,
  /\bsample\b/,
  /\byour[-_ ]/,
];

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_SENTRY_EVIDENCE_PATH || DEFAULT_OUTPUT_PATH,
    environment: normalizeEnvironment(process.env.BIDSTACK_DEPLOY_ENV || process.env.SENTRY_ENVIRONMENT || 'staging'),
    release: process.env.BIDSTACK_SENTRY_RELEASE || process.env.SENTRY_RELEASE || process.env.VITE_SENTRY_RELEASE || '',
    org: process.env.BIDSTACK_SENTRY_ORG || process.env.SENTRY_ORG || '',
    apiProject: process.env.BIDSTACK_SENTRY_API_PROJECT || '',
    workerProject: process.env.BIDSTACK_SENTRY_WORKER_PROJECT || '',
    apiTarget: process.env.BIDSTACK_SENTRY_API_TARGET || '',
    workerTarget: process.env.BIDSTACK_SENTRY_WORKER_TARGET || '',
    apiBaseUrl: process.env.BIDSTACK_SENTRY_API_BASE_URL || process.env.API_BASE_URL || '',
    smokeToken: process.env.BIDSTACK_SENTRY_SMOKE_TOKEN || process.env.SENTRY_SMOKE_TOKEN || '',
    apiQuery: process.env.BIDSTACK_SENTRY_API_QUERY || '',
    workerQuery: process.env.BIDSTACK_SENTRY_WORKER_QUERY || '',
    apiMarker: process.env.BIDSTACK_SENTRY_API_MARKER || DEFAULT_API_MARKER,
    workerMarker: process.env.BIDSTACK_SENTRY_WORKER_MARKER || DEFAULT_WORKER_MARKER,
    period: process.env.BIDSTACK_SENTRY_PERIOD || DEFAULT_PERIOD,
    limit: parseOptionalInteger(process.env.BIDSTACK_SENTRY_LIMIT) ?? DEFAULT_LIMIT,
    triggerSmoke: parseOptionalBoolean(process.env.BIDSTACK_SENTRY_TRIGGER_SMOKE) ?? false,
    triggerTimeoutMs:
      parseOptionalNonNegativeInteger(process.env.BIDSTACK_SENTRY_TRIGGER_TIMEOUT_MS) ??
      DEFAULT_TRIGGER_TIMEOUT_MS,
    observeDelayMs:
      parseOptionalNonNegativeInteger(process.env.BIDSTACK_SENTRY_OBSERVE_DELAY_MS) ??
      DEFAULT_OBSERVE_DELAY_MS,
    dsnConfigured:
      parseOptionalBoolean(process.env.BIDSTACK_SENTRY_DSN_CONFIGURED) ??
      Boolean(process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN),
    sendDefaultPii: parseOptionalBoolean(process.env.BIDSTACK_SENTRY_SEND_DEFAULT_PII) ?? false,
    sessionReplayEnabled:
      parseOptionalBoolean(process.env.BIDSTACK_SENTRY_SESSION_REPLAY_ENABLED) ??
      process.env.VITE_SENTRY_REPLAY === 'true',
    legalApproval:
      parseOptionalBoolean(process.env.BIDSTACK_SENTRY_LEGAL_APPROVAL) ??
      parseOptionalBoolean(process.env.BIDSTACK_SESSION_REPLAY_APPROVED) ??
      false,
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      parsed.root = argv[index + 1] ?? parsed.root;
      index += 1;
    } else if (arg.startsWith('--root=')) {
      parsed.root = arg.slice('--root='.length);
    } else if (arg === '--out') {
      parsed.outputPath = argv[index + 1] ?? parsed.outputPath;
      index += 1;
    } else if (arg.startsWith('--out=')) {
      parsed.outputPath = arg.slice('--out='.length);
    } else if (arg === '--env') {
      parsed.environment = normalizeEnvironment(argv[index + 1] ?? parsed.environment);
      index += 1;
    } else if (arg.startsWith('--env=')) {
      parsed.environment = normalizeEnvironment(arg.slice('--env='.length));
    } else if (arg === '--release') {
      parsed.release = argv[index + 1] ?? parsed.release;
      index += 1;
    } else if (arg.startsWith('--release=')) {
      parsed.release = arg.slice('--release='.length);
    } else if (arg === '--org') {
      parsed.org = argv[index + 1] ?? parsed.org;
      index += 1;
    } else if (arg.startsWith('--org=')) {
      parsed.org = arg.slice('--org='.length);
    } else if (arg === '--api-project') {
      parsed.apiProject = argv[index + 1] ?? parsed.apiProject;
      index += 1;
    } else if (arg.startsWith('--api-project=')) {
      parsed.apiProject = arg.slice('--api-project='.length);
    } else if (arg === '--worker-project') {
      parsed.workerProject = argv[index + 1] ?? parsed.workerProject;
      index += 1;
    } else if (arg.startsWith('--worker-project=')) {
      parsed.workerProject = arg.slice('--worker-project='.length);
    } else if (arg === '--api-target') {
      parsed.apiTarget = argv[index + 1] ?? parsed.apiTarget;
      index += 1;
    } else if (arg.startsWith('--api-target=')) {
      parsed.apiTarget = arg.slice('--api-target='.length);
    } else if (arg === '--worker-target') {
      parsed.workerTarget = argv[index + 1] ?? parsed.workerTarget;
      index += 1;
    } else if (arg.startsWith('--worker-target=')) {
      parsed.workerTarget = arg.slice('--worker-target='.length);
    } else if (arg === '--api-base-url') {
      parsed.apiBaseUrl = argv[index + 1] ?? parsed.apiBaseUrl;
      index += 1;
    } else if (arg.startsWith('--api-base-url=')) {
      parsed.apiBaseUrl = arg.slice('--api-base-url='.length);
    } else if (arg === '--smoke-token') {
      parsed.smokeToken = argv[index + 1] ?? parsed.smokeToken;
      index += 1;
    } else if (arg.startsWith('--smoke-token=')) {
      parsed.smokeToken = arg.slice('--smoke-token='.length);
    } else if (arg === '--api-marker') {
      parsed.apiMarker = argv[index + 1] ?? parsed.apiMarker;
      index += 1;
    } else if (arg.startsWith('--api-marker=')) {
      parsed.apiMarker = arg.slice('--api-marker='.length);
    } else if (arg === '--worker-marker') {
      parsed.workerMarker = argv[index + 1] ?? parsed.workerMarker;
      index += 1;
    } else if (arg.startsWith('--worker-marker=')) {
      parsed.workerMarker = arg.slice('--worker-marker='.length);
    } else if (arg === '--api-query') {
      parsed.apiQuery = argv[index + 1] ?? parsed.apiQuery;
      index += 1;
    } else if (arg.startsWith('--api-query=')) {
      parsed.apiQuery = arg.slice('--api-query='.length);
    } else if (arg === '--worker-query') {
      parsed.workerQuery = argv[index + 1] ?? parsed.workerQuery;
      index += 1;
    } else if (arg.startsWith('--worker-query=')) {
      parsed.workerQuery = arg.slice('--worker-query='.length);
    } else if (arg === '--period') {
      parsed.period = argv[index + 1] ?? parsed.period;
      index += 1;
    } else if (arg.startsWith('--period=')) {
      parsed.period = arg.slice('--period='.length);
    } else if (arg === '--limit') {
      parsed.limit = parseRequiredInteger(argv[index + 1], arg);
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      parsed.limit = parseRequiredInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--dsn-configured') {
      parsed.dsnConfigured = true;
    } else if (arg === '--session-replay-enabled') {
      parsed.sessionReplayEnabled = true;
    } else if (arg === '--legal-approved') {
      parsed.legalApproval = true;
    } else if (arg === '--trigger-smoke') {
      parsed.triggerSmoke = true;
    } else if (arg === '--trigger-timeout-ms') {
      parsed.triggerTimeoutMs = parseRequiredNonNegativeInteger(argv[index + 1], arg);
      index += 1;
    } else if (arg.startsWith('--trigger-timeout-ms=')) {
      parsed.triggerTimeoutMs = parseRequiredNonNegativeInteger(
        arg.slice('--trigger-timeout-ms='.length),
        '--trigger-timeout-ms',
      );
    } else if (arg === '--observe-delay-ms') {
      parsed.observeDelayMs = parseRequiredNonNegativeInteger(argv[index + 1], arg);
      index += 1;
    } else if (arg.startsWith('--observe-delay-ms=')) {
      parsed.observeDelayMs = parseRequiredNonNegativeInteger(
        arg.slice('--observe-delay-ms='.length),
        '--observe-delay-ms',
      );
    } else if (arg === '--selftest') {
      parsed.selftest = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.root = path.resolve(parsed.root);
  parsed.apiBaseUrl = normalizeApiBaseUrl(parsed.apiBaseUrl);
  parsed.smokeToken = String(parsed.smokeToken || '').trim();
  parsed.apiMarker = normalizeSmokeMarker(parsed.apiMarker, 'api marker');
  parsed.workerMarker = normalizeSmokeMarker(parsed.workerMarker, 'worker marker');
  parsed.limit = Math.max(1, parsed.limit);
  parsed.apiTarget = parsed.apiTarget || targetFromParts(parsed.org, parsed.apiProject);
  parsed.workerTarget = parsed.workerTarget || targetFromParts(parsed.org, parsed.workerProject);
  parsed.apiQuery = parsed.apiQuery || buildSmokeQuery(parsed, parsed.apiMarker);
  parsed.workerQuery = parsed.workerQuery || buildSmokeQuery(parsed, parsed.workerMarker);
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack Sentry smoke evidence writer

Usage:
  node scripts/write-sentry-smoke-evidence.mjs --release bidstack@sha --env staging --org my-org --api-project bidstack-api --worker-project bidstack-worker --dsn-configured
  node scripts/write-sentry-smoke-evidence.mjs --trigger-smoke --api-base-url https://staging-api.example --release bidstack@sha --env staging --org my-org --api-project bidstack-api --worker-project bidstack-worker --dsn-configured
  node scripts/write-sentry-smoke-evidence.mjs --selftest

Expected Sentry issue markers by default:
  ${DEFAULT_API_MARKER}
  ${DEFAULT_WORKER_MARKER}

Environment:
  BIDSTACK_SENTRY_EVIDENCE_PATH
  BIDSTACK_SENTRY_RELEASE / SENTRY_RELEASE / VITE_SENTRY_RELEASE
  BIDSTACK_DEPLOY_ENV / SENTRY_ENVIRONMENT
  BIDSTACK_SENTRY_ORG / SENTRY_ORG
  BIDSTACK_SENTRY_API_PROJECT
  BIDSTACK_SENTRY_WORKER_PROJECT
  BIDSTACK_SENTRY_API_TARGET
  BIDSTACK_SENTRY_WORKER_TARGET
  BIDSTACK_SENTRY_API_BASE_URL / API_BASE_URL
  BIDSTACK_SENTRY_SMOKE_TOKEN / SENTRY_SMOKE_TOKEN
  BIDSTACK_SENTRY_TRIGGER_SMOKE=true
  BIDSTACK_SENTRY_TRIGGER_TIMEOUT_MS
  BIDSTACK_SENTRY_OBSERVE_DELAY_MS
  BIDSTACK_SENTRY_API_QUERY
  BIDSTACK_SENTRY_WORKER_QUERY
  BIDSTACK_SENTRY_API_MARKER
  BIDSTACK_SENTRY_WORKER_MARKER
  BIDSTACK_SENTRY_DSN_CONFIGURED
  BIDSTACK_SENTRY_SESSION_REPLAY_ENABLED
  BIDSTACK_SENTRY_LEGAL_APPROVAL
`);
}

function normalizeEnvironment(value) {
  const normalized = String(value || 'staging').trim().toLowerCase();
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

function parseOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  return parseRequiredInteger(value, 'integer');
}

function parseOptionalNonNegativeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  return parseRequiredNonNegativeInteger(value, 'integer');
}

function parseRequiredInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseRequiredNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeApiBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
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

function hasPlaceholderSignal(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    PLACEHOLDER_EXACT_VALUES.has(normalized) ||
    PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function normalizeSmokeMarker(value, label) {
  const marker = String(value || '').trim();
  if (!/^[a-zA-Z0-9_.:@+-]{1,120}$/.test(marker)) {
    throw new Error(`${label} must be 1-120 chars and contain only letters, numbers, _ . : @ + -`);
  }
  return marker;
}

function targetFromParts(org, project) {
  const cleanOrg = String(org || '').trim();
  const cleanProject = String(project || '').trim();
  if (cleanOrg && cleanProject) return `${cleanOrg}/${cleanProject}`;
  if (cleanProject) return cleanProject;
  if (cleanOrg) return `${cleanOrg}/`;
  return '';
}

function quoteSearchValue(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (/^[A-Za-z0-9._:-]+$/.test(clean)) return clean;
  return `"${clean.replaceAll('"', '\\"')}"`;
}

function buildSmokeQuery(options, marker) {
  return [
    options.release ? `release:${quoteSearchValue(options.release)}` : '',
    options.environment ? `environment:${quoteSearchValue(options.environment)}` : '',
    'level:error',
    `*${marker}*`,
  ]
    .filter(Boolean)
    .join(' ');
}

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

function runCommand(root, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });

  if (result.error) {
    return {
      command: commandLabel(command, args),
      exitCode: null,
      passed: false,
      stdout: '',
      stderr: '',
      error: result.error.code || result.error.message,
    };
  }

  return {
    command: commandLabel(command, args),
    exitCode: result.status,
    passed: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: '',
  };
}

function smokeEndpointUrl(apiBaseUrl, endpoint) {
  return `${normalizeApiBaseUrl(apiBaseUrl)}/api/v1/ops/sentry-smoke/${endpoint}`;
}

async function postSmokeEndpoint(options, label, endpoint, marker, expectedStatuses, deps = {}) {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      label,
      endpoint,
      url: smokeEndpointUrl(options.apiBaseUrl, endpoint),
      marker,
      status: null,
      passed: false,
      error: 'fetch is unavailable in this Node runtime',
    };
  }

  const url = smokeEndpointUrl(options.apiBaseUrl, endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.triggerTimeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bidstack-sentry-smoke-token': options.smokeToken,
      },
      body: JSON.stringify({ marker }),
      cache: 'no-store',
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    return {
      label,
      endpoint,
      url,
      marker,
      status: response.status,
      passed: expectedStatuses.includes(response.status),
      expectedStatuses,
      bodyPreview: text.slice(0, 500),
    };
  } catch (error) {
    return {
      label,
      endpoint,
      url,
      marker,
      status: null,
      passed: false,
      expectedStatuses,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function triggerSmokeEvents(options, deps = {}) {
  const failures = [];
  if (!options.apiBaseUrl) failures.push('API base URL is required to trigger smoke events');
  if (options.apiBaseUrl && isLocalTarget(options.apiBaseUrl)) {
    failures.push(`Sentry smoke trigger target must be a non-local API: ${options.apiBaseUrl}`);
  }
  if (options.apiBaseUrl && hasPlaceholderSignal(options.apiBaseUrl)) {
    failures.push('Sentry smoke trigger target looks like placeholder evidence');
  }
  if (options.smokeToken.length < 24) {
    failures.push('Sentry smoke token must be at least 24 characters');
  }

  if (failures.length > 0) {
    return {
      requested: true,
      passed: false,
      api: null,
      worker: null,
      observeDelayMs: options.observeDelayMs,
      failures,
    };
  }

  process.stdout.write(`Triggering Sentry smoke events against ${options.apiBaseUrl}\n`);
  const api = await postSmokeEndpoint(
    options,
    'api-5xx-smoke-trigger',
    'api',
    options.apiMarker,
    [500],
    deps,
  );
  const worker = await postSmokeEndpoint(
    options,
    'worker-failure-smoke-trigger',
    'worker',
    options.workerMarker,
    [202],
    deps,
  );
  const triggerFailures = [api, worker]
    .filter((result) => result.passed !== true)
    .map((result) => `${result.label} returned ${result.status ?? result.error ?? 'unknown failure'}`);

  if (options.observeDelayMs > 0) {
    const sleepFn = deps.sleepFn ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    process.stdout.write(`Waiting ${options.observeDelayMs}ms for Sentry ingestion\n`);
    await sleepFn(options.observeDelayMs);
  }

  return {
    requested: true,
    passed: triggerFailures.length === 0,
    api,
    worker,
    observeDelayMs: options.observeDelayMs,
    failures: triggerFailures,
  };
}

function parseJsonArray(text) {
  const parsed = JSON.parse(text || '[]');
  if (!Array.isArray(parsed)) {
    throw new Error('Sentry CLI JSON output was not an array');
  }
  return parsed;
}

function compactIssue(issue) {
  const project = issue?.project && typeof issue.project === 'object' ? issue.project : {};
  return {
    id: String(issue?.id || ''),
    shortId: String(issue?.shortId || ''),
    title: String(issue?.title || ''),
    level: String(issue?.level || ''),
    status: String(issue?.status || ''),
    count: String(issue?.count || ''),
    lastSeen: issue?.lastSeen || null,
    permalink: issue?.permalink || null,
    project: project.slug || project.name || null,
  };
}

function queryIssues(options, label, target, query) {
  const args = [
    'issue',
    'list',
    '--json',
    '--fields',
    'id,shortId,title,level,status,count,lastSeen,permalink,project',
    '--limit',
    String(options.limit),
    '--period',
    options.period,
    '--query',
    query,
    '--fresh',
  ];
  if (target) args.push(target);

  const result = runCommand(options.root, 'sentry', args);
  if (!result.passed) {
    return {
      label,
      target,
      query,
      observed: false,
      issueCount: 0,
      issues: [],
      command: {
        command: result.command,
        exitCode: result.exitCode,
        passed: false,
        error: result.error || normalizeStderr(result.stderr),
      },
    };
  }

  try {
    const issues = parseJsonArray(result.stdout).map(compactIssue);
    return {
      label,
      target,
      query,
      observed: issues.length > 0,
      issueCount: issues.length,
      issues,
      command: {
        command: result.command,
        exitCode: result.exitCode,
        passed: true,
      },
    };
  } catch (error) {
    return {
      label,
      target,
      query,
      observed: false,
      issueCount: 0,
      issues: [],
      command: {
        command: result.command,
        exitCode: result.exitCode,
        passed: false,
        error: error.message,
      },
    };
  }
}

function normalizeStderr(stderr) {
  return String(stderr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
}

function readTextIfExists(root, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  if (!existsSync(absolutePath)) return '';
  return readFileSync(absolutePath, 'utf8');
}

function collectPrivacySourceProof(root) {
  const apiInstrument = readTextIfExists(root, 'apps/api/src/instrument.ts');
  const apiPlugin = readTextIfExists(root, 'apps/api/src/plugins/sentry.ts');
  const workerPlugin = readTextIfExists(root, 'apps/worker/src/plugins/sentry.ts');
  const webHelper = readTextIfExists(root, 'apps/web/src/lib/sentry.ts');

  const checks = [
    {
      id: 'api.instrument.sendDefaultPii',
      passed: /sendDefaultPii:\s*false/.test(apiInstrument),
    },
    {
      id: 'api.instrument.beforeSend',
      passed: /beforeSend:\s*scrubSentryEvent/.test(apiInstrument),
    },
    {
      id: 'api.plugin.idOnlyUser',
      passed: /Sentry\.setUser\(\{\s*id:\s*auth\.userId\s*\}\)/.test(apiPlugin),
    },
    {
      id: 'worker.beforeSend',
      passed: /beforeSend\(event\)/.test(workerPlugin) && /scrubPii/.test(workerPlugin),
    },
    {
      id: 'web.helper.beforeSend',
      passed: /beforeSend\(event\)/.test(webHelper) && /scrubSentryBrowserEvent/.test(webHelper),
    },
    {
      id: 'web.helper.replayOptIn',
      passed: /VITE_SENTRY_REPLAY === 'true'/.test(webHelper) && /maskAllInputs:\s*true/.test(webHelper),
    },
  ];

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function buildArtifact(options, observations) {
  const privacy = collectPrivacySourceProof(options.root);
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: options.environment,
    release: options.release,
    triggerTarget: options.apiBaseUrl || null,
    dsnConfigured: options.dsnConfigured,
    sendDefaultPii: options.sendDefaultPii,
    piiScrubberEnabled: privacy.passed,
    sessionReplayEnabled: options.sessionReplayEnabled,
    legalApproval: options.sessionReplayEnabled ? options.legalApproval : undefined,
    api5xxSmokeObserved: observations.api.observed,
    workerFailureObserved: observations.worker.observed,
    triggeredSmoke: observations.triggeredSmoke,
    apiEvidence: observations.api,
    workerEvidence: observations.worker,
    privacySourceProof: privacy,
  };
  const validationFailures = validateArtifact(artifact);
  return {
    ...artifact,
    passed: validationFailures.length === 0,
    validationFailures,
  };
}

function validateArtifact(artifact) {
  const failures = [];
  if (artifact.triggeredSmoke?.requested === true && artifact.triggeredSmoke?.passed !== true) {
    failures.push('Sentry smoke trigger did not complete');
  }
  if (!String(artifact.triggerTarget || '').trim()) {
    failures.push('Sentry smoke trigger target is required');
  } else if (isLocalTarget(artifact.triggerTarget)) {
    failures.push('Sentry smoke trigger target must be non-local');
  } else if (hasPlaceholderSignal(artifact.triggerTarget)) {
    failures.push('Sentry smoke trigger target looks like placeholder evidence');
  }
  if (artifact.dsnConfigured !== true) failures.push('Sentry DSN must be configured');
  if (!String(artifact.release || '').trim()) failures.push('Sentry release is required');
  if (!String(artifact.environment || '').trim()) failures.push('Sentry environment is required');
  if (artifact.apiEvidence?.command?.passed !== true) failures.push('API smoke Sentry query did not complete');
  if (artifact.workerEvidence?.command?.passed !== true) failures.push('Worker smoke Sentry query did not complete');
  if (artifact.api5xxSmokeObserved !== true) failures.push('API 5xx smoke issue was not observed in Sentry');
  if (artifact.workerFailureObserved !== true) failures.push('Worker failure smoke issue was not observed in Sentry');
  if (!(artifact.sendDefaultPii === false || artifact.piiScrubberEnabled === true)) {
    failures.push('Sentry privacy controls are not proven');
  }
  if (artifact.sessionReplayEnabled === true && artifact.legalApproval !== true) {
    failures.push('Session replay requires legal approval');
  }
  return failures;
}

function writeArtifact(root, outputPath, artifact) {
  const absolutePath = path.resolve(root, outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return absolutePath;
}

async function runWriter(options, deps = {}) {
  const triggeredSmoke = options.triggerSmoke ? await triggerSmokeEvents(options, deps) : null;
  const observations = {
    triggeredSmoke,
    api: queryIssues(options, 'api-5xx-smoke', options.apiTarget, options.apiQuery),
    worker: queryIssues(options, 'worker-failure-smoke', options.workerTarget, options.workerQuery),
  };
  const artifact = buildArtifact(options, observations);
  const absolutePath = writeArtifact(options.root, options.outputPath, artifact);

  process.stdout.write(`Sentry smoke evidence: ${path.relative(options.root, absolutePath)}\n`);
  process.stdout.write(`Environment: ${artifact.environment}\n`);
  process.stdout.write(`Release: ${artifact.release || 'missing'}\n`);
  process.stdout.write(`Trigger target: ${artifact.triggerTarget || 'missing'}\n`);
  if (artifact.triggeredSmoke?.requested === true) {
    process.stdout.write(
      `Smoke triggers: ${artifact.triggeredSmoke.passed ? 'passed' : 'failed'}\n`,
    );
  }
  process.stdout.write(`API smoke issues: ${artifact.apiEvidence.issueCount}\n`);
  process.stdout.write(`Worker smoke issues: ${artifact.workerEvidence.issueCount}\n`);
  process.stdout.write(`Privacy source proof: ${artifact.privacySourceProof.passed ? 'yes' : 'no'}\n`);

  if (artifact.validationFailures.length > 0) {
    for (const failure of artifact.validationFailures) {
      process.stderr.write(`FAIL ${failure}\n`);
    }
    return 1;
  }

  process.stdout.write('Sentry smoke evidence passed\n');
  return 0;
}

function fixtureObservation({ observed = true, commandPassed = true } = {}) {
  return {
    label: 'fixture',
    target: 'fixture-org/fixture-project',
    query: 'release:fixture level:error *fixture*',
    observed,
    issueCount: observed ? 1 : 0,
    issues: observed
      ? [
          {
            id: '123',
            shortId: 'BID-123',
            title: 'bidstack smoke fixture',
            level: 'error',
            status: 'unresolved',
            count: '1',
            lastSeen: new Date().toISOString(),
            permalink: 'https://sentry.example/issues/123',
            project: 'fixture-project',
          },
        ]
      : [],
    command: {
      command: 'fixture sentry issue list',
      exitCode: commandPassed ? 0 : 1,
      passed: commandPassed,
      error: commandPassed ? undefined : 'fixture failure',
    },
  };
}

function baseOptions(overrides = {}) {
  return {
    root: process.cwd(),
    outputPath: DEFAULT_OUTPUT_PATH,
    environment: 'staging',
    release: 'bidstack@0.1.0+abc123',
    apiBaseUrl: 'https://staging-api.bidstack360.com',
    smokeToken: 'release-smoke-token-1234567890',
    apiMarker: DEFAULT_API_MARKER,
    workerMarker: DEFAULT_WORKER_MARKER,
    triggerSmoke: false,
    triggerTimeoutMs: DEFAULT_TRIGGER_TIMEOUT_MS,
    observeDelayMs: 0,
    dsnConfigured: true,
    sendDefaultPii: false,
    sessionReplayEnabled: false,
    legalApproval: false,
    ...overrides,
  };
}

async function runSelftest() {
  const good = buildArtifact(baseOptions(), {
    triggeredSmoke: null,
    api: fixtureObservation(),
    worker: fixtureObservation(),
  });
  assert.equal(good.passed, true, `expected clean Sentry fixture to pass: ${good.validationFailures.join(', ')}`);

  const missingApi = buildArtifact(baseOptions(), {
    triggeredSmoke: null,
    api: fixtureObservation({ observed: false }),
    worker: fixtureObservation(),
  });
  assert.equal(missingApi.passed, false, 'expected missing API smoke issue to fail');
  assert.equal(
    missingApi.validationFailures.some((failure) => failure.includes('API 5xx')),
    true,
    'expected API smoke failure',
  );

  const queryFailure = buildArtifact(baseOptions(), {
    triggeredSmoke: null,
    api: fixtureObservation({ commandPassed: false }),
    worker: fixtureObservation(),
  });
  assert.equal(queryFailure.passed, false, 'expected Sentry CLI query failure to fail');
  assert.equal(
    queryFailure.validationFailures.some((failure) => failure.includes('API smoke Sentry query')),
    true,
    'expected query failure',
  );

  const replayWithoutLegal = buildArtifact(baseOptions({ sessionReplayEnabled: true, legalApproval: false }), {
    triggeredSmoke: null,
    api: fixtureObservation(),
    worker: fixtureObservation(),
  });
  assert.equal(replayWithoutLegal.passed, false, 'expected replay without legal approval to fail');
  assert.equal(
    replayWithoutLegal.validationFailures.some((failure) => failure.includes('legal approval')),
    true,
    'expected legal approval failure',
  );

  const missingDsn = buildArtifact(baseOptions({ dsnConfigured: false }), {
    triggeredSmoke: null,
    api: fixtureObservation(),
    worker: fixtureObservation(),
  });
  assert.equal(missingDsn.passed, false, 'expected missing DSN to fail');

  const missingTriggerTarget = buildArtifact(baseOptions({ apiBaseUrl: '' }), {
    triggeredSmoke: null,
    api: fixtureObservation(),
    worker: fixtureObservation(),
  });
  assert.equal(missingTriggerTarget.passed, false, 'expected missing trigger target to fail');
  assert.equal(
    missingTriggerTarget.validationFailures.some((failure) => failure.includes('trigger target')),
    true,
    'expected trigger target failure',
  );

  const localTriggerTarget = buildArtifact(baseOptions({ apiBaseUrl: 'http://127.0.0.1:4000' }), {
    triggeredSmoke: null,
    api: fixtureObservation(),
    worker: fixtureObservation(),
  });
  assert.equal(localTriggerTarget.passed, false, 'expected local trigger target to fail');
  assert.equal(
    localTriggerTarget.validationFailures.some((failure) => failure.includes('non-local')),
    true,
    'expected non-local trigger target failure',
  );

  const trigger = await triggerSmokeEvents(baseOptions({ triggerSmoke: true }), {
    fetchFn: async (url) => ({
      status: String(url).endsWith('/api') ? 500 : 202,
      text: async () => (String(url).endsWith('/api') ? '{"error":"controlled"}' : '{"queued":true}'),
    }),
    sleepFn: async () => undefined,
  });
  assert.equal(trigger.passed, true, `expected trigger fixture to pass: ${trigger.failures.join(', ')}`);
  assert.equal(trigger.api.status, 500);
  assert.equal(trigger.worker.status, 202);
  assert.equal(trigger.api.marker, DEFAULT_API_MARKER);

  const missingTriggerToken = await triggerSmokeEvents(
    baseOptions({ triggerSmoke: true, smokeToken: 'too-short' }),
    {
      fetchFn: async () => {
        throw new Error('fetch should not be called without a valid token');
      },
    },
  );
  assert.equal(missingTriggerToken.passed, false, 'expected missing trigger token to fail');
  assert.equal(
    missingTriggerToken.failures.some((failure) => failure.includes('at least 24 characters')),
    true,
    'expected token length failure',
  );

  const localTrigger = await triggerSmokeEvents(
    baseOptions({ triggerSmoke: true, apiBaseUrl: 'http://127.0.0.1:4000' }),
    {
      fetchFn: async () => {
        throw new Error('fetch should not be called for a local trigger target');
      },
    },
  );
  assert.equal(localTrigger.passed, false, 'expected local trigger to fail before fetch');
  assert.equal(
    localTrigger.failures.some((failure) => failure.includes('non-local API')),
    true,
    'expected local trigger target failure before fetch',
  );

  const failedTriggerArtifact = buildArtifact(baseOptions(), {
    triggeredSmoke: {
      requested: true,
      passed: false,
      failures: ['api trigger returned 404'],
    },
    api: fixtureObservation(),
    worker: fixtureObservation(),
  });
  assert.equal(failedTriggerArtifact.passed, false, 'expected failed trigger to fail artifact');
  assert.equal(
    failedTriggerArtifact.validationFailures.some((failure) => failure.includes('trigger')),
    true,
    'expected trigger failure in validation',
  );

  process.stdout.write('Sentry smoke evidence selftest passed\n');
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    await runSelftest();
  } else {
    process.exit(await runWriter(args));
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
