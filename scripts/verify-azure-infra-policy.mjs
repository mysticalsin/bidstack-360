#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_BICEP_PATH = 'infra/azure/main.bicep';

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    bicepPath: DEFAULT_BICEP_PATH,
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
      parsed.bicepPath = argv[index + 1] ?? parsed.bicepPath;
      index += 1;
    } else if (arg.startsWith('--file=')) {
      parsed.bicepPath = arg.slice('--file='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.root = path.resolve(parsed.root);
  parsed.bicepPath = path.resolve(parsed.root, parsed.bicepPath);
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack Azure infra policy verifier

Usage:
  node scripts/verify-azure-infra-policy.mjs
  node scripts/verify-azure-infra-policy.mjs --selftest

Checks:
  infra/azure/main.bicep keeps INTEGRATION_TOKEN_KEY aligned with the runtime
  64-character hex contract.
`);
}

function getParamDecoratorBlock(source, paramName) {
  const pattern = new RegExp(`((?:\\s*@[^\\n]+\\n)+)\\s*param\\s+${paramName}\\s+string\\b`, 'm');
  const match = source.match(pattern);
  return match?.[1] ?? '';
}

function check(id, label, passed, detail = '') {
  return {
    id,
    label,
    passed,
    detail,
  };
}

function validateAzureInfraPolicy(source) {
  const decoratorBlock = getParamDecoratorBlock(source, 'integrationTokenKey');
  const checks = [
    check(
      'integration-token-param-present',
      'integrationTokenKey parameter exists',
      /\bparam\s+integrationTokenKey\s+string\b/.test(source),
    ),
    check(
      'integration-token-min-length',
      'integrationTokenKey has @minLength(64)',
      /@minLength\(\s*64\s*\)/.test(decoratorBlock),
    ),
    check(
      'integration-token-max-length',
      'integrationTokenKey has @maxLength(64)',
      /@maxLength\(\s*64\s*\)/.test(decoratorBlock),
    ),
    check(
      'integration-token-description-hex',
      'integrationTokenKey description names the 64-character hex contract',
      /64-character hex/i.test(decoratorBlock),
    ),
    check(
      'integration-token-description-generator',
      'integrationTokenKey description names openssl rand -hex 32',
      /openssl rand -hex 32/i.test(decoratorBlock),
    ),
    check(
      'integration-token-description-no-base64',
      'integrationTokenKey description does not describe the key as base64',
      !/\bbase64\b/i.test(decoratorBlock),
    ),
    check(
      'integration-token-key-vault-secret',
      'integrationTokenKey is stored as the integration-token-key Key Vault secret',
      /'integration-token-key'\s*:\s*integrationTokenKey/.test(source),
    ),
    check(
      'integration-token-container-secret',
      'Container Apps reference the integration-token-key Key Vault secret',
      // The bicep builds the secret ref through the kvSecret(name, miId, vaultUri)
      // helper, which expands to exactly the inline literal below. Accept either
      // shape so the gate tracks the refactored source instead of drifting from it.
      /kvSecret\(\s*'integration-token-key'\s*,\s*managedIdentityId\s*,\s*kvUri\s*\)/.test(source) ||
        /name:\s*'integration-token-key'\s*,\s*keyVaultUrl:\s*'\$\{kvUri\}secrets\/integration-token-key'\s*,\s*identity:\s*managedIdentityId/.test(
          source,
        ),
    ),
    check(
      'integration-token-env-secret-ref',
      'API and worker receive INTEGRATION_TOKEN_KEY from the integration-token-key secret',
      /name:\s*'INTEGRATION_TOKEN_KEY'\s*,\s*secretRef:\s*'integration-token-key'/.test(source),
    ),
  ];

  return {
    passed: checks.every((entry) => entry.passed),
    checks,
  };
}

function failedIds(result) {
  return result.checks.filter((entry) => !entry.passed).map((entry) => entry.id);
}

function runSelftest() {
  const goodFixture = `
@secure()
@minLength(64)
@maxLength(64)
@description('64-character hex AES-256-GCM key generated with \`openssl rand -hex 32\`; encrypts per-org Dust + OAuth secrets at rest. REQUIRED in prod.')
param integrationTokenKey string

var secretMap = {
  'integration-token-key': integrationTokenKey
}

var commonSecrets = [
  kvSecret('integration-token-key', managedIdentityId, kvUri)
]

var sharedEnv = [
  { name: 'INTEGRATION_TOKEN_KEY', secretRef: 'integration-token-key' }
]
`;

  assert.equal(validateAzureInfraPolicy(goodFixture).passed, true);

  const missingMin = validateAzureInfraPolicy(goodFixture.replace('@minLength(64)\n', ''));
  assert.deepEqual(failedIds(missingMin), ['integration-token-min-length']);

  const missingMax = validateAzureInfraPolicy(goodFixture.replace('@maxLength(64)\n', ''));
  assert.deepEqual(failedIds(missingMax), ['integration-token-max-length']);

  const staleDescription = validateAzureInfraPolicy(
    goodFixture.replace(
      "64-character hex AES-256-GCM key generated with `openssl rand -hex 32`",
      'AES-256-GCM key (base64, 32 bytes)',
    ),
  );
  assert.deepEqual(failedIds(staleDescription), [
    'integration-token-description-hex',
    'integration-token-description-generator',
    'integration-token-description-no-base64',
  ]);

  const missingEnv = validateAzureInfraPolicy(
    goodFixture.replace("{ name: 'INTEGRATION_TOKEN_KEY', secretRef: 'integration-token-key' }", ''),
  );
  assert.deepEqual(failedIds(missingEnv), ['integration-token-env-secret-ref']);

  process.stdout.write('PASS Azure infra policy verifier selftest\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selftest) {
    runSelftest();
    return;
  }

  const source = readFileSync(args.bicepPath, 'utf8');
  const result = validateAzureInfraPolicy(source);

  for (const entry of result.checks) {
    process.stdout.write(`${entry.passed ? 'PASS' : 'FAIL'} ${entry.label}\n`);
  }

  if (!result.passed) {
    process.stderr.write(`Azure infra policy failed: ${failedIds(result).join(', ')}\n`);
    process.exit(1);
  }

  process.stdout.write('PASS Azure infra policy\n');
}

main();
