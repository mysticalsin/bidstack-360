#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/mcp-connectivity-latest.json';
const DEFAULT_SOURCE_CONTROL_PATH = 'deploy-evidence/source-control-latest.json';
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUIRED_TOOLS = [
  'opportunities.list',
  'contacts.list',
  'tasks.list',
  'crm_search_companies',
];
const DEFAULT_SMOKE_TOOL_NAME = 'crm_search_companies';
const DEFAULT_SMOKE_TOOL_ARGUMENTS = {
  crm_search_companies: {
    query: '__bidstack_release_probe_no_match__',
    limit: 1,
  },
  'opportunities.list': {
    search: '__bidstack_release_probe_no_match__',
    limit: 1,
  },
  'contacts.list': {
    customer: '__bidstack_release_probe_no_match__',
    limit: 1,
  },
  'tasks.list': {
    limit: 1,
  },
};

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
    outputPath: process.env.BIDSTACK_MCP_CONNECTIVITY_EVIDENCE ?? DEFAULT_OUTPUT_PATH,
    deployEnv: process.env.BIDSTACK_DEPLOY_ENV ?? process.env.NODE_ENV ?? 'unknown',
    target:
      process.env.BIDSTACK_MCP_CONNECTIVITY_TARGET ??
      process.env.BIDSTACK_MCP_PUBLIC_URL ??
      process.env.DUST_MCP_PUBLIC_URL ??
      process.env.MCP_BASE_URL ??
      '',
    apiToken:
      process.env.BIDSTACK_MCP_CONNECTIVITY_API_TOKEN ??
      process.env.MCP_API_TOKEN ??
      process.env.API_TOKEN ??
      '',
    requiredTools: parseRequiredTools(process.env.BIDSTACK_MCP_CONNECTIVITY_REQUIRED_TOOLS),
    smokeToolName: process.env.BIDSTACK_MCP_CONNECTIVITY_SMOKE_TOOL ?? DEFAULT_SMOKE_TOOL_NAME,
    smokeToolArgumentsJson: process.env.BIDSTACK_MCP_CONNECTIVITY_SMOKE_ARGS ?? '',
    sourceEvidencePath:
      process.env.BIDSTACK_SOURCE_CONTROL_EVIDENCE ?? DEFAULT_SOURCE_CONTROL_PATH,
    releaseCommit:
      process.env.BIDSTACK_MCP_CONNECTIVITY_RELEASE_COMMIT ??
      process.env.BIDSTACK_RELEASE_COMMIT ??
      process.env.BIDSTACK_CI_RELEASE_COMMIT ??
      '',
    releaseBranch:
      process.env.BIDSTACK_MCP_CONNECTIVITY_RELEASE_BRANCH ??
      process.env.BIDSTACK_RELEASE_BRANCH ??
      process.env.BIDSTACK_CI_BRANCH ??
      '',
    timeoutMs: Number(process.env.BIDSTACK_MCP_CONNECTIVITY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    protocolVersion:
      process.env.BIDSTACK_MCP_CONNECTIVITY_PROTOCOL_VERSION ?? DEFAULT_PROTOCOL_VERSION,
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
    } else if (arg === '--required-tools') {
      options.requiredTools = parseRequiredTools(next);
      index += 1;
    } else if (arg === '--smoke-tool') {
      options.smokeToolName = next;
      index += 1;
    } else if (arg === '--smoke-args') {
      options.smokeToolArgumentsJson = next;
      index += 1;
    } else if (arg === '--source-evidence') {
      options.sourceEvidencePath = next;
      index += 1;
    } else if (arg === '--release-commit') {
      options.releaseCommit = next;
      index += 1;
    } else if (arg === '--release-branch') {
      options.releaseBranch = next;
      index += 1;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(next);
      index += 1;
    } else if (arg === '--protocol-version') {
      options.protocolVersion = next;
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

  options.requiredTools =
    options.requiredTools.length > 0 ? options.requiredTools : [...DEFAULT_REQUIRED_TOOLS];
  options.smokeToolName = String(options.smokeToolName || DEFAULT_SMOKE_TOOL_NAME).trim();
  options.smokeToolArguments = resolveSmokeToolArguments(
    options.smokeToolName,
    options.smokeToolArgumentsJson,
  );

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/write-mcp-connectivity-evidence.mjs [options]

Writes deploy-evidence/mcp-connectivity-latest.json after a live MCP Streamable HTTP smoke.

Environment:
  BIDSTACK_MCP_CONNECTIVITY_TARGET          Public MCP base URL or /mcp URL
  BIDSTACK_MCP_CONNECTIVITY_API_TOKEN       Bearer token with mcp scope
  BIDSTACK_MCP_CONNECTIVITY_REQUIRED_TOOLS  Comma-separated required tool names
  BIDSTACK_MCP_CONNECTIVITY_SMOKE_TOOL      Read-only tool to call (default crm_search_companies)
  BIDSTACK_MCP_CONNECTIVITY_SMOKE_ARGS      JSON object args for smoke tool
  BIDSTACK_MCP_CONNECTIVITY_RELEASE_COMMIT  Optional expected release commit
  BIDSTACK_MCP_CONNECTIVITY_RELEASE_BRANCH  Optional expected release branch
  BIDSTACK_SOURCE_CONTROL_EVIDENCE          Source-control evidence fallback
  BIDSTACK_MCP_CONNECTIVITY_EVIDENCE        Output path
  BIDSTACK_MCP_CONNECTIVITY_TIMEOUT_MS      Per-request timeout
  BIDSTACK_DEPLOY_ENV                       Evidence environment label

Options:
  --target <url>             Override MCP target
  --api-token <token>        Override bearer token
  --required-tools <csv>     Override required tool names
  --smoke-tool <name>        Override read-only MCP tool call smoke
  --smoke-args <json>        Override smoke tool JSON arguments
  --source-evidence <path>   Source-control evidence fallback path
  --release-commit <sha>     Expected deployed release commit
  --release-branch <name>    Expected deployed release branch
  --output <path>            Override evidence output path
  --env <name>               Override deploy environment
  --timeout-ms <ms>          Override per-request timeout
  --strict / --non-strict    Toggle strict production checks
  --selftest                 Run offline contract tests
`);
}

function parseRequiredTools(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function resolveSmokeToolArguments(toolName, value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return { ...(DEFAULT_SMOKE_TOOL_ARGUMENTS[toolName] ?? { limit: 1 }) };
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP smoke tool arguments must be a JSON object.');
  }

  return parsed;
}

function normalizeTarget(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function normalizeMcpUrl(value) {
  const trimmed = normalizeTarget(value);
  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');

    if (!url.pathname.endsWith('/mcp')) {
      url.pathname = `${url.pathname}/mcp`.replace(/\/{2,}/g, '/');
    }

    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function deriveBaseUrl(mcpUrl) {
  try {
    const url = new URL(mcpUrl);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/mcp\/?$/, '') || '/';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return normalizeTarget(String(mcpUrl).replace(/\/mcp\/?$/, ''));
  }
}

function isFullCommitSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value ?? '').trim());
}

function resolveReleaseIdentity(options) {
  const explicitCommit = String(options.releaseCommit ?? '').trim();
  const explicitBranch = String(options.releaseBranch ?? '').trim();
  if (explicitCommit || explicitBranch) {
    return {
      source: 'env-or-cli',
      expectedCommit: explicitCommit || null,
      expectedBranch: explicitBranch || null,
    };
  }

  const sourcePath = resolveOutputPath(options.root, options.sourceEvidencePath);
  if (existsSync(sourcePath)) {
    try {
      const sourceEvidence = JSON.parse(readFileSync(sourcePath, 'utf8'));
      return {
        source: 'source-control-evidence',
        expectedCommit: String(sourceEvidence?.commit ?? '').trim() || null,
        expectedBranch: String(sourceEvidence?.branch ?? '').trim() || null,
      };
    } catch {
      return {
        source: 'source-control-evidence-unreadable',
        expectedCommit: null,
        expectedBranch: null,
      };
    }
  }

  return {
    source: 'missing',
    expectedCommit: null,
    expectedBranch: null,
  };
}

function summarizeReleaseMetadata(body) {
  const release = body?.release && typeof body.release === 'object' ? body.release : {};
  return {
    commit: String(release.commit ?? '').trim() || null,
    branch: String(release.branch ?? '').trim() || null,
  };
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

function validateLivePreconditions(options, releaseIdentity) {
  const failures = [];
  const mcpUrl = normalizeMcpUrl(options.target);

  if (!mcpUrl) {
    failures.push('MCP target is required.');
  } else {
    try {
      const parsed = new URL(mcpUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        failures.push(`MCP target must be HTTP(S), received ${parsed.protocol}.`);
      }
    } catch {
      failures.push('MCP target must be a valid URL.');
    }

    if (options.strict && isLocalTarget(mcpUrl)) {
      failures.push('Strict MCP connectivity proof must use a non-local public target.');
    }

    if (options.strict && isPlaceholderValue(mcpUrl)) {
      failures.push('Strict MCP connectivity proof cannot use a placeholder target.');
    }
  }

  const token = String(options.apiToken ?? '').trim();
  if (!token) {
    failures.push('MCP API token is required.');
  } else {
    if (options.strict && token.length < 24) {
      failures.push('Strict MCP API token must be at least 24 characters.');
    }

    if (options.strict && isPlaceholderValue(token)) {
      failures.push('Strict MCP API token cannot be a placeholder value.');
    }
  }

  for (const toolName of options.requiredTools) {
    if (isPlaceholderValue(toolName)) {
      failures.push(`Required MCP tool name is placeholder-like: ${toolName}.`);
    }
  }

  if (!options.smokeToolName) {
    failures.push('MCP smoke tool name is required.');
  } else if (isPlaceholderValue(options.smokeToolName)) {
    failures.push(`MCP smoke tool name is placeholder-like: ${options.smokeToolName}.`);
  }

  if (options.strict && !isFullCommitSha(releaseIdentity.expectedCommit)) {
    failures.push(
      'Strict MCP connectivity proof requires a full release commit from BIDSTACK_RELEASE_COMMIT or source-control evidence.',
    );
  }

  if (
    options.strict &&
    (!releaseIdentity.expectedBranch || isPlaceholderValue(releaseIdentity.expectedBranch))
  ) {
    failures.push(
      'Strict MCP connectivity proof requires a non-placeholder release branch from BIDSTACK_RELEASE_BRANCH or source-control evidence.',
    );
  }

  return failures;
}

function createRequestHeaders(options, sessionId) {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': options.protocolVersion,
    authorization: `Bearer ${options.apiToken}`,
  };

  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  return headers;
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
    headers: response.headers,
    body,
  };
}

async function readResponseBody(response) {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream')) {
    return readJsonFromEventStream(text);
  }

  return JSON.parse(text);
}

function readJsonFromEventStream(text) {
  const dataLines = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter((line) => line && line !== '[DONE]');

  if (dataLines.length === 0) {
    throw new Error('SSE response did not contain a data frame.');
  }

  return JSON.parse(dataLines.at(-1));
}

function normalizeDiscoveryEndpoints(value) {
  if (Array.isArray(value)) {
    return value.map((endpoint) => normalizeDiscoveryEndpoint(endpoint)).filter(Boolean);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, endpoint]) => normalizeDiscoveryEndpoint(endpoint, key))
      .filter(Boolean);
  }

  return [];
}

function normalizeDiscoveryEndpoint(endpoint, key = '') {
  if (typeof endpoint === 'string') {
    return { type: key || null, url: endpoint };
  }

  if (!endpoint || typeof endpoint !== 'object') {
    return null;
  }

  const url = String(endpoint.url ?? endpoint.href ?? endpoint.path ?? '').trim();
  if (!url) {
    return null;
  }

  return {
    type: String(endpoint.type ?? key ?? '').trim() || null,
    url,
  };
}

function hasMcpEndpoint(endpoints) {
  return endpoints.some((endpoint) => {
    const url = String(endpoint?.url ?? '')
      .trim()
      .replace(/\/+$/, '');
    if (url === '/mcp') {
      return true;
    }

    try {
      return new URL(url).pathname.replace(/\/+$/, '') === '/mcp';
    } catch {
      return false;
    }
  });
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

function getSmokeArgumentKeys(options) {
  return Object.keys(options.smokeToolArguments ?? {}).sort();
}

function makeSkippedToolCallCheck(options, error) {
  return {
    ok: false,
    skipped: true,
    toolName: options.smokeToolName,
    argumentKeys: getSmokeArgumentKeys(options),
    rawArgumentsIncluded: false,
    rawOutputIncluded: false,
    error,
  };
}

async function runToolCallSmoke(options, fetchFn, mcpUrl, sessionId) {
  try {
    const toolCall = await fetchJson(
      fetchFn,
      mcpUrl,
      {
        method: 'POST',
        headers: createRequestHeaders(options, sessionId),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: options.smokeToolName,
            arguments: options.smokeToolArguments,
          },
        }),
      },
      options.timeoutMs,
    );

    const result = toolCall.body?.result;
    const content = Array.isArray(result?.content) ? result.content : [];
    const structuredContentPresent = Boolean(result?.structuredContent);
    const jsonRpcErrorCode = toolCall.body?.error?.code ?? null;
    const resultIsError = result?.isError === true;

    return {
      ok:
        toolCall.ok &&
        Boolean(result) &&
        resultIsError !== true &&
        jsonRpcErrorCode === null &&
        (content.length > 0 || structuredContentPresent),
      status: toolCall.status,
      toolName: options.smokeToolName,
      argumentKeys: getSmokeArgumentKeys(options),
      contentItemCount: content.length,
      structuredContentPresent,
      resultIsError,
      jsonRpcErrorCode,
      rawArgumentsIncluded: false,
      rawOutputIncluded: false,
    };
  } catch (error) {
    return {
      ...makeFailedCheck(error),
      skipped: false,
      toolName: options.smokeToolName,
      argumentKeys: getSmokeArgumentKeys(options),
      rawArgumentsIncluded: false,
      rawOutputIncluded: false,
    };
  }
}

async function runLiveSmoke(options, fetchFn = globalThis.fetch) {
  const startedAt = new Date().toISOString();
  const mcpUrl = normalizeMcpUrl(options.target);
  const baseUrl = deriveBaseUrl(mcpUrl);
  const releaseIdentity = resolveReleaseIdentity(options);
  const preconditionFailures = validateLivePreconditions(options, releaseIdentity);

  const result = {
    source: 'live-mcp-smoke',
    target: options.target ? normalizeTarget(options.target) : '',
    mcpUrl,
    baseUrl,
    release: releaseIdentity,
    startedAt,
    completedAt: null,
    ok: false,
    discovery: { ok: false },
    health: { ok: false },
    initialize: { ok: false },
    initialized: { ok: false },
    toolsList: { ok: false, toolCount: 0, tools: [] },
    toolCall: makeSkippedToolCallCheck(options, 'MCP session was not established yet.'),
    closeSession: { ok: false, skipped: true },
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

  let sessionId = null;

  try {
    const discovery = await fetchJson(
      fetchFn,
      `${baseUrl}/.well-known/mcp`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
      options.timeoutMs,
    );
    const endpoints = normalizeDiscoveryEndpoints(discovery.body?.endpoints);
    result.discovery = {
      ok: discovery.ok && hasMcpEndpoint(endpoints),
      status: discovery.status,
      endpoints,
      server: discovery.body?.name ?? discovery.body?.serverInfo?.name ?? null,
      release: summarizeReleaseMetadata(discovery.body),
    };
  } catch (error) {
    result.discovery = makeFailedCheck(error);
  }

  try {
    const health = await fetchJson(
      fetchFn,
      `${baseUrl}/health`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
      options.timeoutMs,
    );
    result.health = {
      ok: health.ok && health.body?.ok === true,
      status: health.status,
      name: health.body?.name ?? null,
      db: health.body?.db ?? null,
      redis: health.body?.redis ?? null,
      release: summarizeReleaseMetadata(health.body),
    };
  } catch (error) {
    result.health = makeFailedCheck(error);
  }

  try {
    const initialize = await fetchJson(
      fetchFn,
      mcpUrl,
      {
        method: 'POST',
        headers: createRequestHeaders(options),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: options.protocolVersion,
            capabilities: {},
            clientInfo: {
              name: 'bidstack-release-evidence',
              version: '1.0.0',
            },
          },
        }),
      },
      options.timeoutMs,
    );

    sessionId =
      initialize.headers.get('mcp-session-id') ??
      initialize.headers.get('Mcp-Session-Id') ??
      initialize.body?.result?.sessionId ??
      null;

    result.initialize = {
      ok: initialize.ok && Boolean(initialize.body?.result) && Boolean(sessionId),
      status: initialize.status,
      protocolVersion: initialize.body?.result?.protocolVersion ?? null,
      serverInfo: initialize.body?.result?.serverInfo ?? null,
      sessionEstablished: Boolean(sessionId),
    };
  } catch (error) {
    result.initialize = makeFailedCheck(error);
  }

  if (sessionId) {
    try {
      const initialized = await fetchJson(
        fetchFn,
        mcpUrl,
        {
          method: 'POST',
          headers: createRequestHeaders(options, sessionId),
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {},
          }),
        },
        options.timeoutMs,
      );
      result.initialized = {
        ok: initialized.ok,
        status: initialized.status,
      };
    } catch (error) {
      result.initialized = makeFailedCheck(error);
    }

    try {
      const toolsList = await fetchJson(
        fetchFn,
        mcpUrl,
        {
          method: 'POST',
          headers: createRequestHeaders(options, sessionId),
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          }),
        },
        options.timeoutMs,
      );

      const tools = Array.isArray(toolsList.body?.result?.tools)
        ? toolsList.body.result.tools.map((tool) => tool?.name).filter(Boolean)
        : [];
      const missingRequiredTools = options.requiredTools.filter(
        (toolName) => !tools.includes(toolName),
      );

      result.toolsList = {
        ok: toolsList.ok && tools.length > 0 && missingRequiredTools.length === 0,
        status: toolsList.status,
        toolCount: tools.length,
        tools,
        missingRequiredTools,
      };
    } catch (error) {
      result.toolsList = makeFailedCheck(error);
    }

    result.toolCall = await runToolCallSmoke(options, fetchFn, mcpUrl, sessionId);

    try {
      const closeResponse = await fetchFn(mcpUrl, {
        method: 'DELETE',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${options.apiToken}`,
          'mcp-session-id': sessionId,
        },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      result.closeSession = {
        ok: closeResponse.ok,
        status: closeResponse.status,
        skipped: false,
      };
    } catch (error) {
      result.closeSession = {
        ...makeFailedCheck(error),
        skipped: false,
      };
    }
  } else {
    result.initialized = {
      ok: false,
      skipped: true,
      error: 'initialize did not establish an MCP session.',
    };
    result.toolsList = {
      ok: false,
      skipped: true,
      toolCount: 0,
      tools: [],
      error: 'initialize did not establish an MCP session.',
    };
    result.toolCall = makeSkippedToolCallCheck(
      options,
      'initialize did not establish an MCP session.',
    );
  }

  result.ok =
    result.discovery.ok === true &&
    result.health.ok === true &&
    result.initialize.ok === true &&
    result.initialized.ok === true &&
    result.toolsList.ok === true &&
    result.toolCall.ok === true;
  result.completedAt = new Date().toISOString();

  if (!result.ok) {
    result.error = 'One or more MCP connectivity checks failed.';
  }

  return result;
}

