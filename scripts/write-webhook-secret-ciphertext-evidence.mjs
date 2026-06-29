#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createDecipheriv, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/webhook-secret-ciphertext-latest.json';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;
const VERSION = 0x01;
const LEGACY_WEBHOOK_PREFIX = 'whsec_';
const WEBHOOK_SIGNING_SECRET_HASH_PURPOSE = 'webhook-signing-secret-lookup-v1';

function parseArgs(argv) {
  const database = resolveDatabaseUrlFromEnv();
  const options = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_WEBHOOK_SECRET_EVIDENCE ?? DEFAULT_OUTPUT_PATH,
    deployEnv: process.env.BIDSTACK_DEPLOY_ENV ?? process.env.NODE_ENV ?? 'unknown',
    databaseUrl: database.value,
    databaseUrlSource: database.source,
    integrationTokenKey: String(process.env.INTEGRATION_TOKEN_KEY ?? '').trim(),
    strict: resolveStrictDefault(),
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
    } else if (arg === '--database-url') {
      options.databaseUrl = next;
      options.databaseUrlSource = '--database-url';
      index += 1;
    } else if (arg === '--integration-token-key') {
      options.integrationTokenKey = String(next ?? '').trim();
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
  process.stdout.write(`Usage: node scripts/write-webhook-secret-ciphertext-evidence.mjs [options]

Writes deploy-evidence/webhook-secret-ciphertext-latest.json with privacy-safe
aggregate counts proving WebhookSubscription.secret decrypts with the release
INTEGRATION_TOKEN_KEY.

Environment:
  BIDSTACK_WEBHOOK_SECRET_EVIDENCE_DATABASE_URL  Release database URL
  DATABASE_URL                                   Fallback release database URL
  INTEGRATION_TOKEN_KEY                          64-character hex AES key
  BIDSTACK_WEBHOOK_SECRET_EVIDENCE               Output path
  BIDSTACK_DEPLOY_ENV                            Evidence environment label

Options:
  --database-url <url>            Override database URL
  --integration-token-key <hex>   Override INTEGRATION_TOKEN_KEY
  --output <path>                 Override evidence output path
  --env <name>                    Override deploy environment
  --strict / --non-strict         Toggle strict release checks
  --selftest                      Run offline contract tests
`);
}

function resolveStrictDefault() {
  const strict = String(process.env.BIDSTACK_WEBHOOK_SECRET_EVIDENCE_STRICT ?? '').trim();
  if (strict === '0' || strict.toLowerCase() === 'false') return false;
  return process.env.BIDSTACK_STRICT_DEPLOY_GATE !== '0';
}

function resolveDatabaseUrlFromEnv() {
  const webhookUrl = String(process.env.BIDSTACK_WEBHOOK_SECRET_EVIDENCE_DATABASE_URL ?? '').trim();
  if (webhookUrl) {
    return { source: 'BIDSTACK_WEBHOOK_SECRET_EVIDENCE_DATABASE_URL', value: webhookUrl };
  }

  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (databaseUrl) {
    return { source: 'DATABASE_URL', value: databaseUrl };
  }

  return { source: null, value: '' };
}

