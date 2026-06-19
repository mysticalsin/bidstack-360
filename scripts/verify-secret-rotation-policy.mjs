#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_SCRIPT_PATH = 'scripts/ops/rotate-secrets.sh';
const REQUIRED_ROTATION_TOOL = 'scripts/rotate-integration-tokens.ts';

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    scriptPath: DEFAULT_SCRIPT_PATH,
    toolPath: REQUIRED_ROTATION_TOOL,
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
      parsed.scriptPath = argv[index + 1] ?? parsed.scriptPath;
      index += 1;
    } else if (arg.startsWith('--file=')) {
      parsed.scriptPath = arg.slice('--file='.length);
    } else if (arg === '--tool') {
      parsed.toolPath = argv[index + 1] ?? parsed.toolPath;
      index += 1;
    } else if (arg.startsWith('--tool=')) {
      parsed.toolPath = arg.slice('--tool='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.root = path.resolve(parsed.root);
  parsed.scriptPath = path.resolve(parsed.root, parsed.scriptPath);
  parsed.toolPath = path.resolve(parsed.root, parsed.toolPath);
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack secret rotation policy verifier

Usage:
  node scripts/verify-secret-rotation-policy.mjs
  node scripts/verify-secret-rotation-policy.mjs --selftest

Checks:
  scripts/ops/rotate-secrets.sh cannot rotate INTEGRATION_TOKEN_KEY unless the
  re-encryption tool contract is present, implemented, and the operator copy is
  fail-closed.
`);
}

function check(id, label, passed, detail = '') {
  return { id, label, passed, detail };
}

export function validateTokenRotationTool(source, options = {}) {
  const exists = options.exists ?? true;

  return [
    check(
      'token-rotation-tool-exists',
      'Required INTEGRATION_TOKEN_KEY re-encryption tool exists',
      exists,
    ),
    check(
      'token-rotation-tool-uses-cipher-helpers',
      'Re-encryption tool uses the shared token cipher helpers',
      /packages\/shared\/src\/crypto\/token-cipher\.js/.test(source) &&
        /\bdecryptToken\b/.test(source) &&
        /\bencryptToken\b/.test(source),
    ),
    check(
      'token-rotation-tool-uses-old-new-env',
      'Re-encryption tool requires explicit old and new token keys',
      /\bOLD_INTEGRATION_TOKEN_KEY\b/.test(source) &&
        /\bNEW_INTEGRATION_TOKEN_KEY\b/.test(source),
    ),
    check(
      'token-rotation-tool-explicit-modes',
      'Re-encryption tool requires explicit dry-run or apply mode',
      /--dry-run/.test(source) && /--apply/.test(source),
    ),
    check(
      'token-rotation-tool-covers-token-fields',
      'Re-encryption tool covers access and refresh token ciphertexts',
      /\baccessTokenEncrypted\b/.test(source) && /\brefreshTokenEncrypted\b/.test(source),
    ),
    check(
      'token-rotation-tool-resumable',
      'Re-encryption tool can recognize already-rotated rows for resumable runs',
      /\balreadyRotated\b/.test(source) && /old or new key/.test(source),
    ),
    check(
      'token-rotation-tool-verifies-new-ciphertexts',
      'Re-encryption tool verifies new ciphertexts decrypt with the new key',
      /verify.*new key/is.test(source) || /decryptWithKey\(.*newKey/s.test(source),
    ),
    check(
      'token-rotation-tool-selftest',
      'Re-encryption tool ships a local selftest',
      /--selftest/.test(source) && /\brunSelftest\b/.test(source),
    ),
  ];
}

export function validateSecretRotationPolicy(source, rotationToolSource = '', rotationToolOptions = {}) {
  const guardIndex = source.indexOf('[[ ! -f "$TOKEN_ROTATION_SCRIPT" ]]');
  const newKeyIndex = source.indexOf('NEW_KEY=$(openssl rand -hex 32)');
  const legacyDbMigrateHint = /pnpm db:migrate \(includes re-encryption script\)/.test(source);

  return [
    check(
      'token-rotation-tool-declared',
      'INTEGRATION_TOKEN_KEY rotation declares the required re-encryption tool',
      new RegExp(`TOKEN_ROTATION_SCRIPT="${REQUIRED_ROTATION_TOOL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(source),
    ),
    check(
      'token-rotation-fail-closed-guard',
      'INTEGRATION_TOKEN_KEY rotation is blocked when the re-encryption tool is absent',
      guardIndex >= 0,
    ),
    check(
      'token-rotation-guard-before-new-key',
      'Re-encryption tool guard runs before a replacement key is generated',
      guardIndex >= 0 && newKeyIndex >= 0 && guardIndex < newKeyIndex,
    ),
    check(
      'token-rotation-blocked-audit-log',
      'Blocked INTEGRATION_TOKEN_KEY rotations are written to the rotation log',
      /append_log "INTEGRATION_TOKEN_KEY rotation blocked/.test(source),
    ),
    check(
      'token-rotation-no-fake-db-migrate',
      'Rotation instructions do not claim db:migrate performs token re-encryption',
      !legacyDbMigrateHint,
      legacyDbMigrateHint ? 'Found stale "pnpm db:migrate (includes re-encryption script)" copy.' : '',
    ),
    check(
      'token-rotation-checklist-conditional-prev',
      'Post-rotation checklist treats INTEGRATION_TOKEN_KEY_PREV cleanup as conditional',
      /remove INTEGRATION_TOKEN_KEY_PREV only after token re-encryption/.test(source),
    ),
    ...validateTokenRotationTool(rotationToolSource, rotationToolOptions),
  ];
}