function buildArtifact(options, smoke) {
  const generatedAt = new Date().toISOString();
  const artifact = {
    schemaVersion: 1,
    generatedAt,
    runner: 'write-mcp-connectivity-evidence',
    environment: options.deployEnv,
    strict: options.strict,
    target: smoke.target,
    mcpUrl: smoke.mcpUrl,
    requiredTools: options.requiredTools,
    release: smoke.release,
    command: {
      source: smoke.source,
      ok: smoke.ok,
      startedAt: smoke.startedAt,
      completedAt: smoke.completedAt,
      error: smoke.error,
    },
    checks: {
      discovery: smoke.discovery,
      health: smoke.health,
      initialize: smoke.initialize,
      initialized: smoke.initialized,
      toolsList: smoke.toolsList,
      toolCall: smoke.toolCall,
      closeSession: smoke.closeSession,
    },
    tools: smoke.toolsList.tools ?? [],
    toolCount: smoke.toolsList.toolCount ?? 0,
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

  if (artifact.command.source !== 'live-mcp-smoke') {
    failures.push('MCP connectivity evidence must come from live-mcp-smoke.');
  }

  if (artifact.command.ok !== true) {
    failures.push('MCP connectivity smoke did not complete successfully.');
  }

  if (!artifact.mcpUrl) {
    failures.push('MCP evidence target is missing.');
  } else {
    if (options.strict && isLocalTarget(artifact.mcpUrl)) {
      failures.push('MCP evidence target must be non-local in strict mode.');
    }

    if (options.strict && isPlaceholderValue(artifact.mcpUrl)) {
      failures.push('MCP evidence target cannot be placeholder-like in strict mode.');
    }
  }

  for (const checkName of [
    'discovery',
    'health',
    'initialize',
    'initialized',
    'toolsList',
    'toolCall',
  ]) {
    if (artifact.checks?.[checkName]?.ok !== true) {
      failures.push(`MCP ${checkName} check failed.`);
    }
  }

  if (artifact.toolCount < 1) {
    failures.push('MCP tools/list returned no tools.');
  }

  const toolNames = new Set(artifact.tools ?? []);
  for (const requiredTool of options.requiredTools) {
    if (!toolNames.has(requiredTool)) {
      failures.push(`MCP tools/list missing required tool: ${requiredTool}.`);
    }
  }

  const toolCall = artifact.checks?.toolCall ?? {};
  if (!toolCall.toolName) {
    failures.push('MCP tools/call smoke tool name is missing.');
  } else if (!toolNames.has(toolCall.toolName)) {
    failures.push(`MCP tools/call smoke tool is not in tools/list: ${toolCall.toolName}.`);
  }

  if (toolCall.rawArgumentsIncluded !== false) {
    failures.push('MCP tools/call evidence must not include raw arguments.');
  }

  if (toolCall.rawOutputIncluded !== false) {
    failures.push('MCP tools/call evidence must not include raw output.');
  }

  if ('content' in toolCall || 'result' in toolCall || 'rawOutput' in toolCall) {
    failures.push('MCP tools/call evidence contains raw result content.');
  }

  const release = artifact.release && typeof artifact.release === 'object' ? artifact.release : {};
  const expectedCommit = String(release.expectedCommit ?? '').trim();
  const expectedBranch = String(release.expectedBranch ?? '').trim();
  if (options.strict && !isFullCommitSha(expectedCommit)) {
    failures.push('MCP release identity must include a full expected commit SHA.');
  }
  if (options.strict && (!expectedBranch || isPlaceholderValue(expectedBranch))) {
    failures.push('MCP release identity must include a non-placeholder expected branch.');
  }

  for (const checkName of ['discovery', 'health']) {
    const observedRelease = artifact.checks?.[checkName]?.release ?? {};
    const observedCommit = String(observedRelease.commit ?? '').trim();
    const observedBranch = String(observedRelease.branch ?? '').trim();

    if (options.strict && observedCommit !== expectedCommit) {
      failures.push(
        `MCP ${checkName} release commit ${observedCommit || 'missing'} does not match ${expectedCommit || 'missing'}.`,
      );
    }

    if (options.strict && observedBranch !== expectedBranch) {
      failures.push(
        `MCP ${checkName} release branch ${observedBranch || 'missing'} does not match ${expectedBranch || 'missing'}.`,
      );
    }
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

function makeJsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function makeTextResponse(payload, status = 200, headers = {}) {
  return new Response(payload, {
    status,
    headers,
  });
}

function createFakeMcpFetch({
  tools = DEFAULT_REQUIRED_TOOLS,
  discoveryEndpoints = ['/mcp'],
  discoveryShape = 'object',
  toolCallOk = true,
  release = {
    commit: '0123456789abcdef0123456789abcdef01234567',
    branch: 'main',
  },
} = {}) {
  const calls = [];

  const fetchFn = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = String(init.method ?? 'GET').toUpperCase();
    calls.push({ url: parsed.toString(), method });

    if (method === 'GET' && parsed.pathname.endsWith('/.well-known/mcp')) {
      const endpoints =
        discoveryShape === 'object'
          ? Object.fromEntries(discoveryEndpoints.map((endpoint) => [endpoint.slice(1), endpoint]))
          : discoveryEndpoints.map((endpoint) => ({
              type: endpoint === '/mcp' ? 'streamable-http' : 'sse',
              url: endpoint,
            }));

      return makeJsonResponse({
        name: 'BidStack 360 MCP',
        release,
        endpoints,
      });
    }

    if (method === 'GET' && parsed.pathname.endsWith('/health')) {
      return makeJsonResponse({
        ok: true,
        name: 'bidstack-mcp',
        db: 'up',
        redis: 'up',
        release,
      });
    }

    if (method === 'DELETE' && parsed.pathname.endsWith('/mcp')) {
      return makeJsonResponse({ ok: true });
    }

    if (method === 'POST' && parsed.pathname.endsWith('/mcp')) {
      const body = JSON.parse(String(init.body ?? '{}'));

      if (body.method === 'initialize') {
        return makeJsonResponse(
          {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: DEFAULT_PROTOCOL_VERSION,
              serverInfo: { name: 'BidStack 360 MCP' },
            },
          },
          200,
          {
            'mcp-session-id': 'selftest-session-1',
          },
        );
      }

      if (body.method === 'notifications/initialized') {
        return makeTextResponse('', 202, { 'content-type': 'application/json' });
      }

      if (body.method === 'tools/list') {
        return makeTextResponse(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: tools.map((name) => ({ name })),
            },
          })}\n\n`,
          200,
          {
            'content-type': 'text/event-stream',
          },
        );
      }

      if (body.method === 'tools/call') {
        if (!toolCallOk) {
          return makeTextResponse(
            `event: message\ndata: ${JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [{ type: 'text', text: 'Tool denied' }],
                isError: true,
              },
            })}\n\n`,
            200,
            {
              'content-type': 'text/event-stream',
            },
          );
        }

        return makeTextResponse(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{ type: 'text', text: '[]' }],
            },
          })}\n\n`,
          200,
          {
            'content-type': 'text/event-stream',
          },
        );
      }
    }

    return makeJsonResponse({ error: 'unexpected selftest request' }, 404);
  };

  fetchFn.calls = calls;
  return fetchFn;
}

