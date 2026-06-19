#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_COMPOSE_PATH = 'docker-compose.prod.yml';
const SECRET_EXPANSION = '${INTEGRATION_TOKEN_KEY:?INTEGRATION_TOKEN_KEY is required}';

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    composePath: DEFAULT_COMPOSE_PATH,
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--selftest') {
      parsed.selftest = true;
    } else if (arg === '--root') {
      parsed.root = argv[index + 1] ?? parsed.root;
      index += 1;
    } else if (arg.startsWith('--root=')) {
      parsed.root = arg.slice('--root='.length);
    } else if (arg === '--file') {
      parsed.composePath = argv[index + 1] ?? parsed.composePath;
      index += 1;
    } else if (arg.startsWith('--file=')) {
      parsed.composePath = arg.slice('--file='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.root = path.resolve(parsed.root);
  parsed.composePath = path.resolve(parsed.root, parsed.composePath);
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack production compose policy verifier

Usage:
  node scripts/verify-compose-production-policy.mjs
  node scripts/verify-compose-production-policy.mjs --selftest

Checks:
  docker-compose.prod.yml wires INTEGRATION_TOKEN_KEY into every production
  service that encrypts or decrypts tenant/provider secrets.
`);
}

function check(id, label, passed, detail = '') {
  return { id, label, passed, detail };
}

function normalizeLines(source) {
  return String(source).replace(/\r\n/g, '\n').split('\n');
}

function extractServiceBlock(source, serviceName) {
  const lines = normalizeLines(source);
  const startIndex = lines.findIndex((line) => line.match(new RegExp(`^  ${serviceName}:\\s*(?:#.*)?$`)));

  if (startIndex < 0) {
    return null;
  }

  const block = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^ {2}[A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line)) {
      break;
    }
    block.push(line);
  }

  return block.join('\n');
}

