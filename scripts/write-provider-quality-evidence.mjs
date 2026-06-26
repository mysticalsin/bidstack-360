#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/provider-quality-latest.json';
const DEFAULT_REQUIRED_PROVIDERS = ['apollo', 'seamless', 'tech_intel'];
const DEFAULT_TIMEOUT_MS = 45_000;
const PROVIDER_LABELS = {
  apollo: 'Apollo',
  seamless: 'Seamless.AI',
  tech_intel: 'Tech Intel MCP',
  open_data: 'Open data',
};
const PLACEHOLDER_EXACT_VALUES = new Set([
  'abc123',
  'change-me',
  'changeme',
  'dummy',
  'fake',
  'release-api-token',
  'release-token',
  'sample',
  'super-secret',
  'super-secret-token',
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
    outputPath: process.env.BIDSTACK_PROVIDER_QUALITY_EVIDENCE || DEFAULT_OUTPUT_PATH,
    deployEnv: process.env.BIDSTACK_DEPLOY_ENV || 'staging',
    target:
      process.env.BIDSTACK_PROVIDER_QUALITY_TARGET ||
      process.env.BIDSTACK_PROVIDER_API_BASE_URL ||
      process.env.API_BASE_URL ||
      '',
    apiToken: process.env.BIDSTACK_PROVIDER_QUALITY_API_TOKEN || process.env.API_TOKEN || '',
    companyKey: process.env.BIDSTACK_PROVIDER_QUALITY_COMPANY_KEY || '',
    responsePath: process.env.BIDSTACK_PROVIDER_QUALITY_RESPONSE || '',
    timeoutMs: Number(process.env.BIDSTACK_PROVIDER_QUALITY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    requiredProviders: parseList(
      process.env.BIDSTACK_PROVIDER_QUALITY_REQUIRED,
      DEFAULT_REQUIRED_PROVIDERS,
    ),
    expectedTechIntelSources: parseDisplayList(
      process.env.BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES,
      [],
    ),
    allowApolloQueued:
      parseOptionalBoolean(process.env.BIDSTACK_PROVIDER_QUALITY_ALLOW_APOLLO_QUEUED) ?? true,
    strict: process.env.BIDSTACK_PROVIDER_QUALITY_STRICT !== 'false',
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
      parsed.deployEnv = argv[index + 1] ?? parsed.deployEnv;
      index += 1;
    } else if (arg.startsWith('--env=')) {
      parsed.deployEnv = arg.slice('--env='.length);
    } else if (arg === '--target') {
      parsed.target = argv[index + 1] ?? parsed.target;
      index += 1;
    } else if (arg.startsWith('--target=')) {
      parsed.target = arg.slice('--target='.length);
    } else if (arg === '--api-token') {
      parsed.apiToken = argv[index + 1] ?? parsed.apiToken;
      index += 1;
    } else if (arg.startsWith('--api-token=')) {
      parsed.apiToken = arg.slice('--api-token='.length);
    } else if (arg === '--company-key') {
      parsed.companyKey = argv[index + 1] ?? parsed.companyKey;
      index += 1;
    } else if (arg.startsWith('--company-key=')) {
      parsed.companyKey = arg.slice('--company-key='.length);
    } else if (arg === '--response') {
      parsed.responsePath = argv[index + 1] ?? parsed.responsePath;
      index += 1;
    } else if (arg.startsWith('--response=')) {
      parsed.responsePath = arg.slice('--response='.length);
    } else if (arg === '--required') {
      parsed.requiredProviders = parseList(argv[index + 1], DEFAULT_REQUIRED_PROVIDERS);
      index += 1;
    } else if (arg.startsWith('--required=')) {
      parsed.requiredProviders = parseList(arg.slice('--required='.length), DEFAULT_REQUIRED_PROVIDERS);
    } else if (arg === '--tech-intel-sources') {
      parsed.expectedTechIntelSources = parseDisplayList(argv[index + 1], []);
      index += 1;
    } else if (arg.startsWith('--tech-intel-sources=')) {
      parsed.expectedTechIntelSources = parseDisplayList(arg.slice('--tech-intel-sources='.length), []);
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = parseRequiredPositiveInteger(argv[index + 1], arg);
      index += 1;
    } else if (arg.startsWith('--timeout-ms=')) {
      parsed.timeoutMs = parseRequiredPositiveInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
    } else if (arg === '--require-apollo-signal') {
      parsed.allowApolloQueued = false;
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

  parsed.root = path.resolve(parsed.root);
  parsed.deployEnv = normalizeEnvironment(parsed.deployEnv);
  parsed.target = normalizeTarget(parsed.target);
  parsed.apiToken = String(parsed.apiToken || '').trim();
  parsed.companyKey = String(parsed.companyKey || '').trim();
  parsed.responsePath = parsed.responsePath ? path.resolve(parsed.root, parsed.responsePath) : '';
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error(`Invalid timeout: ${parsed.timeoutMs}`);
  }
  parsed.requiredProviders = normalizeRequiredProviders(parsed.requiredProviders);
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack provider quality evidence writer

Usage:
  node scripts/write-provider-quality-evidence.mjs --target https://staging-api.example --company-key ci-financial
  node scripts/write-provider-quality-evidence.mjs --response deploy-evidence/provider-refresh.json --target https://staging-api.example --company-key ci-financial
  node scripts/write-provider-quality-evidence.mjs --selftest

Environment:
  BIDSTACK_PROVIDER_QUALITY_EVIDENCE
  BIDSTACK_PROVIDER_QUALITY_TARGET / BIDSTACK_PROVIDER_API_BASE_URL / API_BASE_URL
  BIDSTACK_PROVIDER_QUALITY_API_TOKEN / API_TOKEN
  BIDSTACK_PROVIDER_QUALITY_COMPANY_KEY
  BIDSTACK_PROVIDER_QUALITY_RESPONSE
  BIDSTACK_PROVIDER_QUALITY_REQUIRED=apollo,seamless,tech_intel
  BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES=BuiltWith MCP,Wappalyzer MCP
  BIDSTACK_PROVIDER_QUALITY_ALLOW_APOLLO_QUEUED=true
  BIDSTACK_PROVIDER_QUALITY_STRICT=false
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

function parseRequiredPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseList(value, fallback) {
  const source = String(value || '').trim() ? String(value) : fallback.join(',');
  return source
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseDisplayList(value, fallback) {
  const source = String(value || '').trim() ? String(value) : fallback.join(',');
  return source
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRequiredProviders(providers) {
  const allowed = new Set(['apollo', 'seamless', 'tech_intel', 'open_data']);
  const normalized = [];
  for (const provider of providers) {
    if (!allowed.has(provider)) {
      throw new Error(`Unsupported provider quality requirement: ${provider}`);
    }
    if (!normalized.includes(provider)) normalized.push(provider);
  }
  return normalized.length > 0 ? normalized : DEFAULT_REQUIRED_PROVIDERS;
}

function normalizeTarget(value) {
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

function technicalStackRefreshUrl(target, companyKey) {
  const base = normalizeTarget(target);
  const prefix = base.endsWith('/api/v1') ? '' : '/api/v1';
  return `${base}${prefix}/crm/companies/${encodeURIComponent(companyKey)}/technical-stack/refresh`;
}

function redact(text) {
  return String(text || '')
    .replace(/(Authorization:\s*Bearer\s+)[^\s"'`,;]+/gi, '$1<redacted>')
    .replace(/\b((?:API_TOKEN|BIDSTACK_PROVIDER_QUALITY_API_TOKEN)\s*[:=]\s*)[^\s"'`,;]+/gi, '$1<redacted>')
    .replace(/("authorization"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2');
}

async function fetchRefreshResponse(options, deps = {}) {
  const startedAt = new Date();
  const fetchFn = deps.fetchFn ?? fetch;
  const failures = [];
  if (!options.target) failures.push('Provider quality target is required');
  if (options.strict && isLocalTarget(options.target)) {
    failures.push(`Provider quality target is local or invalid: ${options.target || 'missing'}`);
  }
  if (options.strict && hasPlaceholderSignal(options.target)) {
    failures.push(`Provider quality target looks like placeholder evidence: ${options.target || 'missing'}`);
  }
  if (!options.companyKey) failures.push('Provider quality company key is required');
  if (options.strict && hasPlaceholderSignal(options.companyKey)) {
    failures.push('Provider quality company key looks like placeholder evidence');
  }
  if (!options.apiToken) failures.push('Provider quality API token is required');
  if (options.strict && hasPlaceholderSignal(options.apiToken)) {
    failures.push('Provider quality API token looks like placeholder evidence');
  }
  if (options.strict && options.apiToken && options.apiToken.length < 24) {
    failures.push('Provider quality API token is too short for release evidence');
  }
  if (failures.length > 0) {
    return {
      source: 'live-refresh',
      url: options.target ? technicalStackRefreshUrl(options.target, options.companyKey || '<missing>') : '',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: null,
      ok: false,
      response: null,
      error: failures.join('; '),
    };
  }

  const url = technicalStackRefreshUrl(options.target, options.companyKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      source: 'live-refresh',
      url,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: response.status,
      ok: response.ok,
      response: text ? JSON.parse(text) : null,
      error: response.ok ? '' : redact(text).slice(0, 2000),
    };
  } catch (error) {
    return {
      source: 'live-refresh',
      url,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: null,
      ok: false,
      response: null,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readFixtureResponse(options) {
  if (!existsSync(options.responsePath)) {
    return {
      source: 'response-file',
      url: '',
      status: null,
      ok: false,
      response: null,
      error: `Response fixture is missing: ${options.responsePath}`,
    };
  }
  try {
    return {
      source: 'response-file',
      url: '',
      status: 200,
      ok: true,
      response: JSON.parse(readFileSync(options.responsePath, 'utf8')),
      error: '',
    };
  } catch (error) {
    return {
      source: 'response-file',
      url: '',
      status: null,
      ok: false,
      response: null,
      error: error.message,
    };
  }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedSource(value) {
  return String(value || '').trim().toLowerCase();
}

function responseStackCategories(response) {
  const state = response && typeof response === 'object' ? response.state : null;
  return [
    ...array(state?.providerStack),
    ...array(state?.effectiveStack),
    ...array(state?.suggestions).map((suggestion) => ({
      label: suggestion?.label ?? 'Provider suggestion',
      items: [suggestion?.item].filter(Boolean),
    })),
  ];
}

function flattenStackItems(response) {
  return responseStackCategories(response).flatMap((category) => array(category?.items));
}

function sourceSignalCounts(response) {
  const counts = {
    apollo: 0,
    seamless: 0,
    tech_intel: 0,
    open_data: 0,
  };
  for (const item of flattenStackItems(response)) {
    const source = normalizedSource(item?.source);
    if (source.includes('apollo')) counts.apollo += 1;
    if (source.includes('seamless')) counts.seamless += 1;
    if (source.includes('tech_stack_mcp') || source.includes('tech intel')) counts.tech_intel += 1;
    if (source.includes('wikidata') || source.includes('open') || source.includes('company_website')) {
      counts.open_data += 1;
    }
  }
  return counts;
}

function providerMap(response) {
  return new Map(array(response?.providers).map((provider) => [provider?.id, provider]));
}

function normalizeComparable(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\btechnologies\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function cleanTechIntelLabel(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+technologies$/i, '')
    .trim();
  return cleaned || 'Tech Intel MCP';
}

function techIntelSourceKeyFromItem(item) {
  const source = String(item?.source || '');
  const match = /tech_stack_mcp(?::([^:\s]+))?/i.exec(source);
  return match?.[1] ? match[1].trim() : '';
}

function collectTechIntelSources(response) {
  const byKey = new Map();
  for (const category of responseStackCategories(response)) {
    const label = cleanTechIntelLabel(category?.label);
    for (const item of array(category?.items)) {
      const source = normalizedSource(item?.source);
      if (!source.includes('tech_stack_mcp') && !source.includes('tech intel')) continue;
      const sourceKey = techIntelSourceKeyFromItem(item);
      const comparable = normalizeComparable(sourceKey || label);
      if (!comparable) continue;
      const existing = byKey.get(comparable) ?? {
        label,
        sourceKey: sourceKey || null,
        signalCount: 0,
        technologies: [],
      };
      existing.signalCount += 1;
      const technology = String(item?.name || '').trim();
      if (technology && !existing.technologies.includes(technology)) {
        existing.technologies.push(technology);
      }
      byKey.set(comparable, existing);
    }
  }
  return [...byKey.values()];
}

function missingExpectedTechIntelSources(expectedSources, observedSources) {
  const observed = new Set(
    observedSources.flatMap((source) => [
      normalizeComparable(source.label),
      normalizeComparable(source.sourceKey),
    ]),
  );
  return array(expectedSources).filter((source) => !observed.has(normalizeComparable(source)));
}

function buildProviderChecks(response, options) {
  const providers = providerMap(response);
  const counts = sourceSignalCounts(response);
  const techIntelSources = collectTechIntelSources(response);
  return options.requiredProviders.map((id) => {
    const provider = providers.get(id);
    const status = provider?.status ?? 'missing';
    const transport = provider?.transport ?? null;
    const signalCount = counts[id] ?? 0;
    const failures = [];

    if (!provider) {
      failures.push(`${PROVIDER_LABELS[id] ?? id} provider lane is missing`);
    } else if (id === 'apollo') {
      const queuedAccepted = options.allowApolloQueued && status === 'queued';
      const syncedWithSignals = status === 'synced' && signalCount > 0;
      if (!queuedAccepted && !syncedWithSignals) {
        failures.push('Apollo must be queued for async enrichment or synced with source signals');
      }
      if (!['mcp', 'api', 'queue'].includes(String(transport))) {
        failures.push('Apollo transport must be mcp, api, or queue');
      }
    } else if (id === 'seamless') {
      if (status !== 'synced') failures.push('Seamless must be synced for release evidence');
      if (!['mcp', 'api'].includes(String(transport))) failures.push('Seamless transport must be mcp or api');
      if (signalCount < 1) failures.push('Seamless must return at least one technology signal');
    } else if (id === 'tech_intel') {
      if (status !== 'synced') failures.push('Tech Intel MCP must be synced for release evidence');
      if (transport !== 'mcp') failures.push('Tech Intel transport must be mcp');
      if (signalCount < 1) failures.push('Tech Intel MCP must return at least one technology signal');
      const missingSources = missingExpectedTechIntelSources(
        options.expectedTechIntelSources,
        techIntelSources,
      );
      if (missingSources.length > 0) {
        failures.push(`Tech Intel MCP is missing expected source evidence: ${missingSources.join(', ')}`);
      }
    } else if (id === 'open_data') {
      if (status !== 'synced') failures.push('Open data must be synced');
      if (transport !== 'open_data') failures.push('Open data transport must be open_data');
    }

    return {
      id,
      label: provider?.label ?? PROVIDER_LABELS[id] ?? id,
      status,
      transport,
      signalCount,
      ...(id === 'tech_intel'
        ? {
            expectedSources: options.expectedTechIntelSources,
            observedSources: techIntelSources.map((source) => ({
              label: source.label,
              sourceKey: source.sourceKey,
              signalCount: source.signalCount,
            })),
          }
        : {}),
      passed: failures.length === 0,
      failures,
      message: provider?.message ?? '',
    };
  });
}

function validateArtifact(artifact, options) {
  const failures = [];
  if (artifact.command.ok !== true) {
    failures.push(artifact.command.error || 'provider refresh command did not succeed');
  }
  if (options.strict && artifact.command.source !== 'live-refresh') {
    failures.push('strict provider evidence must come from a live refresh');
  }
  if (options.strict && isLocalTarget(artifact.target)) {
    failures.push(`provider quality target is local or invalid: ${artifact.target || 'missing'}`);
  }
  if (options.strict && hasPlaceholderSignal(artifact.target)) {
    failures.push(`provider quality target looks like placeholder evidence: ${artifact.target || 'missing'}`);
  }
  if (!artifact.companyKey) {
    failures.push('provider quality company key is missing');
  } else if (options.strict && hasPlaceholderSignal(artifact.companyKey)) {
    failures.push('provider quality company key looks like placeholder evidence');
  }
  if (options.strict && artifact.expectedTechIntelSources.some((source) => hasPlaceholderSignal(source))) {
    failures.push('expected Tech Intel source list looks like placeholder evidence');
  }

  for (const check of artifact.providerChecks) {
    if (check.passed !== true) {
      failures.push(`${check.id}: ${check.failures.join('; ') || 'provider check failed'}`);
    }
  }
  return failures;
}

function responseSummary(response) {
  return {
    providers: array(response?.providers).map((provider) => ({
      id: provider?.id,
      status: provider?.status,
      transport: provider?.transport ?? null,
      label: provider?.label,
    })),
    suggestionCount: array(response?.state?.suggestions).length,
    providerCategoryCount: array(response?.state?.providerStack).length,
    effectiveCategoryCount: array(response?.state?.effectiveStack).length,
  };
}

function buildArtifact(options, commandResult) {
  const response = commandResult.response;
  const providerChecks = buildProviderChecks(response, options);
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: 'provider-quality-evidence',
    environment: options.deployEnv,
    target: options.target,
    companyKey: options.companyKey,
    requiredProviders: options.requiredProviders,
    expectedTechIntelSources: options.expectedTechIntelSources,
    allowApolloQueued: options.allowApolloQueued,
    strict: options.strict,
    command: {
      source: commandResult.source,
      url: redact(commandResult.url),
      status: commandResult.status,
      ok: commandResult.ok,
      startedAt: commandResult.startedAt,
      completedAt: commandResult.completedAt,
      error: commandResult.error ? redact(commandResult.error) : '',
    },
    providerChecks,
    sourceSignalCounts: sourceSignalCounts(response),
    techIntelSources: collectTechIntelSources(response),
    responseSummary: responseSummary(response),
  };
  const validationFailures = validateArtifact(artifact, options);
  return {
    ...artifact,
    passed: validationFailures.length === 0,
    validationFailures,
  };
}

function writeArtifact(root, outputPath, artifact) {
  const absolutePath = path.resolve(root, outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return absolutePath;
}

async function runWriter(options, deps = {}) {
  const commandResult = options.responsePath
    ? readFixtureResponse(options)
    : await fetchRefreshResponse(options, deps);
  const artifact = buildArtifact(options, commandResult);
  const absolutePath = writeArtifact(options.root, options.outputPath, artifact);

  process.stdout.write(`Provider quality evidence: ${path.relative(options.root, absolutePath)}\n`);
  process.stdout.write(`Target: ${artifact.target || 'missing'}\n`);
  process.stdout.write(`Company key: ${artifact.companyKey || 'missing'}\n`);
  for (const check of artifact.providerChecks) {
    const prefix = check.passed ? 'PASS' : 'FAIL';
    process.stdout.write(
      `${prefix} ${check.label}: status=${check.status} transport=${check.transport ?? 'none'} signals=${check.signalCount}\n`,
    );
    for (const failure of check.failures) {
      process.stderr.write(`FAIL ${check.id}: ${failure}\n`);
    }
  }
  for (const failure of artifact.validationFailures.filter((failure) => !failure.includes(':'))) {
    process.stderr.write(`FAIL ${failure}\n`);
  }
  if (!artifact.passed) return 1;
  process.stdout.write('Provider quality evidence passed\n');
  return 0;
}

function createRefreshResponse(overrides = {}) {
  return {
    state: {
      companyKey: 'ci-financial',
      manualStack: [],
      providerStack: [
        { label: 'CRM', items: [{ name: 'Salesforce', source: 'apollo' }] },
        { label: 'Data', items: [{ name: 'Snowflake', source: 'enrichment:seamless' }] },
        {
          label: 'BuiltWith MCP technologies',
          items: [{ name: 'Okta', source: 'enrichment:tech_stack_mcp:builtwith_mcp' }],
        },
        {
          label: 'Wappalyzer MCP technologies',
          items: [{ name: 'Datadog', source: 'enrichment:tech_stack_mcp:wappalyzer_mcp' }],
        },
      ],
      effectiveStack: [],
      suggestions: [],
      updatedAt: new Date().toISOString(),
    },
    providers: [
      {
        id: 'apollo',
        label: 'Apollo',
        status: 'queued',
        transport: 'mcp',
        message: 'Apollo company intelligence queued.',
        lastCheckedAt: new Date().toISOString(),
      },
      {
        id: 'seamless',
        label: 'Seamless.AI',
        status: 'synced',
        transport: 'mcp',
        message: 'Seamless.AI MCP returned company technology signals.',
        lastCheckedAt: new Date().toISOString(),
      },
      {
        id: 'tech_intel',
        label: '2 Tech Intel MCPs',
        status: 'synced',
        transport: 'mcp',
        message: '2 Tech Intel MCPs returned company technology signals.',
        lastCheckedAt: new Date().toISOString(),
      },
      {
        id: 'open_data',
        label: 'Open data',
        status: 'synced',
        transport: 'open_data',
        message: 'Open company verification checked public profile sources.',
        lastCheckedAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

function baseOptions(root, overrides = {}) {
  return {
    root,
    outputPath: 'provider-quality-test.json',
    deployEnv: 'staging',
    target: 'https://api.release.bidstack360.com',
    apiToken: 'release_live_1234567890abcdef',
    companyKey: 'mantu-global-finance',
    responsePath: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    requiredProviders: DEFAULT_REQUIRED_PROVIDERS,
    expectedTechIntelSources: [],
    allowApolloQueued: true,
    strict: true,
    ...overrides,
  };
}

async function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidcrm-provider-quality-'));
  try {
    const fixturePath = path.join(root, 'refresh.json');
    writeFileSync(fixturePath, `${JSON.stringify(createRefreshResponse(), null, 2)}\n`, 'utf8');
    const fixtureOptions = (overrides = {}) =>
      baseOptions(root, { responsePath: fixturePath, strict: false, ...overrides });

    const strictFixture = await runWriter(baseOptions(root, { responsePath: fixturePath }));
    assert.notEqual(strictFixture, 0, 'expected strict response-file provider evidence to fail');

    const good = await runWriter(fixtureOptions());
    assert.equal(good, 0, 'expected clean provider fixture to pass');

    const expectedSources = await runWriter(
      fixtureOptions({
        expectedTechIntelSources: ['BuiltWith MCP', 'Wappalyzer MCP'],
      }),
    );
    assert.equal(expectedSources, 0, 'expected named Tech Intel sources to pass');

    const missingExpectedSource = await runWriter(
      fixtureOptions({
        expectedTechIntelSources: ['BuiltWith MCP', 'Wappalyzer MCP', 'Private Gateway MCP'],
      }),
    );
    assert.notEqual(missingExpectedSource, 0, 'expected missing named Tech Intel source to fail');

    const noTechIntelPath = path.join(root, 'missing-tech-intel.json');
    writeFileSync(
      noTechIntelPath,
      `${JSON.stringify(
        createRefreshResponse({
          providers: createRefreshResponse().providers.filter((provider) => provider.id !== 'tech_intel'),
        }),
        null,
        2,
      )}\n`,
      'utf8',
    );
    const missingTechIntel = await runWriter(fixtureOptions({ responsePath: noTechIntelPath }));
    assert.notEqual(missingTechIntel, 0, 'expected missing Tech Intel provider to fail');

    const weakSeamlessPath = path.join(root, 'weak-seamless.json');
    const weakSeamless = createRefreshResponse();
    weakSeamless.providers = weakSeamless.providers.map((provider) =>
      provider.id === 'seamless' ? { ...provider, status: 'unavailable' } : provider,
    );
    weakSeamless.state.providerStack = weakSeamless.state.providerStack.filter(
      (category) => !category.items.some((item) => String(item.source).includes('seamless')),
    );
    writeFileSync(weakSeamlessPath, `${JSON.stringify(weakSeamless, null, 2)}\n`, 'utf8');
    const unavailableSeamless = await runWriter(fixtureOptions({ responsePath: weakSeamlessPath }));
    assert.notEqual(unavailableSeamless, 0, 'expected unavailable Seamless provider to fail');

    const localTarget = await runWriter(
      baseOptions(root, { responsePath: fixturePath, target: 'http://127.0.0.1:4000' }),
    );
    assert.notEqual(localTarget, 0, 'expected local strict provider target to fail');

    const placeholderTarget = await runWriter(
      baseOptions(root, { responsePath: '', target: 'https://staging-api.bidstack.example' }),
      {
        fetchFn: async () => {
          throw new Error('fetch should not run when target is placeholder evidence');
        },
      },
    );
    assert.notEqual(placeholderTarget, 0, 'expected placeholder provider target to fail');

    const placeholderCompanyKey = await runWriter(
      baseOptions(root, { responsePath: '', companyKey: '<company-key>' }),
      {
        fetchFn: async () => {
          throw new Error('fetch should not run when company key is placeholder evidence');
        },
      },
    );
    assert.notEqual(placeholderCompanyKey, 0, 'expected placeholder company key to fail');

    const placeholderToken = await runWriter(
      baseOptions(root, { responsePath: '', apiToken: 'release-token' }),
      {
        fetchFn: async () => {
          throw new Error('fetch should not run when token is placeholder evidence');
        },
      },
    );
    assert.notEqual(placeholderToken, 0, 'expected placeholder API token to fail');

    const shortToken = await runWriter(baseOptions(root, { responsePath: '', apiToken: 'short' }), {
      fetchFn: async () => {
        throw new Error('fetch should not run when token is too short');
      },
    });
    assert.notEqual(shortToken, 0, 'expected short API token to fail');

    const liveMissingToken = await runWriter(baseOptions(root, { responsePath: '', apiToken: '' }), {
      fetchFn: async () => {
        throw new Error('fetch should not run when token is missing');
      },
    });
    assert.notEqual(liveMissingToken, 0, 'expected missing API token to fail');

    assert.equal(redact('Authorization: Bearer super-secret'), 'Authorization: Bearer <redacted>');
    process.stdout.write('provider quality evidence selftest passed\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