async function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidstack-mcp-evidence-'));

  try {
    const baseOptions = {
      root,
      outputPath: DEFAULT_OUTPUT_PATH,
      deployEnv: 'production',
      target: 'https://mcp.release.bidstack360.com',
      apiToken: 'release_mcp_token_1234567890abcdef',
      requiredTools: [...DEFAULT_REQUIRED_TOOLS],
      smokeToolName: DEFAULT_SMOKE_TOOL_NAME,
      smokeToolArguments: { ...DEFAULT_SMOKE_TOOL_ARGUMENTS[DEFAULT_SMOKE_TOOL_NAME] },
      sourceEvidencePath: DEFAULT_SOURCE_CONTROL_PATH,
      releaseCommit: '0123456789abcdef0123456789abcdef01234567',
      releaseBranch: 'main',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      strict: true,
    };

    const goodFetch = createFakeMcpFetch();
    const good = await runWriter(baseOptions, { fetchFn: goodFetch });
    assert.equal(
      good.exitCode,
      0,
      [good.artifact.command.error, ...good.artifact.validationFailures].filter(Boolean).join('\n'),
    );
    assert.equal(good.artifact.passed, true);
    assert.equal(good.artifact.checks.initialize.sessionEstablished, true);
    assert.equal(good.artifact.checks.discovery.release.commit, baseOptions.releaseCommit);
    assert.equal(good.artifact.checks.toolsList.toolCount, DEFAULT_REQUIRED_TOOLS.length);
    assert.equal(good.artifact.checks.toolCall.ok, true);
    assert.equal(good.artifact.checks.toolCall.toolName, DEFAULT_SMOKE_TOOL_NAME);
    assert.equal(good.artifact.checks.toolCall.rawOutputIncluded, false);
    assert.equal(good.artifact.checks.toolCall.rawArgumentsIncluded, false);
    assert.equal(existsSync(good.outputPath), true);

    const missingTool = await runWriter(
      {
        ...baseOptions,
        outputPath: 'missing-tool.json',
      },
      {
        fetchFn: createFakeMcpFetch({
          tools: DEFAULT_REQUIRED_TOOLS.filter((toolName) => toolName !== 'contacts.list'),
        }),
      },
    );
    assert.equal(missingTool.exitCode, 1);
    assert.match(missingTool.artifact.validationFailures.join('\n'), /contacts\.list/);

    const badDiscovery = await runWriter(
      {
        ...baseOptions,
        outputPath: 'bad-discovery.json',
      },
      {
        fetchFn: createFakeMcpFetch({ discoveryEndpoints: ['/mcp/sse'] }),
      },
    );
    assert.equal(badDiscovery.exitCode, 1);
    assert.match(badDiscovery.artifact.validationFailures.join('\n'), /discovery/);

    const failedToolCall = await runWriter(
      {
        ...baseOptions,
        outputPath: 'failed-tool-call.json',
      },
      {
        fetchFn: createFakeMcpFetch({ toolCallOk: false }),
      },
    );
    assert.equal(failedToolCall.exitCode, 1);
    assert.match(failedToolCall.artifact.validationFailures.join('\n'), /toolCall/);

    const releaseMismatch = await runWriter(
      {
        ...baseOptions,
        outputPath: 'release-mismatch.json',
      },
      {
        fetchFn: createFakeMcpFetch({
          release: {
            commit: 'ffffffffffffffffffffffffffffffffffffffff',
            branch: 'main',
          },
        }),
      },
    );
    assert.equal(releaseMismatch.exitCode, 1);
    assert.match(releaseMismatch.artifact.validationFailures.join('\n'), /release commit/);

    const localTarget = await runWriter(
      {
        ...baseOptions,
        outputPath: 'local-target.json',
        target: 'http://localhost:3003',
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

    const parsed = JSON.parse(readFileSync(good.outputPath, 'utf8'));
    assert.equal(parsed.command.source, 'live-mcp-smoke');
    assert.equal(parsed.requiredTools.length, DEFAULT_REQUIRED_TOOLS.length);
    assert.equal('content' in parsed.checks.toolCall, false);
    assert.equal('result' in parsed.checks.toolCall, false);

    console.log('[mcp-evidence] selftest passed');
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
    `[mcp-evidence] wrote ${outputPath} passed=${artifact.passed} environment=${artifact.environment} tools=${artifact.toolCount}`,
  );

  if (exitCode !== 0) {
    for (const failure of artifact.validationFailures) {
      console.error(`[mcp-evidence] ${failure}`);
    }
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[mcp-evidence] failed: ${summarizeHttpError(error)}`);
  process.exit(1);
});