function summarize(checks) {
  const failed = checks.filter((item) => !item.passed);
  if (failed.length === 0) {
    process.stdout.write('secret rotation policy passed\n');
    return;
  }
  for (const item of failed) {
    process.stderr.write(`FAIL ${item.id}: ${item.label}${item.detail ? ` - ${item.detail}` : ''}\n`);
  }
  throw new Error(`${failed.length} secret rotation policy check(s) failed`);
}

function runSelftest() {
  const good = `TOKEN_ROTATION_SCRIPT="${REQUIRED_ROTATION_TOOL}"
if [[ ! -f "$TOKEN_ROTATION_SCRIPT" ]]; then
  log_error "INTEGRATION_TOKEN_KEY rotation blocked"
  append_log "INTEGRATION_TOKEN_KEY rotation blocked - missing re-encryption tool"
else
  NEW_KEY=$(openssl rand -hex 32)
  log_warn "Run: OLD_INTEGRATION_TOKEN_KEY=<old> NEW_INTEGRATION_TOKEN_KEY=<new> tsx $TOKEN_ROTATION_SCRIPT"
fi
echo "remove INTEGRATION_TOKEN_KEY_PREV only after token re-encryption"
`;
  const goodTool = `import { decryptToken, encryptToken } from '../packages/shared/src/crypto/token-cipher.js';
const oldKey = process.env.OLD_INTEGRATION_TOKEN_KEY;
const newKey = process.env.NEW_INTEGRATION_TOKEN_KEY;
const modes = ['--dry-run', '--apply', '--selftest'];
function runSelftest() {}
function rotate(row) {
  const accessTokenEncrypted = row.accessTokenEncrypted;
  const refreshTokenEncrypted = row.refreshTokenEncrypted;
  const alreadyRotated = decryptToken(accessTokenEncrypted, newKey);
  if (!oldKey || !newKey) throw new Error('ciphertext could not be decrypted with old or new key');
  const rotated = encryptToken(decryptToken(refreshTokenEncrypted, oldKey), newKey);
  return decryptWithKey(rotated, newKey);
}`;
  const poisoned = `if confirm "Rotate INTEGRATION_TOKEN_KEY?"; then
  NEW_KEY=$(openssl rand -hex 32)
  log_warn "  1. Run the token re-encryption migration: pnpm db:migrate (includes re-encryption script)"
fi
echo "remove JWT_SIGNING_*_PREV and INTEGRATION_TOKEN_KEY_PREV"
`;

  assert.equal(validateSecretRotationPolicy(good, goodTool).every((item) => item.passed), true);
  assert.equal(validateSecretRotationPolicy(poisoned).some((item) => !item.passed), true);
  assert.equal(validateTokenRotationTool('', { exists: false }).some((item) => !item.passed), true);
  process.stdout.write('secret rotation policy selftest passed\n');
}

const args = parseArgs(process.argv.slice(2));

if (args.selftest) {
  runSelftest();
} else {
  const toolExists = existsSync(args.toolPath);
  const toolSource = toolExists ? readFileSync(args.toolPath, 'utf8') : '';
  summarize(
    validateSecretRotationPolicy(readFileSync(args.scriptPath, 'utf8'), toolSource, {
      exists: toolExists,
    }),
  );
}
