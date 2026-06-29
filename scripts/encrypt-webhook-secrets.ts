#!/usr/bin/env tsx

/**
 * One-shot outbound webhook signing-secret encryption backfill.
 *
 * New webhook subscriptions already store `secret` encrypted with
 * INTEGRATION_TOKEN_KEY. Historical rows may still contain plaintext `whsec_`
 * values. This script inventories those rows and, in --apply mode, encrypts
 * them in place without printing row ids, plaintext secrets, or ciphertext.
 *
 * Usage:
 *   tsx scripts/encrypt-webhook-secrets.ts --dry-run
 *   tsx scripts/encrypt-webhook-secrets.ts --apply
 *   tsx scripts/encrypt-webhook-secrets.ts --selftest
 */

import assert from 'node:assert/strict';

import { PrismaClient } from '../packages/db/generated/client/index.js';
import { isWebhookEventKey } from '../packages/shared/src/schemas/webhooks.js';
import {
  _resetIntegrationTokenKey,
  decryptSecret,
  encryptSecret,
  getIntegrationTokenKey,
  hashWebhookSigningSecret,
  isLegacyWebhookSigningSecret,
} from '../packages/shared/src/utils/crypto.js';

const DEFAULT_CHUNK_SIZE = 500;
const MAX_CHUNK_SIZE = 5_000;

type Mode = 'dry-run' | 'apply';
type CliMode = Mode | 'selftest' | 'help';
type RowClassification = 'alreadyEncrypted' | 'plaintext' | 'unknownEventPlaintext' | 'malformed';

interface CliOptions {
  chunkSize: number;
  mode: CliMode;
}

interface WebhookSecretRow {
  id: string;
  secret: string;
  secretHash: string | null;
  events: string[];
}

interface BackfillStats {
  processedRows: number;
  alreadyEncryptedRows: number;
  plaintextRows: number;
  unknownEventPlaintextRows: number;
  malformedRows: number;
  secretHashPresentRows: number;
  missingSecretHashRows: number;
  invalidSecretHashRows: number;
  secretHashRowsWritten: number;
  rowsWritten: number;
}

interface RowWriter {
  writeWebhookSecret(
    row: WebhookSecretRow,
    data: { secret?: string; secretHash?: string },
  ): Promise<boolean>;
}

function printHelp(): void {
  process.stdout.write(`BidStack webhook signing-secret encryption backfill

Usage:
  tsx scripts/encrypt-webhook-secrets.ts --dry-run
  tsx scripts/encrypt-webhook-secrets.ts --apply
  tsx scripts/encrypt-webhook-secrets.ts --selftest

Options:
  --dry-run            Count rows without writing data.
  --apply              Encrypt API-managed legacy whsec_ rows in place.
  --chunk-size <n>     Rows per page, 1-${MAX_CHUNK_SIZE}. Default: ${DEFAULT_CHUNK_SIZE}.
  --selftest           Run parser/classification checks without a database.
`);
}