function extractEnvironment(serviceBlock) {
  if (!serviceBlock) {
    return null;
  }

  const lines = normalizeLines(serviceBlock);
  const envIndex = lines.findIndex((line) => /^ {4}environment:\s*(?:#.*)?$/.test(line));

  if (envIndex < 0) {
    return null;
  }

  const env = new Map();
  for (let index = envIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }
    if (/^ {4}[A-Za-z0-9_-]+:\s*/.test(line) && !/^ {6}/.test(line)) {
      break;
    }

    const mapEntry = line.match(/^ {6}([A-Z0-9_]+):\s*(.*)$/);
    if (mapEntry) {
      env.set(mapEntry[1], mapEntry[2].trim());
      continue;
    }

    const listEntry = line.match(/^ {6}-\s*([A-Z0-9_]+)=(.*)$/);
    if (listEntry) {
      env.set(listEntry[1], listEntry[2].trim());
    }
  }

  return env;
}

function hasRequiredExpansion(env, key) {
  const value = env?.get(key) ?? '';
  return value === SECRET_EXPANSION || new RegExp(`^\\$\\{${key}:\\?[^}]+\\}$`).test(value);
}

function validateService(source, serviceName) {
  const block = extractServiceBlock(source, serviceName);
  const env = extractEnvironment(block);
  const label = serviceName === 'api' ? 'API' : 'Worker';

  return [
    check(
      `${serviceName}-service-exists`,
      `${label} service exists in production compose`,
      block !== null,
    ),
    check(
      `${serviceName}-environment-exists`,
      `${label} service has an environment block`,
      env !== null,
    ),
    check(
      `${serviceName}-node-env-production`,
      `${label} service runs with NODE_ENV=production`,
      env?.get('NODE_ENV') === 'production',
      env ? `NODE_ENV=${env.get('NODE_ENV') ?? '<missing>'}` : '',
    ),
    check(
      `${serviceName}-integration-token-key-present`,
      `${label} service receives INTEGRATION_TOKEN_KEY`,
      env?.has('INTEGRATION_TOKEN_KEY') === true,
    ),
    check(
      `${serviceName}-integration-token-key-required`,
      `${label} service requires INTEGRATION_TOKEN_KEY instead of defaulting empty`,
      hasRequiredExpansion(env, 'INTEGRATION_TOKEN_KEY'),
      env?.has('INTEGRATION_TOKEN_KEY')
        ? `Found INTEGRATION_TOKEN_KEY: ${env.get('INTEGRATION_TOKEN_KEY')}`
        : '',
    ),
  ];
}

function validateRuntimeService(source, serviceName, label, requiredKeys) {
  const block = extractServiceBlock(source, serviceName);
  const env = extractEnvironment(block);

  return [
    check(`${serviceName}-service-exists`, `${label} service exists in production compose`, block !== null),
    check(`${serviceName}-environment-exists`, `${label} service has an environment block`, env !== null),
    check(
      `${serviceName}-node-env-production`,
      `${label} service runs with NODE_ENV=production`,
      env?.get('NODE_ENV') === 'production',
      env ? `NODE_ENV=${env.get('NODE_ENV') ?? '<missing>'}` : '',
    ),
    ...requiredKeys.flatMap((key) => [
      check(`${serviceName}-${key.toLowerCase()}-present`, `${label} service receives ${key}`, env?.has(key) === true),
      check(
        `${serviceName}-${key.toLowerCase()}-required`,
        `${label} service requires ${key} instead of defaulting empty`,
        hasRequiredExpansion(env, key),
        env?.has(key) ? `Found ${key}: ${env.get(key)}` : '',
      ),
    ]),
  ];
}

export function validateComposeProductionPolicy(source) {
  const checks = [
    ...validateService(source, 'api'),
    ...validateService(source, 'worker'),
    ...validateRuntimeService(source, 'mcp-server', 'MCP server', ['DATABASE_URL', 'REDIS_URL']),
    check(
      'redis-requires-password',
      'Redis requires password auth in production compose',
      /redis-server['"]?\s*,\s*['"]--requirepass/.test(source) ||
        /redis-server\s+--requirepass/.test(source),
    ),
    check(
      'postgres-uses-pgvector',
      'Postgres image supports pgvector migrations',
      /image:\s*pgvector\/pgvector:pg16\b/.test(source),
    ),
  ];

  return {
    checks,
    passed: checks.every((entry) => entry.passed),
  };
}

function failedIds(result) {
  return result.checks.filter((entry) => !entry.passed).map((entry) => entry.id);
}

function summarize(result) {
  if (result.passed) {
    process.stdout.write('production compose policy passed\n');
    return;
  }

  for (const item of result.checks.filter((entry) => !entry.passed)) {
    process.stderr.write(`FAIL ${item.id}: ${item.label}${item.detail ? ` - ${item.detail}` : ''}\n`);
  }
  throw new Error(`${failedIds(result).length} production compose policy check(s) failed`);
}

function composeFixture(apiKeyLine = `      INTEGRATION_TOKEN_KEY: ${SECRET_EXPANSION}`, workerKeyLine = apiKeyLine) {
  return `services:
  postgres:
    image: pgvector/pgvector:pg16
  redis:
    image: redis:7-alpine
    command: ['redis-server', '--requirepass', '\${REDIS_PASSWORD:?REDIS_PASSWORD is required}']
  api:
    environment:
      NODE_ENV: production
      DATABASE_URL: \${DATABASE_URL:?DATABASE_URL is required}
${apiKeyLine}
  worker:
    environment:
      NODE_ENV: production
      DATABASE_URL: \${DATABASE_URL:?DATABASE_URL is required}
${workerKeyLine}
  mcp-server:
    environment:
      NODE_ENV: production
      DATABASE_URL: \${DATABASE_URL:?DATABASE_URL is required}
      REDIS_URL: \${REDIS_URL:?REDIS_URL is required}
`;
}

function runSelftest() {
  assert.equal(validateComposeProductionPolicy(composeFixture()).passed, true);

  assert.deepEqual(
    failedIds(validateComposeProductionPolicy(composeFixture('', `      INTEGRATION_TOKEN_KEY: ${SECRET_EXPANSION}`))),
    ['api-integration-token-key-present', 'api-integration-token-key-required'],
  );

  assert.deepEqual(
    failedIds(
      validateComposeProductionPolicy(
        composeFixture(
          '      INTEGRATION_TOKEN_KEY: ${INTEGRATION_TOKEN_KEY:-}',
          `      INTEGRATION_TOKEN_KEY: ${SECRET_EXPANSION}`,
        ),
      ),
    ),
    ['api-integration-token-key-required'],
  );

  assert.deepEqual(failedIds(validateComposeProductionPolicy(composeFixture(undefined, ''))), [
    'worker-integration-token-key-present',
    'worker-integration-token-key-required',
  ]);

  assert.equal(
    failedIds(validateComposeProductionPolicy(composeFixture().replace('image: pgvector/pgvector:pg16', 'image: postgres:16-alpine'))).includes(
      'postgres-uses-pgvector',
    ),
    true,
  );

  assert.deepEqual(
    failedIds(validateComposeProductionPolicy(composeFixture().replace('      REDIS_URL: ${REDIS_URL:?REDIS_URL is required}', ''))),
    ['mcp-server-redis_url-present', 'mcp-server-redis_url-required'],
  );

  process.stdout.write('production compose policy selftest passed\n');
}

const args = parseArgs(process.argv.slice(2));

if (args.selftest) {
  runSelftest();
} else {
  summarize(validateComposeProductionPolicy(readFileSync(args.composePath, 'utf8')));
}
