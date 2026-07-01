#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/api-connectivity-latest.json';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DOMAIN_SMOKE_PATH =
  '/api/companies?search=__bidstack_release_probe_no_match__&limit=1';
const AUTH_SCHEMES = new Set(['api-key', 'bearer']);

const PLACEHOLDER_EXACT_VALUES = new Set([
  'changeme',
  'change-me',
  'change_me',
  'example',
  'placeholder',
  'replace-me',
  'replace_me',
  'todo',
  'tbd',
  'dummy',
  'test',
  'secret',
  'token',
  'api-key',
  'apikey',
]);

const PLACEHOLDER_VALUE_PATTERNS = [
  /\bexample\.com\b/i,
  /\bexample\.org\b/i,
  /\bexample\.net\b/i,
  /\.example\b/i,
  /\bplaceholder\b/i,
  /\bchangeme\b/i,
  /\bchange[-_ ]?me\b/i,
  /\breplace[-_ ]?me\b/i,
  /\brelease[-_ ]?api[-_ ]?token\b/i,
  /\bmock[-_ ]?token\b/i,
  /\bdummy[-_ ]?token\b/i,
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_API_CONNECTIVITY_EVIDENCE ?? DEFAULT_OUTPUT_PATH,
    deployEnv: process.env.BIDSTACK_DEPLOY_ENV ?? process.env.NODE_ENV ?? 'unknown',
    target:
      process.env.BIDSTACK_API_CONNECTIVITY_TARGET ??
      process.env.BIDSTACK_API_BASE_URL ??
      process.env.API_BASE_URL ??
      '',
    apiToken:
      process.env.BIDSTACK_API_CONNECTIVITY_API_TOKEN ??
      process.env.BIDSTACK_API_KEY ??
      process.env.API_TOKEN ??
      '',
    authScheme: normalizeAuthScheme(process.env.BIDSTACK_API_CONNECTIVITY_AUTH_SCHEME),
    expectedOrgId: process.env.BIDSTACK_API_CONNECTIVITY_EXPECTED_ORG_ID ?? '',
    domainSmokePath:
      process.env.BIDSTACK_API_CONNECTIVITY_DOMAIN_SMOKE_PATH ?? DEFAULT_DOMAIN_SMOKE_PATH,
    timeoutMs: Number(process.env.BIDSTACK_API_CONNECTIVITY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    strict: process.env.BIDSTACK_STRICT_DEPLOY_GATE !== '0',
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--selftest') {
      options.selftest = true;
    } else if (arg === '--root') {
      options.root = next;
      index += 1;
    } else if (arg === '--output') {
      options.outputPath = next;
      index += 1;
    } else if (arg === '--env') {
      options.deployEnv = next;
      index += 1;
    } else if (arg === '--target') {
      options.target = next;
      index += 1;
    } else if (arg === '--api-token') {
      options.apiToken = next;
      index += 1;
    } else if (arg === '--auth-scheme') {
      options.authScheme = normalizeAuthScheme(next);
      index += 1;
    } else if (arg === '--expected-org-id') {
      options.expectedOrgId = next;
      index += 1;
    } else if (arg === '--domain-smoke-path') {
      options.domainSmokePath = next;
      index += 1;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(next);
      index += 1;
    } else if (arg === '--non-strict') {
      options.strict = false;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/write-api-connectivity-evidence.mjs [options]

Writes deploy-evidence/api-connectivity-latest.json after a live API smoke.

Environment:
  BIDSTACK_API_CONNECTIVITY_TARGET           Public API base URL
  BIDSTACK_API_CONNECTIVITY_API_TOKEN        API key or bearer token
  BIDSTACK_API_CONNECTIVITY_AUTH_SCHEME      api-key (default) or bearer
  BIDSTACK_API_CONNECTIVITY_EXPECTED_ORG_ID  Optional expected tenant org id
  BIDSTACK_API_CONNECTIVITY_DOMAIN_SMOKE_PATH Optional read-only API path to smoke
  BIDSTACK_API_CONNECTIVITY_EVIDENCE         Output path
  BIDSTACK_API_CONNECTIVITY_TIMEOUT_MS       Per-request timeout
  BIDSTACK_DEPLOY_ENV                        Evidence environment label

Options:
  --target <url>             Override API target
  --api-token <token>        Override API token
  --auth-scheme <scheme>     api-key or bearer
  --expected-org-id <id>     Require capabilities org id to match
  --domain-smoke-path <path> Read-only API path to smoke
  --output <path>            Override evidence output path
  --env <name>               Override deploy environment
  --timeout-ms <ms>          Override per-request timeout
  --strict / --non-strict    Toggle strict production checks
  --selftest                 Run offline contract tests
`);
}

function normalizeAuthScheme(value) {
  const normalized = String(value || 'api-key')
    .trim()
    .toLowerCase();
  return normalized || 'api-key';
}

function normalizeTarget(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function normalizeSmokePath(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return DEFAULT_DOMAIN_SMOKE_PATH;
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isPlaceholderValue(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  if (PLACEHOLDER_EXACT_VALUES.has(normalized)) {
    return true;
  }

  return PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isLocalTarget(value) {
  try {
    const parsed = new URL(value);
    return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return true;
  }
}

function validateLivePreconditions(options) {
  const failures = [];
  const target = normalizeTarget(options.target);

  if (!target) {
    failures.push('API target is required.');
  } else {
    try {
      const parsed = new URL(target);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        failures.push(`API target must be HTTP(S), received ${parsed.protocol}.`);
      }
    } catch {
      failures.push('API target must be a valid URL.');
    }

    if (options.strict && isLocalTarget(target)) {
      failures.push('Strict API connectivity proof must use a non-local public target.');
    }

    if (options.strict && isPlaceholderValue(target)) {
      failures.push('Strict API connectivity proof cannot use a placeholder target.');
    }
  }

  if (!AUTH_SCHEMES.has(options.authScheme)) {
    failures.push(`API auth scheme must be one of: ${[...AUTH_SCHEMES].join(', ')}.`);
  }

  const token = String(options.apiToken ?? '').trim();
  if (!token) {
    failures.push('API token is required.');
  } else {
    if (options.strict && token.length < 24) {
      failures.push('Strict API token must be at least 24 characters.');
    }

    if (options.strict && isPlaceholderValue(token)) {
      failures.push('Strict API token cannot be a placeholder value.');
    }
  }

  if (options.strict && isPlaceholderValue(options.expectedOrgId)) {
    failures.push('Expected API org id cannot be placeholder-like in strict mode.');
  }

  const smokePath = normalizeSmokePath(options.domainSmokePath);
  if (!smokePath.startsWith('/api/')) {
    failures.push('API domain smoke path must start with /api/.');
  }

  if (options.strict && isPlaceholderValue(smokePath)) {
    failures.push('API domain smoke path cannot be placeholder-like in strict mode.');
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    failures.push('API connectivity timeout must be a positive number.');
  }

  return failures;
}

function buildUrl(baseUrl, endpointPath) {
  return new URL(endpointPath, `${baseUrl}/`).toString();
}

function createAuthHeaders(options) {
  if (options.authScheme === 'bearer') {
    return {
      accept: 'application/json',
      authorization: `Bearer ${options.apiToken}`,
    };
  }

  return {
    accept: 'application/json',
    'x-api-key': options.apiToken,
  };
}

async function fetchJson(fetchFn, url, init, timeoutMs) {
  const response = await fetchFn(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await readResponseBody(response);

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function readResponseBody(response) {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text);
}

function summarizeHttpError(error) {
  return String(error?.message ?? error ?? 'unknown error');
}

function makeFailedCheck(error) {
  return {
    ok: false,
    error: summarizeHttpError(error),
  };
}

function summarizeDomainReadCheck(response, smokePath) {
  const items = Array.isArray(response.body?.items) ? response.body.items : null;
  const itemCount = items?.length ?? null;
  return {
    ok: response.ok && Array.isArray(items) && itemCount === 0,
    status: response.status,
    path: smokePath,
    responseShape: Array.isArray(items) ? 'paginated-list' : 'unknown',
    itemCount,
    nextCursorPresent: Boolean(response.body?.nextCursor),
    noMatchProbe: true,
    rawItemsIncluded: false,
    rawBodyIncluded: false,
  };
}

async function runLiveSmoke(options, fetchFn = globalThis.fetch) {
  const startedAt = new Date().toISOString();
  const target = normalizeTarget(options.target);
  const domainSmokePath = normalizeSmokePath(options.domainSmokePath);
  const preconditionFailures = validateLivePreconditions(options);

  const result = {
    source: 'live-api-smoke',
    target,
    authScheme: options.authScheme,
    expectedOrgId: String(options.expectedOrgId ?? '').trim(),
    startedAt,
    completedAt: null,
    ok: false,
    livez: { ok: false },
    readyz: { ok: false },
    health: { ok: false },
    capabilities: { ok: false },
    domainRead: { ok: false },
    error: null,
  };

  if (preconditionFailures.length > 0) {
    result.error = preconditionFailures.join(' ');
    result.completedAt = new Date().toISOString();
    return result;
  }

  if (typeof fetchFn !== 'function') {
    result.error = 'global fetch is not available.';
    result.completedAt = new Date().toISOString();
    return result;
  }

  try {
    const livez = await fetchJson(
      fetchFn,
      buildUrl(target, '/livez'),
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
      options.timeoutMs,
    );
    result.livez = {
      ok: livez.ok && livez.body?.ok === true,
      status: livez.status,
      apiOk: livez.body?.ok ?? null,
    };
  } catch (error) {
    result.livez = makeFailedCheck(error);
  }

  try {
    const readyz = await fetchJson(
      fetchFn,
      buildUrl(target, '/readyz'),
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
      options.timeoutMs,
    );
    result.readyz = {
      ok:
        readyz.ok &&
        readyz.body?.ok === true &&
        readyz.body?.db === true &&
        readyz.body?.redis === true &&
        readyz.body?.storage === true,
      status: readyz.status,
      apiOk: readyz.body?.ok ?? null,
      db: readyz.body?.db ?? null,
      redis: readyz.body?.redis ?? null,
      storage: readyz.body?.storage ?? null,
    };
  } catch (error) {
    result.readyz = makeFailedCheck(error);
  }

  try {
    const health = await fetchJson(
      fetchFn,
      buildUrl(target, '/health'),
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
      options.timeoutMs,
    );
    result.health = {
      ok:
        health.ok &&
        health.body?.ok === true &&
        health.body?.db === true &&
        health.body?.redis === true,
      status: health.status,
      apiOk: health.body?.ok ?? null,
      db: health.body?.db ?? null,
      redis: health.body?.redis ?? null,
    };
  } catch (error) {
    result.health = makeFailedCheck(error);
  }

  try {
    const capabilities = await fetchJson(
      fetchFn,
      buildUrl(target, '/api/me/capabilities'),
      {
        method: 'GET',
        headers: createAuthHeaders(options),
      },
      options.timeoutMs,
    );
    const orgId = String(capabilities.body?.orgId ?? '').trim();
    const userId = String(capabilities.body?.userId ?? '').trim();
    const roles = Array.isArray(capabilities.body?.roles) ? capabilities.body.roles : [];
    const permissions = Array.isArray(capabilities.body?.permissions)
      ? capabilities.body.permissions
      : [];
    const expectedOrgId = String(options.expectedOrgId ?? '').trim();
    result.capabilities = {
      ok:
        capabilities.ok &&
        Boolean(orgId) &&
        Boolean(userId) &&
        (!expectedOrgId || orgId === expectedOrgId),
      status: capabilities.status,
      userId,
      orgId,
      expectedOrgId: expectedOrgId || null,
      legacyRole: capabilities.body?.legacyRole ?? null,
      rolesCount: roles.length,
      permissionsCount: permissions.length,
      isAdmin: capabilities.body?.isAdmin ?? null,
    };
  } catch (error) {
    result.capabilities = makeFailedCheck(error);
  }

  try {
    const domainRead = await fetchJson(
      fetchFn,
      buildUrl(target, domainSmokePath),
      {
        method: 'GET',
        headers: createAuthHeaders(options),
      },
      options.timeoutMs,
    );
    result.domainRead = summarizeDomainReadCheck(domainRead, domainSmokePath);
  } catch (error) {
    result.domainRead = {
      ...makeFailedCheck(error),
      path: domainSmokePath,
      rawItemsIncluded: false,
      rawBodyIncluded: false,
    };
  }

  result.ok =
    result.livez.ok === true &&
    result.readyz.ok === true &&
    result.health.ok === true &&
    result.capabilities.ok === true &&
    result.domainRead.ok === true;
  result.completedAt = new Date().toISOString();

  if (!result.ok) {
    result.error = 'One or more API connectivity checks failed.';
  }

  return result;
}

function buildArtifact(options, smoke) {
  const generatedAt = new Date().toISOString();
  const artifact = {
    schemaVersion: 1,
    generatedAt,
    runner: 'write-api-connectivity-evidence',
    environment: options.deployEnv,
    strict: options.strict,
    target: smoke.target,
    authScheme: smoke.authScheme,
    expectedOrgId: smoke.expectedOrgId || null,
    command: {
      source: smoke.source,
      ok: smoke.ok,
      startedAt: smoke.startedAt,
      completedAt: smoke.completedAt,
      error: smoke.error,
    },
    checks: {
      livez: smoke.livez,
      readyz: smoke.readyz,
      health: smoke.health,
      capabilities: smoke.capabilities,
      domainRead: smoke.domainRead,
    },
    tenant: {
      orgId: smoke.capabilities?.orgId || null,
      userId: smoke.capabilities?.userId || null,
    },
    passed: false,
    validationFailures: [],
  };

  artifact.validationFailures = validateArtifact(artifact, options);
  artifact.passed = artifact.validationFailures.length === 0;

  return artifact;
}

function validateArtifact(artifact, options) {
  const failures = [];

  if (artifact.environment !== options.deployEnv) {
    failures.push(
      `Evidence environment ${artifact.environment} does not match expected ${options.deployEnv}.`,
    );
  }

  if (artifact.command.source !== 'live-api-smoke') {
    failures.push('API connectivity evidence must come from live-api-smoke.');
  }

  if (artifact.command.ok !== true) {
    failures.push('API connectivity smoke did not complete successfully.');
  }

  if (!artifact.target) {
    failures.push('API evidence target is missing.');
  } else {
    if (options.strict && isLocalTarget(artifact.target)) {
      failures.push('API evidence target must be non-local in strict mode.');
    }

    if (options.strict && isPlaceholderValue(artifact.target)) {
      failures.push('API evidence target cannot be placeholder-like in strict mode.');
    }
  }

  if (!AUTH_SCHEMES.has(artifact.authScheme)) {
    failures.push('API evidence auth scheme is invalid.');
  }

  for (const checkName of ['livez', 'readyz', 'health', 'capabilities']) {
    if (artifact.checks?.[checkName]?.ok !== true) {
      failures.push(`API ${checkName} check failed.`);
    }
  }

  const domainRead = artifact.checks?.domainRead ?? {};
  if (domainRead.ok !== true) {
    failures.push('API domain read smoke check failed.');
  }

  if (!String(domainRead.path ?? '').startsWith('/api/')) {
    failures.push('API domain read smoke path must start with /api/.');
  }

  if (domainRead.responseShape !== 'paginated-list') {
    failures.push('API domain read smoke must prove the expected paginated-list response shape.');
  }

  if (domainRead.noMatchProbe !== true || domainRead.itemCount !== 0) {
    failures.push('API domain read smoke must use a no-match probe and return zero items.');
  }

  if (domainRead.rawItemsIncluded !== false || domainRead.rawBodyIncluded !== false) {
    failures.push('API domain read smoke evidence must not include raw API data.');
  }

  if ('items' in domainRead || 'body' in domainRead || 'rawBody' in domainRead) {
    failures.push('API domain read smoke evidence contains raw API response data.');
  }

  if (
    artifact.checks?.readyz?.db !== true ||
    artifact.checks?.readyz?.redis !== true ||
    artifact.checks?.readyz?.storage !== true
  ) {
    failures.push('API readiness check must prove db, redis, and storage are ready.');
  }

  if (artifact.checks?.health?.db !== true || artifact.checks?.health?.redis !== true) {
    failures.push('API health check must prove db and redis are ready.');
  }

  const orgId = String(artifact.checks?.capabilities?.orgId ?? '').trim();
  const userId = String(artifact.checks?.capabilities?.userId ?? '').trim();
  const expectedOrgId = String(options.expectedOrgId ?? '').trim();
  if (!orgId || !userId) {
    failures.push('API capabilities check must prove authenticated user and org context.');
  }

  if (expectedOrgId && orgId !== expectedOrgId) {
    failures.push(`API capabilities org ${orgId || 'missing'} does not match ${expectedOrgId}.`);
  }

  return failures;
}

function resolveOutputPath(root, outputPath) {
  return path.isAbsolute(outputPath) ? outputPath : path.join(root, outputPath);
}

function writeJsonFile(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function runWriter(options, deps = {}) {
  const smoke = await runLiveSmoke(options, deps.fetchFn ?? globalThis.fetch);
  const artifact = buildArtifact(options, smoke);
  const outputPath = resolveOutputPath(options.root, options.outputPath);
  writeJsonFile(outputPath, artifact);

  return {
    artifact,
    outputPath,
    exitCode: artifact.passed ? 0 : 1,
  };
}

function makeJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function createFakeApiFetch({ ready = true, orgId = 'org_release_1234567890' } = {}) {
  const calls = [];

  const fetchFn = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = String(init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers ?? {});
    calls.push({ url: parsed.toString(), method, headers });

    if (method === 'GET' && parsed.pathname === '/livez') {
      return makeJsonResponse({ ok: true });
    }

    if (method === 'GET' && parsed.pathname === '/readyz') {
      return makeJsonResponse(
        {
          ok: ready,
          db: ready,
          redis: ready,
          storage: ready,
        },
        ready ? 200 : 503,
      );
    }

    if (method === 'GET' && parsed.pathname === '/health') {
      return makeJsonResponse({
        ok: true,
        db: true,
        redis: true,
      });
    }

    if (method === 'GET' && parsed.pathname === '/api/me/capabilities') {
      if (!headers.get('x-api-key') && !headers.get('authorization')) {
        return makeJsonResponse({ error: 'missing auth' }, 401);
      }

      return makeJsonResponse({
        userId: 'apikey:selftest-key',
        orgId,
        legacyRole: 'api',
        roles: [],
        permissions: ['read', 'write'],
        isAdmin: false,
      });
    }

    if (method === 'GET' && parsed.pathname === '/api/companies') {
      if (!headers.get('x-api-key') && !headers.get('authorization')) {
        return makeJsonResponse({ error: 'missing auth' }, 401);
      }

      return makeJsonResponse({
        items: [],
      });
    }

    return makeJsonResponse({ error: 'unexpected selftest request' }, 404);
  };

  fetchFn.calls = calls;
  return fetchFn;
}

async function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidstack-api-evidence-'));

  try {
    const baseOptions = {
      root,
      outputPath: DEFAULT_OUTPUT_PATH,
      deployEnv: 'production',
      target: 'https://api.release.bidstack360.com',
      apiToken: 'release_api_token_1234567890abcdef',
      authScheme: 'api-key',
      expectedOrgId: 'org_release_1234567890',
      domainSmokePath: DEFAULT_DOMAIN_SMOKE_PATH,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      strict: true,
    };

    const goodFetch = createFakeApiFetch();
    const good = await runWriter(baseOptions, { fetchFn: goodFetch });
    assert.equal(good.exitCode, 0);
    assert.equal(good.artifact.passed, true);
    assert.equal(good.artifact.checks.readyz.storage, true);
    assert.equal(good.artifact.checks.domainRead.ok, true);
    assert.equal(good.artifact.checks.domainRead.itemCount, 0);
    assert.equal('items' in good.artifact.checks.domainRead, false);
    assert.equal(good.artifact.tenant.orgId, 'org_release_1234567890');
    assert.equal(existsSync(good.outputPath), true);
    const authCall = goodFetch.calls.find((call) =>
      new URL(call.url).pathname.includes('capabilities'),
    );
    assert.equal(authCall.headers.get('x-api-key'), baseOptions.apiToken);
    assert.equal(authCall.headers.get('authorization'), null);

    const bearerFetch = createFakeApiFetch();
    const bearer = await runWriter(
      {
        ...baseOptions,
        outputPath: 'bearer.json',
        authScheme: 'bearer',
      },
      { fetchFn: bearerFetch },
    );
    assert.equal(bearer.exitCode, 0);
    const bearerAuthCall = bearerFetch.calls.find((call) =>
      new URL(call.url).pathname.includes('capabilities'),
    );
    assert.equal(bearerAuthCall.headers.get('authorization'), `Bearer ${baseOptions.apiToken}`);
    assert.equal(bearerAuthCall.headers.get('x-api-key'), null);

    const badReadiness = await runWriter(
      {
        ...baseOptions,
        outputPath: 'bad-readiness.json',
      },
      {
        fetchFn: createFakeApiFetch({ ready: false }),
      },
    );
    assert.equal(badReadiness.exitCode, 1);
    assert.match(badReadiness.artifact.validationFailures.join('\n'), /readyz/);

    const orgMismatch = await runWriter(
      {
        ...baseOptions,
        outputPath: 'org-mismatch.json',
      },
      {
        fetchFn: createFakeApiFetch({ orgId: 'org_other' }),
      },
    );
    assert.equal(orgMismatch.exitCode, 1);
    assert.match(orgMismatch.artifact.validationFailures.join('\n'), /does not match/);

    const localTarget = await runWriter(
      {
        ...baseOptions,
        outputPath: 'local-target.json',
        target: 'http://localhost:4000',
      },
      {
        fetchFn: async () => {
          throw new Error('fetch should not be called when preconditions fail');
        },
      },
    );
    assert.equal(localTarget.exitCode, 1);
    assert.match(localTarget.artifact.validationFailures.join('\n'), /non-local/);

    const placeholderToken = await runWriter(
      {
        ...baseOptions,
        outputPath: 'placeholder-token.json',
        apiToken: 'release-api-token',
      },
      {
        fetchFn: async () => {
          throw new Error('fetch should not be called when preconditions fail');
        },
      },
    );
    assert.equal(placeholderToken.exitCode, 1);
    assert.match(placeholderToken.artifact.validationFailures.join('\n'), /successfully/);

    const invalidScheme = await runWriter(
      {
        ...baseOptions,
        outputPath: 'invalid-scheme.json',
        authScheme: 'basic',
      },
      {
        fetchFn: async () => {
          throw new Error('fetch should not be called when preconditions fail');
        },
      },
    );
    assert.equal(invalidScheme.exitCode, 1);
    assert.match(invalidScheme.artifact.validationFailures.join('\n'), /auth scheme/);

    const parsed = JSON.parse(readFileSync(good.outputPath, 'utf8'));
    assert.equal(parsed.command.source, 'live-api-smoke');
    assert.equal(parsed.checks.capabilities.orgId, 'org_release_1234567890');

    console.log('[api-evidence] selftest passed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.selftest) {
    await runSelftest();
    return;
  }

  const { artifact, outputPath, exitCode } = await runWriter(options);
  console.log(
    `[api-evidence] wrote ${outputPath} passed=${artifact.passed} environment=${artifact.environment} target=${artifact.target}`,
  );

  if (exitCode !== 0) {
    for (const failure of artifact.validationFailures) {
      console.error(`[api-evidence] ${failure}`);
    }
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[api-evidence] failed: ${summarizeHttpError(error)}`);
  process.exit(1);
});