export function parseArgs(argv: string[]): CliOptions {
  let mode: CliMode | undefined;
  let chunkSize = DEFAULT_CHUNK_SIZE;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      mode = 'help';
    } else if (arg === '--selftest') {
      mode = 'selftest';
    } else if (arg === '--dry-run') {
      if (mode === 'apply') throw new Error('Choose only one mode: --dry-run or --apply.');
      mode = 'dry-run';
    } else if (arg === '--apply') {
      if (mode === 'dry-run') throw new Error('Choose only one mode: --dry-run or --apply.');
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

function isKnownOutboundWebhookRow(row: WebhookSecretRow): boolean {
  return row.events.length > 0 && row.events.every((event) => isWebhookEventKey(event));
}

export function classifyWebhookSecretRow(row: WebhookSecretRow): RowClassification {
  try {
    decryptSecret(row.secret);
    return 'alreadyEncrypted';
  } catch {
    // Continue with legacy plaintext classification below.
  }

  if (!isLegacyWebhookSigningSecret(row.secret)) {
    return 'malformed';
  }

  if (!isKnownOutboundWebhookRow(row)) {
    return 'unknownEventPlaintext';
  }

  return 'plaintext';
}

function emptyStats(): BackfillStats {
  return {
    processedRows: 0,
    alreadyEncryptedRows: 0,
    plaintextRows: 0,
    unknownEventPlaintextRows: 0,
    malformedRows: 0,
    secretHashPresentRows: 0,
    missingSecretHashRows: 0,
    invalidSecretHashRows: 0,
    secretHashRowsWritten: 0,
    rowsWritten: 0,
  };
}

export async function processWebhookSecretRows(
  rows: WebhookSecretRow[],
  mode: Mode,
  writer: RowWriter,
): Promise<BackfillStats> {
  const stats = emptyStats();

  for (const row of rows) {
    stats.processedRows += 1;
    const classification = classifyWebhookSecretRow(row);
    let plaintextSecret: string | null = null;

    if (classification === 'alreadyEncrypted') {
      stats.alreadyEncryptedRows += 1;
      plaintextSecret = decryptSecret(row.secret);
    } else if (classification === 'unknownEventPlaintext') {
      stats.unknownEventPlaintextRows += 1;
      plaintextSecret = row.secret;
    } else if (classification === 'malformed') {
      stats.malformedRows += 1;
      continue;
    } else {
      stats.plaintextRows += 1;
      plaintextSecret = row.secret;
    }

    const expectedSecretHash = hashWebhookSigningSecret(plaintextSecret);
    const writeData: { secret?: string; secretHash?: string } = {};
    if (!row.secretHash) {
      stats.missingSecretHashRows += 1;
      writeData.secretHash = expectedSecretHash;
    } else if (row.secretHash !== expectedSecretHash) {
      stats.invalidSecretHashRows += 1;
      writeData.secretHash = expectedSecretHash;
    } else {
      stats.secretHashPresentRows += 1;
    }

    if (classification === 'plaintext' || classification === 'unknownEventPlaintext') {
      const ciphertext = encryptSecret(row.secret);
      if (decryptSecret(ciphertext) !== row.secret) {
        throw new Error('Webhook signing-secret encryption verification failed.');
      }
      writeData.secret = ciphertext;
    }

    if (mode === 'apply') {
      if (Object.keys(writeData).length > 0 && (await writer.writeWebhookSecret(row, writeData))) {
        stats.rowsWritten += 1;
        if (writeData.secretHash) stats.secretHashRowsWritten += 1;
      }
    }
  }

  return stats;
}

function mergeStats(target: BackfillStats, source: BackfillStats): void {
  for (const key of Object.keys(target) as Array<keyof BackfillStats>) {
    target[key] += source[key];
  }
}

async function runDatabaseBackfill(options: {
  chunkSize: number;
  mode: Mode;
}): Promise<BackfillStats> {
  getIntegrationTokenKey();

  const prisma = new PrismaClient({ log: ['warn', 'error'] });
  const stats = emptyStats();
  let cursor: string | undefined;

  try {
    const writer: RowWriter = {
      async writeWebhookSecret(row, data) {
        const updated = await prisma.webhookSubscription.updateMany({
          where: { id: row.id, secret: row.secret },
          data,
        });
        return updated.count === 1;
      },
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await prisma.webhookSubscription.findMany({
        take: options.chunkSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, secret: true, secretHash: true, events: true },
      });

      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      mergeStats(stats, await processWebhookSecretRows(rows, options.mode, writer));

      process.stdout.write(
        `\r  webhook_subscriptions: ${stats.processedRows} scanned, ${stats.plaintextRows} plaintext, ${stats.alreadyEncryptedRows} encrypted, ${stats.missingSecretHashRows} missing hash, ${stats.rowsWritten} written`,
      );
    }

    process.stdout.write('\n');
    return stats;
  } finally {
    await prisma.$disconnect();
  }
}

function hasBlockingRows(stats: BackfillStats): boolean {
  return stats.malformedRows > 0;
}

