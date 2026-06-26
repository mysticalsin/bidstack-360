#!/usr/bin/env tsx

/**
 * Re-encrypt stored OAuth integration tokens from one AES key to another.
 *
 * WHY: INTEGRATION_TOKEN_KEY protects live provider credentials. Rotating the
 * environment secret without re-encrypting IntegrationToken rows makes stored
 * credentials unreadable. This script performs the data move explicitly and is
 * resumable: rows already encrypted with the new key are skipped.
 *
 * Usage:
 *   OLD_INTEGRATION_TOKEN_KEY=<old> NEW_INTEGRATION_TOKEN_KEY=<new> tsx scripts/rotate-integration-tokens.ts --dry-run
 *   OLD_INTEGRATION_TOKEN_KEY=<old> NEW_INTEGRATION_TOKEN_KEY=<new> tsx scripts/rotate-integration-tokens.ts --apply
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '../packages/db/generated/client/index.js';
import {
  decryptToken,
  encryptToken,
} from '../packages/shared/src/crypto/token-cipher.js';

const DEFAULT_CHUNK_SIZE = 500;
const MAX_CHUNK_SIZE = 5_000;
const HEX_256_BIT_KEY = /^[0-9a-fA-F]{64}$/;

type RotationMode = 'dry-run' | 'apply';

interface CliOptions {
  chunkSize: number;
  mode: RotationMode | 'selftest' | 'help';
}

interface RotationKeys {
  oldKey: string;
  newKey: string;
}

interface IntegrationTokenRow {
  id: string;
  orgId: string;
  provider: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
}

type TokenFieldName = 'accessTokenEncrypted' | 'refreshTokenEncrypted';
type FieldRotationStatus = 'rotated' | 'alreadyRotated';

interface FieldRotationResult {
  ciphertext: string;
  status: FieldRotationStatus;
}

interface RowRotationResult {
  data: Partial<Pick<IntegrationTokenRow, 'accessTokenEncrypted' | 'refreshTokenEncrypted'>>;
  accessStatus: FieldRotationStatus;
  refreshStatus: FieldRotationStatus | 'absent';
  changed: boolean;
}

interface RotationStats {
  processedRows: number;
  rowsNeedingRotation: number;
  rowsWritten: number;
  alreadyRotatedRows: number;
  accessTokensRotated: number;
  refreshTokensRotated: number;
  accessTokensAlreadyRotated: number;
  refreshTokensAlreadyRotated: number;
  failedRows: number;
}

interface RotateDatabaseOptions {
  chunkSize: number;
  keys: RotationKeys;
  mode: RotationMode;
}

function printHelp(): void {
  process.stdout.write(`BidStack integration token rotation

Usage:
  OLD_INTEGRATION_TOKEN_KEY=<old> NEW_INTEGRATION_TOKEN_KEY=<new> tsx scripts/rotate-integration-tokens.ts --dry-run
  OLD_INTEGRATION_TOKEN_KEY=<old> NEW_INTEGRATION_TOKEN_KEY=<new> tsx scripts/rotate-integration-tokens.ts --apply
  tsx scripts/rotate-integration-tokens.ts --selftest

Options:
  --dry-run            Verify and count rows without writing data.
  --apply              Re-encrypt and write rows that still use the old key.
  --chunk-size <n>     Rows per page, 1-${MAX_CHUNK_SIZE}. Default: ${DEFAULT_CHUNK_SIZE}.
  --selftest           Run local crypto and parser checks without a database.
`);
}

export function parseArgs(argv: string[]): CliOptions {
  let mode: CliOptions['mode'] | undefined;
  let chunkSize = DEFAULT_CHUNK_SIZE;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      mode = 'help';
    } else if (arg === '--selftest') {
      mode = 'selftest';
    } else if (arg === '--dry-run') {
      if (mode === 'apply') {
        throw new Error('Choose only one mode: --dry-run or --apply.');
      }
      mode = 'dry-run';
    } else if (arg === '--apply') {
      if (mode === 'dry-run') {
        throw new Error('Choose only one mode: --dry-run or --apply.');
      }
      mode = 'apply';
    } else if (arg === '--chunk-size') {
      chunkSize = parseChunkSize(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--chunk-size=')) {
      chunkSize = parseChunkSize(arg.slice('--chunk-size='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!mode) {
    throw new Error('Choose a mode before running: --dry-run or --apply.');
  }

  return { chunkSize, mode };
}

function parseChunkSize(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error('--chunk-size must be an integer.');
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed < 1 || parsed > MAX_CHUNK_SIZE) {
    throw new Error(`--chunk-size must be between 1 and ${MAX_CHUNK_SIZE}.`);
  }

  return parsed;
}

export function validateRotationKeys(env: NodeJS.ProcessEnv = process.env): RotationKeys {
  const oldKey = readRotationKey(env, 'OLD_INTEGRATION_TOKEN_KEY');
  const newKey = readRotationKey(env, 'NEW_INTEGRATION_TOKEN_KEY');

  if (oldKey === newKey) {
    throw new Error('OLD_INTEGRATION_TOKEN_KEY and NEW_INTEGRATION_TOKEN_KEY must be different.');
  }

  return { oldKey, newKey };
}

function readRotationKey(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || !HEX_256_BIT_KEY.test(value)) {
    throw new Error(`${name} must be a 64-character hex string.`);
  }

  return value.toLowerCase();
}

export function withIntegrationTokenKey<T>(key: string, operation: () => T): T {
  const previous = process.env.INTEGRATION_TOKEN_KEY;
  process.env.INTEGRATION_TOKEN_KEY = key;

  try {
    return operation();
  } finally {
    if (previous === undefined) {
      delete process.env.INTEGRATION_TOKEN_KEY;
    } else {
      process.env.INTEGRATION_TOKEN_KEY = previous;
    }
  }
}

export function decryptWithKey(ciphertext: string, key: string): string {
  return withIntegrationTokenKey(key, () => decryptToken(ciphertext));
}

export function encryptWithKey(plaintext: string, key: string): string {
  return withIntegrationTokenKey(key, () => encryptToken(plaintext));
}

function tryDecryptWithKey(ciphertext: string, key: string): string | null {
  try {
    return decryptWithKey(ciphertext, key);
  } catch {
    return null;
  }
}

function rotateCiphertext(
  ciphertext: string,
  fieldName: TokenFieldName,
  keys: RotationKeys,
): FieldRotationResult {
  const plaintext = tryDecryptWithKey(ciphertext, keys.oldKey);

  if (plaintext !== null) {
    const rotatedCiphertext = encryptWithKey(plaintext, keys.newKey);

    // Verify the new ciphertext decrypts with the new key before any database write.
    if (decryptWithKey(rotatedCiphertext, keys.newKey) !== plaintext) {
      throw new Error(`${fieldName} failed new key verification.`);
    }

    return { ciphertext: rotatedCiphertext, status: 'rotated' };
  }

  if (tryDecryptWithKey(ciphertext, keys.newKey) !== null) {
    return { ciphertext, status: 'alreadyRotated' };
  }

  throw new Error(`${fieldName} ciphertext could not be decrypted with old or new key.`);
}

export function rotateIntegrationTokenRow(
  row: IntegrationTokenRow,
  keys: RotationKeys,
): RowRotationResult {
  const data: RowRotationResult['data'] = {};
  const access = rotateCiphertext(row.accessTokenEncrypted, 'accessTokenEncrypted', keys);
  let changed = false;

  if (access.status === 'rotated') {
    data.accessTokenEncrypted = access.ciphertext;
    changed = true;
  }

  let refreshStatus: RowRotationResult['refreshStatus'] = 'absent';
  if (row.refreshTokenEncrypted !== null) {
    const refresh = rotateCiphertext(
      row.refreshTokenEncrypted,
      'refreshTokenEncrypted',
      keys,
    );
    refreshStatus = refresh.status;

    if (refresh.status === 'rotated') {
      data.refreshTokenEncrypted = refresh.ciphertext;
      changed = true;
    }
  }

  return {
    accessStatus: access.status,
    changed,
    data,
    refreshStatus,
  };
}

function createEmptyStats(): RotationStats {
  return {
    accessTokensAlreadyRotated: 0,
    accessTokensRotated: 0,
    alreadyRotatedRows: 0,
    failedRows: 0,
    processedRows: 0,
    refreshTokensAlreadyRotated: 0,
    refreshTokensRotated: 0,
    rowsNeedingRotation: 0,
    rowsWritten: 0,
  };
}

function updateStats(stats: RotationStats, rowResult: RowRotationResult, mode: RotationMode): void {
  if (rowResult.accessStatus === 'rotated') {
    stats.accessTokensRotated += 1;
  } else {
    stats.accessTokensAlreadyRotated += 1;
  }

  if (rowResult.refreshStatus === 'rotated') {
    stats.refreshTokensRotated += 1;
  } else if (rowResult.refreshStatus === 'alreadyRotated') {
    stats.refreshTokensAlreadyRotated += 1;
  }

  if (rowResult.changed) {
    stats.rowsNeedingRotation += 1;
    if (mode === 'apply') {
      stats.rowsWritten += 1;
    }
  } else {
    stats.alreadyRotatedRows += 1;
  }
}

function printProgress(stats: RotationStats, mode: RotationMode): void {
  process.stdout.write(
    `\r  integration_token: ${stats.processedRows} scanned, ` +
      `${stats.rowsNeedingRotation} need rotation, ` +
      `${mode === 'apply' ? `${stats.rowsWritten} written, ` : ''}` +
      `${stats.alreadyRotatedRows} already rotated`,
  );
}

export async function rotateDatabaseTokens(
  prisma: PrismaClient,
  options: RotateDatabaseOptions,
): Promise<RotationStats> {
  const stats = createEmptyStats();
  let cursor: string | undefined;

  while (true) {
    const rows = await prisma.integrationToken.findMany({
      take: options.chunkSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        accessTokenEncrypted: true,
        id: true,
        orgId: true,
        provider: true,
        refreshTokenEncrypted: true,
      },
    });

    if (rows.length === 0) {
      break;
    }

    const lastRow = rows.at(-1);
    if (lastRow) {
      cursor = lastRow.id;
    }

    for (const row of rows) {
      stats.processedRows += 1;

      try {
        const rowResult = rotateIntegrationTokenRow(row, options.keys);

        if (rowResult.changed && options.mode === 'apply') {
          await prisma.integrationToken.update({
            data: rowResult.data,
            where: { id: row.id },
          });
        }

        updateStats(stats, rowResult, options.mode);
      } catch (error: unknown) {
        stats.failedRows += 1;
        throw new Error(
          `IntegrationToken ${row.id} (${row.provider}, org ${row.orgId}) failed rotation: ${formatError(error)}`,
          { cause: error },
        );
      }

      if (stats.processedRows % 100 === 0) {
        printProgress(stats, options.mode);
      }
    }
  }

  printProgress(stats, options.mode);
  process.stdout.write('\n');
  return stats;
}

function printSummary(stats: RotationStats, mode: RotationMode): void {
  process.stdout.write('\n=== Summary ===\n');
  process.stdout.write(`Rows scanned:              ${stats.processedRows}\n`);
  process.stdout.write(`Rows needing rotation:     ${stats.rowsNeedingRotation}\n`);
  process.stdout.write(`Rows already rotated:      ${stats.alreadyRotatedRows}\n`);
  process.stdout.write(`Rows written:              ${stats.rowsWritten}\n`);
  process.stdout.write(`Access tokens rotated:     ${stats.accessTokensRotated}\n`);
  process.stdout.write(`Refresh tokens rotated:    ${stats.refreshTokensRotated}\n`);
  process.stdout.write(`Access tokens already new: ${stats.accessTokensAlreadyRotated}\n`);
  process.stdout.write(`Refresh tokens already new:${stats.refreshTokensAlreadyRotated}\n`);

  if (mode === 'dry-run') {
    process.stdout.write('\n[DRY RUN COMPLETE] Re-run with --apply to write rotated ciphertexts.\n');
  } else {
    process.stdout.write('\nRotation complete. Keep INTEGRATION_TOKEN_KEY_PREV until app/API smoke tests pass.\n');
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function randomKey(): string {
  return randomBytes(32).toString('hex');
}

export function runSelftest(): void {
  const originalIntegrationKey = process.env.INTEGRATION_TOKEN_KEY;

  try {
    const oldKey = randomKey();
    const newKey = randomKey();
    const unrelatedKey = randomKey();
    const accessPlaintext = 'apollo-access-token-sample';
    const refreshPlaintext = 'seamless-refresh-token-sample';

    const oldAccess = encryptWithKey(accessPlaintext, oldKey);
    const oldRefresh = encryptWithKey(refreshPlaintext, oldKey);
    const rotated = rotateIntegrationTokenRow(
      {
        accessTokenEncrypted: oldAccess,
        id: '11111111-1111-4111-8111-111111111111',
        orgId: '22222222-2222-4222-8222-222222222222',
        provider: 'APOLLO',
        refreshTokenEncrypted: oldRefresh,
      },
      { newKey, oldKey },
    );

    assert.equal(rotated.changed, true);
    assert.equal(rotated.accessStatus, 'rotated');
    assert.equal(rotated.refreshStatus, 'rotated');
    assert.equal(
      decryptWithKey(assertString(rotated.data.accessTokenEncrypted), newKey),
      accessPlaintext,
    );
    assert.equal(
      decryptWithKey(assertString(rotated.data.refreshTokenEncrypted), newKey),
      refreshPlaintext,
    );

    const newAccess = encryptWithKey(accessPlaintext, newKey);
    const alreadyRotated = rotateIntegrationTokenRow(
      {
        accessTokenEncrypted: newAccess,
        id: '33333333-3333-4333-8333-333333333333',
        orgId: '44444444-4444-4444-8444-444444444444',
        provider: 'SEAMLESS',
        refreshTokenEncrypted: null,
      },
      { newKey, oldKey },
    );

    assert.equal(alreadyRotated.changed, false);
    assert.equal(alreadyRotated.accessStatus, 'alreadyRotated');

    const mixed = rotateIntegrationTokenRow(
      {
        accessTokenEncrypted: encryptWithKey(accessPlaintext, oldKey),
        id: '55555555-5555-4555-8555-555555555555',
        orgId: '66666666-6666-4666-8666-666666666666',
        provider: 'TECH_INTEL_MCP',
        refreshTokenEncrypted: encryptWithKey(refreshPlaintext, newKey),
      },
      { newKey, oldKey },
    );

    assert.equal(mixed.changed, true);
    assert.equal(mixed.accessStatus, 'rotated');
    assert.equal(mixed.refreshStatus, 'alreadyRotated');
    assert.equal(mixed.data.refreshTokenEncrypted, undefined);

    assert.throws(
      () =>
        rotateIntegrationTokenRow(
          {
            accessTokenEncrypted: encryptWithKey(accessPlaintext, unrelatedKey),
            id: '77777777-7777-4777-8777-777777777777',
            orgId: '88888888-8888-4888-8888-888888888888',
            provider: 'OTHER',
            refreshTokenEncrypted: null,
          },
          { newKey, oldKey },
        ),
      /old or new key/,
    );

    assert.deepEqual(validateRotationKeys(makeEnv(oldKey, newKey)), { newKey, oldKey });
    assert.throws(() => validateRotationKeys(makeEnv(oldKey, oldKey)), /must be different/);
    assert.throws(
      () => validateRotationKeys(makeEnv('not-a-hex-key', newKey)),
      /OLD_INTEGRATION_TOKEN_KEY/,
    );
    assert.deepEqual(parseArgs(['--dry-run', '--chunk-size=25']), {
      chunkSize: 25,
      mode: 'dry-run',
    });
    assert.throws(() => parseArgs([]), /Choose a mode/);
    assert.throws(() => parseArgs(['--dry-run', '--apply']), /Choose only one mode/);

    process.env.INTEGRATION_TOKEN_KEY = oldKey;
    assert.throws(() => withIntegrationTokenKey(newKey, () => {
      throw new Error('forced failure');
    }), /forced failure/);
    assert.equal(process.env.INTEGRATION_TOKEN_KEY, oldKey);

    process.stdout.write('integration token rotation selftest passed\n');
  } finally {
    if (originalIntegrationKey === undefined) {
      delete process.env.INTEGRATION_TOKEN_KEY;
    } else {
      process.env.INTEGRATION_TOKEN_KEY = originalIntegrationKey;
    }
  }
}

function assertString(value: string | null | undefined): string {
  assert.equal(typeof value, 'string');
  return value;
}

function makeEnv(oldKey: string, newKey: string): NodeJS.ProcessEnv {
  return {
    NEW_INTEGRATION_TOKEN_KEY: newKey,
    OLD_INTEGRATION_TOKEN_KEY: oldKey,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === 'help') {
    printHelp();
    return;
  }

  if (options.mode === 'selftest') {
    runSelftest();
    return;
  }

  const keys = validateRotationKeys();
  const prisma = new PrismaClient({ log: ['warn', 'error'] });

  try {
    process.stdout.write('=== BidStack Integration Token Rotation ===\n');
    process.stdout.write(`Mode: ${options.mode === 'dry-run' ? 'DRY RUN' : 'APPLY'}\n`);
    process.stdout.write(`Chunk size: ${options.chunkSize}\n\n`);

    const stats = await rotateDatabaseTokens(prisma, {
      chunkSize: options.chunkSize,
      keys,
      mode: options.mode,
    });
    printSummary(stats, options.mode);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error: unknown) => {
    process.stderr.write(`Fatal: ${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