function decodeMasterKey(raw) {
  const trimmed = String(raw || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  throw new Error(
    `INTEGRATION_TOKEN_KEY must be a 64-character hex string (${KEY_LENGTH_BYTES} bytes).`,
  );
}

function decryptSecretBlob(blob, key) {
  if (typeof blob !== 'string' || blob.length === 0) {
    throw new Error('decryptSecretBlob requires a non-empty string blob');
  }

  const packed = Buffer.from(blob, 'base64url');
  if (packed.length < 1 + IV_LENGTH_BYTES + TAG_LENGTH_BYTES + 1) {
    throw new Error('decryptSecretBlob: blob too short');
  }

  const version = packed[0];
  if (version !== VERSION) {
    throw new Error(`decryptSecretBlob: unsupported version ${version}`);
  }

  const iv = packed.subarray(1, 1 + IV_LENGTH_BYTES);
  const tag = packed.subarray(1 + IV_LENGTH_BYTES, 1 + IV_LENGTH_BYTES + TAG_LENGTH_BYTES);
  const ciphertext = packed.subarray(1 + IV_LENGTH_BYTES + TAG_LENGTH_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function hashWebhookSigningSecret(secret, key) {
  return createHmac('sha256', key)
    .update(WEBHOOK_SIGNING_SECRET_HASH_PURPOSE)
    .update('\0')
    .update(secret, 'utf8')
    .digest('hex');
}

function emptyTotals() {
  return {
    totalRows: 0,
    activeRows: 0,
    deletedRows: 0,
    encryptedDecryptableRows: 0,
    legacyPlaintextRows: 0,
    unreadableRows: 0,
    emptySecretRows: 0,
    secretHashPresentRows: 0,
    secretHashMissingRows: 0,
    secretHashInvalidRows: 0,
  };
}

function collectRows(rows, key) {
  const totals = emptyTotals();

  for (const row of rows) {
    totals.totalRows += 1;
    if (row.active === true) totals.activeRows += 1;
    if (row.deletedAt) totals.deletedRows += 1;

    const secret = typeof row.secret === 'string' ? row.secret : '';
    if (!secret) {
      totals.emptySecretRows += 1;
      continue;
    }

    try {
      const plaintext = decryptSecretBlob(secret, key);
      totals.encryptedDecryptableRows += 1;
      const secretHash = typeof row.secretHash === 'string' ? row.secretHash : '';
      if (!secretHash) {
        totals.secretHashMissingRows += 1;
      } else if (secretHash !== hashWebhookSigningSecret(plaintext, key)) {
        totals.secretHashInvalidRows += 1;
      } else {
        totals.secretHashPresentRows += 1;
      }
    } catch {
      if (secret.startsWith(LEGACY_WEBHOOK_PREFIX)) {
        totals.legacyPlaintextRows += 1;
      } else {
        totals.unreadableRows += 1;
      }
    }
  }

  return totals;
}

async function collectLiveScan(options) {
  const startedAt = new Date().toISOString();
  if (!options.databaseUrl) {
    return missingScan(
      startedAt,
      'Database URL is required for webhook secret ciphertext evidence.',
      false,
      null,
    );
  }

  let key;
  try {
    key = decodeMasterKey(options.integrationTokenKey);
  } catch (error) {
    return missingScan(
      startedAt,
      error instanceof Error ? error.message : String(error),
      true,
      options.databaseUrlSource || 'DATABASE_URL',
    );
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = options.databaseUrl;
  let prisma;

  try {
    const { PrismaClient } = await import('../packages/db/generated/client/index.js');
    prisma = new PrismaClient();
    const totals = emptyTotals();
    let cursor;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await prisma.webhookSubscription.findMany({
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, active: true, deletedAt: true, secret: true, secretHash: true },
      });

      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;
      const pageTotals = collectRows(rows, key);
      for (const [name, value] of Object.entries(pageTotals)) {
        totals[name] += value;
      }
    }

    return {
      source: 'raw-db-webhook-secret-scan',
      ok: true,
      startedAt,
      completedAt: new Date().toISOString(),
      error: null,
      databaseUrlConfigured: true,
      databaseUrlSource: options.databaseUrlSource || 'DATABASE_URL',
      totals,
    };
  } catch (error) {
    return {
      source: 'raw-db-webhook-secret-scan',
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      databaseUrlConfigured: true,
      databaseUrlSource: options.databaseUrlSource || 'DATABASE_URL',
      totals: emptyTotals(),
    };
  } finally {
    if (prisma) await prisma.$disconnect();
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
}

function missingScan(startedAt, error, databaseUrlConfigured, databaseUrlSource) {
  return {
    source: 'raw-db-webhook-secret-scan',
    ok: false,
    startedAt,
    completedAt: new Date().toISOString(),
    error,
    databaseUrlConfigured,
    databaseUrlSource,
    totals: emptyTotals(),
  };
}

function buildArtifact(options, scan) {
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: 'write-webhook-secret-ciphertext-evidence',
    environment: options.deployEnv,
    strict: options.strict,
    database: {
      configured: scan.databaseUrlConfigured === true,
      source: scan.databaseUrlSource ?? null,
      queryMode: 'raw-secret-decrypt-counts',
      rawValuesIncluded: false,
    },
    policy: {
      encryptionEnvelope: 'aes-256-gcm-v1-base64url',
      legacyPlaintextPrefix: LEGACY_WEBHOOK_PREFIX,
      plaintextFallbackAllowed: false,
    },
    privacy: {
      secretValuesIncluded: false,
      ciphertextSamplesIncluded: false,
      rowIdsIncluded: false,
      urlsIncluded: false,
      eventListsIncluded: false,
      secretHashesIncluded: false,
    },
    command: {
      source: scan.source,
      ok: scan.ok,
      startedAt: scan.startedAt,
      completedAt: scan.completedAt,
      error: scan.error,
    },
    totals: scan.totals ?? emptyTotals(),
    passed: false,
    validationFailures: [],
  };

  artifact.validationFailures = validateArtifact(artifact);
  artifact.passed = artifact.validationFailures.length === 0;
  return artifact;
}

function validateArtifact(artifact) {
  const failures = [];

  if (artifact.command.source !== 'raw-db-webhook-secret-scan') {
    failures.push('Webhook secret evidence must come from raw-db-webhook-secret-scan.');
  }
  if (artifact.command.ok !== true) {
    failures.push(`Webhook secret scan did not complete successfully: ${artifact.command.error}`);
  }
  if (artifact.database.configured !== true) {
    failures.push('Database URL is required for webhook secret evidence.');
  }
  if (artifact.database.queryMode !== 'raw-secret-decrypt-counts') {
    failures.push('Webhook secret evidence must use raw-secret-decrypt-counts mode.');
  }

  const privacy = artifact.privacy ?? {};
  for (const [key, label] of [
    ['secretValuesIncluded', 'raw secret values'],
    ['ciphertextSamplesIncluded', 'ciphertext samples'],
    ['rowIdsIncluded', 'row ids'],
    ['urlsIncluded', 'webhook URLs'],
    ['eventListsIncluded', 'event lists'],
    ['secretHashesIncluded', 'secret hashes'],
  ]) {
    if (privacy[key] !== false) failures.push(`Webhook secret evidence includes ${label}.`);
  }

  const totals = artifact.totals ?? {};
  const totalRows = Number(totals.totalRows ?? 0);
  const decryptable = Number(totals.encryptedDecryptableRows ?? 0);
  const legacy = Number(totals.legacyPlaintextRows ?? 0);
  const unreadable = Number(totals.unreadableRows ?? 0);
  const empty = Number(totals.emptySecretRows ?? 0);
  const hashPresent = Number(totals.secretHashPresentRows ?? 0);
  const hashMissing = Number(totals.secretHashMissingRows ?? 0);
  const hashInvalid = Number(totals.secretHashInvalidRows ?? 0);

  if (legacy !== 0) {
    failures.push(`Webhook secret evidence found ${legacy} legacy plaintext row(s).`);
  }
  if (unreadable !== 0) {
    failures.push(`Webhook secret evidence found ${unreadable} unreadable row(s).`);
  }
  if (empty !== 0) {
    failures.push(`Webhook secret evidence found ${empty} empty secret row(s).`);
  }
  if (decryptable !== totalRows) {
    failures.push(
      `Webhook secret decryptable count ${decryptable} does not match total row count ${totalRows}.`,
    );
  }
  if (hashMissing !== 0) {
    failures.push(`Webhook secret evidence found ${hashMissing} row(s) missing secret_hash.`);
  }
  if (hashInvalid !== 0) {
    failures.push(`Webhook secret evidence found ${hashInvalid} row(s) with invalid secret_hash.`);
  }
  if (hashPresent !== decryptable) {
    failures.push(
      `Webhook secret hash-present count ${hashPresent} does not match decryptable count ${decryptable}.`,
    );
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
  const scan = deps.collectScan ? await deps.collectScan(options) : await collectLiveScan(options);
  const artifact = buildArtifact(options, scan);
  const outputPath = resolveOutputPath(options.root, options.outputPath);
  writeJsonFile(outputPath, artifact);

  return {
    artifact,
    outputPath,
    exitCode: artifact.passed ? 0 : 1,
  };
}

function syntheticScan(overrides = {}) {
  return {
    source: 'raw-db-webhook-secret-scan',
    ok: true,
    startedAt: '2026-06-28T12:00:00.000Z',
    completedAt: '2026-06-28T12:00:01.000Z',
    error: null,
    databaseUrlConfigured: true,
    databaseUrlSource: 'DATABASE_URL',
    totals: {
      totalRows: 3,
      activeRows: 2,
      deletedRows: 1,
      encryptedDecryptableRows: 3,
      legacyPlaintextRows: 0,
      unreadableRows: 0,
      emptySecretRows: 0,
      secretHashPresentRows: 3,
      secretHashMissingRows: 0,
      secretHashInvalidRows: 0,
      ...overrides,
    },
  };
}

async function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidstack-webhook-secret-evidence-'));

  try {
    const baseOptions = {
      root,
      outputPath: DEFAULT_OUTPUT_PATH,
      deployEnv: 'production',
      databaseUrl: 'postgresql://release-db-user:release-db-pass@db.release.internal/bidstack',
      databaseUrlSource: 'DATABASE_URL',
      integrationTokenKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      strict: true,
    };

    const good = await runWriter(baseOptions, { collectScan: () => syntheticScan() });
    assert.equal(good.exitCode, 0);
    assert.equal(good.artifact.passed, true);
    assert.equal(good.artifact.totals.legacyPlaintextRows, 0);
    assert.equal(good.artifact.privacy.secretValuesIncluded, false);
    assert.equal(good.artifact.privacy.secretHashesIncluded, false);
    assert.equal(existsSync(good.outputPath), true);
    assert.doesNotMatch(JSON.stringify(good.artifact), /whsec_plaintext|example\.com/i);

    const plaintext = await runWriter(
      { ...baseOptions, outputPath: 'plaintext-webhooks.json' },
      {
        collectScan: () =>
          syntheticScan({
            encryptedDecryptableRows: 2,
            legacyPlaintextRows: 1,
          }),
      },
    );
    assert.equal(plaintext.exitCode, 1);
    assert.match(plaintext.artifact.validationFailures.join('\n'), /legacy plaintext/);

    const unreadable = await runWriter(
      { ...baseOptions, outputPath: 'unreadable-webhooks.json' },
      {
        collectScan: () =>
          syntheticScan({
            encryptedDecryptableRows: 2,
            unreadableRows: 1,
          }),
      },
    );
    assert.equal(unreadable.exitCode, 1);
    assert.match(unreadable.artifact.validationFailures.join('\n'), /unreadable/);

    const missingHash = await runWriter(
      { ...baseOptions, outputPath: 'missing-hash-webhooks.json' },
      {
        collectScan: () =>
          syntheticScan({
            secretHashPresentRows: 2,
            secretHashMissingRows: 1,
          }),
      },
    );
    assert.equal(missingHash.exitCode, 1);
    assert.match(missingHash.artifact.validationFailures.join('\n'), /missing secret_hash/);

    const invalidHash = await runWriter(
      { ...baseOptions, outputPath: 'invalid-hash-webhooks.json' },
      {
        collectScan: () =>
          syntheticScan({
            secretHashPresentRows: 2,
            secretHashInvalidRows: 1,
          }),
      },
    );
    assert.equal(invalidHash.exitCode, 1);
    assert.match(invalidHash.artifact.validationFailures.join('\n'), /invalid secret_hash/);

    const missingDatabase = await runWriter(
      {
        ...baseOptions,
        outputPath: 'missing-database.json',
        databaseUrl: '',
        databaseUrlSource: null,
      },
      {
        collectScan: () =>
          missingScan(
            '2026-06-28T12:00:00.000Z',
            'Database URL is required for webhook secret ciphertext evidence.',
            false,
            null,
          ),
      },
    );
    assert.equal(missingDatabase.exitCode, 1);
    assert.match(missingDatabase.artifact.validationFailures.join('\n'), /Database URL/);

    const key = decodeMasterKey(baseOptions.integrationTokenKey);
    assert.throws(() => decryptSecretBlob('whsec_plaintext', key), /blob too short/);

    process.stdout.write('[webhook-secret-evidence] selftest passed\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.selftest) {
    await runSelftest();
  } else {
    const result = await runWriter(options);
    process.stdout.write(
      `[webhook-secret-evidence] wrote ${result.outputPath} passed=${result.artifact.passed} environment=${result.artifact.environment}\n`,
    );
    if (!result.artifact.passed) {
      for (const failure of result.artifact.validationFailures) {
        process.stderr.write(`[webhook-secret-evidence] ${failure}\n`);
      }
    }
    process.exit(result.exitCode);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