function printStats(stats: BackfillStats): void {
  process.stdout.write(`Processed rows: ${stats.processedRows}\n`);
  process.stdout.write(`Already encrypted rows: ${stats.alreadyEncryptedRows}\n`);
  process.stdout.write(`Legacy plaintext rows: ${stats.plaintextRows}\n`);
  process.stdout.write(`Rows written: ${stats.rowsWritten}\n`);
  process.stdout.write(`Unknown-event plaintext rows: ${stats.unknownEventPlaintextRows}\n`);
  process.stdout.write(`Malformed/unreadable rows: ${stats.malformedRows}\n`);
  process.stdout.write(`Secret hash present rows: ${stats.secretHashPresentRows}\n`);
  process.stdout.write(`Missing secret hash rows: ${stats.missingSecretHashRows}\n`);
  process.stdout.write(`Invalid secret hash rows: ${stats.invalidSecretHashRows}\n`);
  process.stdout.write(`Secret hash rows written: ${stats.secretHashRowsWritten}\n`);
}

async function withTestKey<T>(operation: () => Promise<T> | T): Promise<T> {
  const previous = process.env.INTEGRATION_TOKEN_KEY;
  process.env.INTEGRATION_TOKEN_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  _resetIntegrationTokenKey();
  try {
    return await operation();
  } finally {
    if (previous === undefined) {
      delete process.env.INTEGRATION_TOKEN_KEY;
    } else {
      process.env.INTEGRATION_TOKEN_KEY = previous;
    }
    _resetIntegrationTokenKey();
  }
}

async function runSelftest(): Promise<void> {
  await withTestKey(async () => {
    const encryptedSecret = encryptSecret('whsec_already_encrypted');
    const encryptedSecretHash = hashWebhookSigningSecret('whsec_already_encrypted');
    const rows: WebhookSecretRow[] = [
      {
        id: '1',
        secret: encryptedSecret,
        secretHash: encryptedSecretHash,
        events: ['lead.created'],
      },
      { id: '2', secret: 'whsec_legacy_plaintext', secretHash: null, events: ['lead.created'] },
      {
        id: '3',
        secret: 'whsec_unknown_event',
        secretHash: '0'.repeat(64),
        events: ['dust.webhook'],
      },
      { id: '4', secret: 'legacy-not-whsec', secretHash: null, events: ['lead.created'] },
    ];
    const writes: string[] = [];
    const dryRun = await processWebhookSecretRows(rows, 'dry-run', {
      async writeWebhookSecret() {
        throw new Error('dry-run must not write');
      },
    });
    assert.deepEqual(dryRun, {
      processedRows: 4,
      alreadyEncryptedRows: 1,
      plaintextRows: 1,
      unknownEventPlaintextRows: 1,
      malformedRows: 1,
      secretHashPresentRows: 1,
      missingSecretHashRows: 1,
      invalidSecretHashRows: 1,
      secretHashRowsWritten: 0,
      rowsWritten: 0,
    });

    const apply = await processWebhookSecretRows(rows.slice(0, 2), 'apply', {
      async writeWebhookSecret(_row, data) {
        if (data.secret) writes.push(data.secret);
        return true;
      },
    });
    assert.equal(apply.rowsWritten, 1);
    assert.equal(apply.secretHashRowsWritten, 1);
    assert.equal(decryptSecret(writes[0]!), 'whsec_legacy_plaintext');

    assert.throws(() => parseArgs([]), /Choose a mode/);
    assert.throws(() => parseArgs(['--dry-run', '--apply']), /Choose only one mode/);
    assert.equal(parseArgs(['--dry-run', '--chunk-size=25']).chunkSize, 25);
  });

  process.stdout.write('webhook signing-secret encryption selftest passed\n');
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === 'help') {
    printHelp();
    process.exit(0);
  }
  if (options.mode === 'selftest') {
    await runSelftest();
    process.exit(0);
  }

  const stats = await runDatabaseBackfill({
    chunkSize: options.chunkSize,
    mode: options.mode,
  });
  printStats(stats);

  if (hasBlockingRows(stats)) {
    process.stderr.write(
      'Webhook signing-secret backfill found malformed or unknown-purpose plaintext rows; resolve before release.\n',
    );
    process.exit(1);
  }

  if (options.mode === 'dry-run' && stats.plaintextRows > 0) {
    process.stdout.write(
      'Dry run complete: rerun with --apply to encrypt legacy plaintext rows and fill missing secret hashes.\n',
    );
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
