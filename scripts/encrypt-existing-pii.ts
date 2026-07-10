/**
 * One-shot PII encryption migration script.
 *
 * WHY: When PII_FIELD_ENCRYPTION is first enabled, existing rows in Contact,
 * Lead, and KamConsultant still contain plaintext values. This script encrypts
 * them in-place and populates the `emailHash` columns so equality lookups
 * continue to work after the switch.
 *
 * EXECUTION ORDER (critical — do NOT reverse):
 *   1. Set PII_ENCRYPTION_MASTER_KEY in the environment (generate: openssl rand -hex 32)
 *   2. Run this script against production while PII_FIELD_ENCRYPTION is still DISABLED
 *   3. Verify row counts match (script prints before/after stats)
 *   4. Set PII_FIELD_ENCRYPTION=true and deploy the new API build
 *
 * IDEMPOTENT: rows already starting with `enc:v1:` are not re-encrypted; their
 * canonical emailHash is repaired if needed.
 * CHUNKED: processes 1000 rows at a time to avoid long transactions.
 *
 * Usage:
 *   tsx scripts/encrypt-existing-pii.ts
 *   tsx scripts/encrypt-existing-pii.ts --dry-run
 */

import { PrismaClient } from '../packages/db/generated/client/index.js';
import {
  decryptPiiField,
  encryptPiiField,
  hashPiiField,
  isEncrypted,
} from '../packages/shared/src/crypto/pii-field-cipher.js';

const CHUNK_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');
const EMAIL_DECRYPTION_MASK = '***@***.***';

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

interface Stats {
  processed: number;
  updated: number;
  skipped: number;
}

interface EmailHashRow {
  id: string;
  orgId: string;
  email: string | null;
  emailHash: string | null;
}

function applyEmailEncryptionUpdates(
  modelName: string,
  row: EmailHashRow,
  updates: Record<string, unknown>,
): boolean {
  if (!row.email) {
    if (row.emailHash !== null) {
      updates.emailHash = null;
      return true;
    }
    return false;
  }

  const plainEmail = isEncrypted(row.email)
    ? decryptPiiField(row.email, row.orgId, 'email')
    : row.email;

  if (plainEmail === EMAIL_DECRYPTION_MASK) {
    throw new Error(
      `Unable to decrypt ${modelName} ${row.id}; check PII_ENCRYPTION_MASTER_KEY before continuing.`,
    );
  }

  let changed = false;
  if (!isEncrypted(row.email)) {
    updates.email = encryptPiiField(row.email, row.orgId);
    changed = true;
  }

  const canonicalHash = hashPiiField(plainEmail, row.orgId);
  if (row.emailHash !== canonicalHash) {
    updates.emailHash = canonicalHash;
    changed = true;
  }

  return changed;
}

async function processContacts(): Promise<Stats> {
  const stats: Stats = { processed: 0, updated: 0, skipped: 0 };
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await prisma.contact.findMany({
      take: CHUNK_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, orgId: true, email: true, emailHash: true, phone: true },
    });

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      stats.processed++;
      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      if (applyEmailEncryptionUpdates('Contact', row, updates)) {
        needsUpdate = true;
      }

      if (typeof row.phone === 'string' && row.phone.length > 0 && !isEncrypted(row.phone)) {
        updates.phone = encryptPiiField(row.phone, row.orgId);
        needsUpdate = true;
      }

      if (needsUpdate) {
        stats.updated++;
        if (!DRY_RUN) {
          await prisma.contact.update({ where: { id: row.id }, data: updates });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  contacts: ${stats.processed} processed, ${stats.updated} updated, ${stats.skipped} skipped`,
    );
  }

  process.stdout.write('\n');
  return stats;
}

async function processLeads(): Promise<Stats> {
  const stats: Stats = { processed: 0, updated: 0, skipped: 0 };
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await prisma.lead.findMany({
      take: CHUNK_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, orgId: true, email: true, emailHash: true, phone: true },
    });

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      stats.processed++;
      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      if (applyEmailEncryptionUpdates('Lead', row, updates)) {
        needsUpdate = true;
      }

      if (typeof row.phone === 'string' && row.phone.length > 0 && !isEncrypted(row.phone)) {
        updates.phone = encryptPiiField(row.phone, row.orgId);
        needsUpdate = true;
      }

      if (needsUpdate) {
        stats.updated++;
        if (!DRY_RUN) {
          await prisma.lead.update({ where: { id: row.id }, data: updates });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  leads: ${stats.processed} processed, ${stats.updated} updated, ${stats.skipped} skipped`,
    );
  }

  process.stdout.write('\n');
  return stats;
}

async function processKamConsultants(): Promise<Stats> {
  const stats: Stats = { processed: 0, updated: 0, skipped: 0 };
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await prisma.kamConsultant.findMany({
      take: CHUNK_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, orgId: true, email: true, emailHash: true },
    });

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      stats.processed++;

      const updates: Record<string, unknown> = {};
      if (applyEmailEncryptionUpdates('KamConsultant', row, updates)) {
        stats.updated++;
        if (!DRY_RUN) {
          await prisma.kamConsultant.update({
            where: { id: row.id },
            data: updates,
          });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  kam_consultants: ${stats.processed} processed, ${stats.updated} updated, ${stats.skipped} skipped`,
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
    process.stderr.write('ERROR: PII_ENCRYPTION_MASTER_KEY is not set. Aborting.\n');
    process.exit(1);
  }

  process.stdout.write('=== BidStack PII Encryption Migration ===\n');
  process.stdout.write(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n\n`);

  process.stdout.write('Processing Contact table...\n');
  const contactStats = await processContacts();

  process.stdout.write('Processing Lead table...\n');
  const leadStats = await processLeads();

  process.stdout.write('Processing KamConsultant table...\n');
  const kamConsultantStats = await processKamConsultants();

  process.stdout.write('\n=== Summary ===\n');
  process.stdout.write(
    `Contact: ${contactStats.updated} updated, ${contactStats.skipped} skipped\n`,
  );
  process.stdout.write(`Lead:    ${leadStats.updated} updated, ${leadStats.skipped} skipped\n`);
  process.stdout.write(
    `KAM:     ${kamConsultantStats.updated} updated, ${kamConsultantStats.skipped} skipped\n`,
  );

  const totalUpdated = contactStats.updated + leadStats.updated + kamConsultantStats.updated;
  process.stdout.write(`\nTotal rows updated: ${totalUpdated}\n`);

  if (DRY_RUN) {
    process.stdout.write('\n[DRY RUN COMPLETE] Re-run without --dry-run to apply changes.\n');
  } else {
    process.stdout.write('\nMigration complete. You may now set PII_FIELD_ENCRYPTION=true.\n');
  }
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`Fatal: ${String(err)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
