/**
 * One-shot PII encryption migration script.
 *
 * WHY: When PII_FIELD_ENCRYPTION is first enabled, existing rows in Contact,
 * Lead, and User still contain plaintext values. This script encrypts them
 * in-place and populates the `emailHash` columns so equality lookups continue
 * to work after the switch.
 *
 * EXECUTION ORDER (critical — do NOT reverse):
 *   1. Set PII_ENCRYPTION_MASTER_KEY in the environment (generate: openssl rand -hex 32)
 *   2. Run this script against production while PII_FIELD_ENCRYPTION is still DISABLED
 *   3. Verify row counts match (script prints before/after stats)
 *   4. Set PII_FIELD_ENCRYPTION=true and deploy the new API build
 *
 * IDEMPOTENT: rows already starting with `enc:v1:` are skipped.
 * CHUNKED: processes 1000 rows at a time to avoid long transactions.
 *
 * Usage:
 *   tsx scripts/encrypt-existing-pii.ts
 *   tsx scripts/encrypt-existing-pii.ts --dry-run
 */

import { PrismaClient } from '../packages/db/generated/client/index.js';
import {
  encryptPiiField,
  hashPiiField,
  isEncrypted,
} from '../packages/shared/src/crypto/pii-field-cipher.js';

const CHUNK_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

interface Stats {
  processed: number;
  encrypted: number;
  skipped: number;
}

async function processContacts(): Promise<Stats> {
  const stats: Stats = { processed: 0, encrypted: 0, skipped: 0 };
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await prisma.contact.findMany({
      take: CHUNK_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, orgId: true, email: true, phone: true },
    });

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      stats.processed++;
      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      if (typeof row.email === 'string' && row.email.length > 0 && !isEncrypted(row.email)) {
        updates.email = encryptPiiField(row.email, row.orgId);
        updates.emailHash = hashPiiField(row.email, row.orgId);
        needsUpdate = true;
      }

      if (typeof row.phone === 'string' && row.phone.length > 0 && !isEncrypted(row.phone)) {
        updates.phone = encryptPiiField(row.phone, row.orgId);
        needsUpdate = true;
      }

      if (needsUpdate) {
        stats.encrypted++;
        if (!DRY_RUN) {
          await prisma.contact.update({ where: { id: row.id }, data: updates });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  contacts: ${stats.processed} processed, ${stats.encrypted} encrypted, ${stats.skipped} skipped`,
    );
  }

  process.stdout.write('\n');
  return stats;
}

async function processLeads(): Promise<Stats> {
  const stats: Stats = { processed: 0, encrypted: 0, skipped: 0 };
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await prisma.lead.findMany({
      take: CHUNK_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, orgId: true, email: true, phone: true },
    });

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      stats.processed++;
      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      if (typeof row.email === 'string' && row.email.length > 0 && !isEncrypted(row.email)) {
        updates.email = encryptPiiField(row.email, row.orgId);
        updates.emailHash = hashPiiField(row.email, row.orgId);
        needsUpdate = true;
      }

      if (typeof row.phone === 'string' && row.phone.length > 0 && !isEncrypted(row.phone)) {
        updates.phone = encryptPiiField(row.phone, row.orgId);
        needsUpdate = true;
      }

      if (needsUpdate) {
        stats.encrypted++;
        if (!DRY_RUN) {
          await prisma.lead.update({ where: { id: row.id }, data: updates });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  leads: ${stats.processed} processed, ${stats.encrypted} encrypted, ${stats.skipped} skipped`,
    );
  }

  process.stdout.write('\n');
  return stats;
}

async function processUsers(): Promise<Stats> {
  const stats: Stats = { processed: 0, encrypted: 0, skipped: 0 };
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await prisma.user.findMany({
      take: CHUNK_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, orgId: true, email: true },
    });

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      stats.processed++;

      if (typeof row.email === 'string' && row.email.length > 0 && !isEncrypted(row.email)) {
        stats.encrypted++;
        if (!DRY_RUN) {
          await prisma.user.update({
            where: { id: row.id },
            data: { email: encryptPiiField(row.email, row.orgId) },
          });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  users: ${stats.processed} processed, ${stats.encrypted} encrypted, ${stats.skipped} skipped`,
    );
  }

  process.stdout.write('\n');
  return stats;
}

async function main(): Promise<void> {
  if (DRY_RUN) {
    process.stdout.write('[DRY RUN] No data will be written.\n');
  }

  if (!process.env.PII_ENCRYPTION_MASTER_KEY) {
    process.stderr.write(
      'ERROR: PII_ENCRYPTION_MASTER_KEY is not set. Aborting.\n',
    );
    process.exit(1);
  }

  process.stdout.write('=== BidStack PII Encryption Migration ===\n');
  process.stdout.write(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n\n`);

  process.stdout.write('Processing Contact table...\n');
  const contactStats = await processContacts();

  process.stdout.write('Processing Lead table...\n');
  const leadStats = await processLeads();

  process.stdout.write('Processing User table...\n');
  const userStats = await processUsers();

  process.stdout.write('\n=== Summary ===\n');
  process.stdout.write(
    `Contact: ${contactStats.encrypted} encrypted, ${contactStats.skipped} skipped\n`,
  );
  process.stdout.write(
    `Lead:    ${leadStats.encrypted} encrypted, ${leadStats.skipped} skipped\n`,
  );
  process.stdout.write(
    `User:    ${userStats.encrypted} encrypted, ${userStats.skipped} skipped\n`,
  );

  const totalEncrypted =
    contactStats.encrypted + leadStats.encrypted + userStats.encrypted;
  process.stdout.write(
    `\nTotal rows encrypted: ${totalEncrypted}\n`,
  );

  if (DRY_RUN) {
    process.stdout.write(
      '\n[DRY RUN COMPLETE] Re-run without --dry-run to apply changes.\n',
    );
  } else {
    process.stdout.write(
      '\nMigration complete. You may now set PII_FIELD_ENCRYPTION=true.\n',
    );
  }
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`Fatal: ${String(err)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
