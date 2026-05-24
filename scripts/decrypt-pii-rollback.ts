/**
 * Emergency PII decryption rollback script.
 *
 * WHY: If PII_FIELD_ENCRYPTION must be turned off (e.g. key management
 * incident, upgrade blocked, emergency access needed by legacy tooling),
 * this script reverses the encrypt-existing-pii.ts migration by decrypting
 * all enc:v1 envelopes back to plaintext.
 *
 * WARNING: Running this script stores PII as plaintext in PostgreSQL.
 * Use only under an approved incident/rollback plan.
 *
 * EXECUTION ORDER:
 *   1. Disable PII_FIELD_ENCRYPTION=false (or remove the env var)
 *   2. Deploy the API build with encryption disabled
 *   3. Run this script
 *   4. Remove or archive the PII_ENCRYPTION_MASTER_KEY from the environment
 *
 * Usage:
 *   tsx scripts/decrypt-pii-rollback.ts
 *   tsx scripts/decrypt-pii-rollback.ts --dry-run
 */

import { PrismaClient } from '../packages/db/generated/client/index.js';
import {
  decryptPiiField,
  isEncrypted,
} from '../packages/shared/src/crypto/pii-field-cipher.js';

const CHUNK_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');

const prisma = new PrismaClient({ log: ['warn', 'error'] });

interface Stats {
  processed: number;
  decrypted: number;
  skipped: number;
}

async function rollbackContacts(): Promise<Stats> {
  const stats: Stats = { processed: 0, decrypted: 0, skipped: 0 };
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

      if (typeof row.email === 'string' && isEncrypted(row.email)) {
        updates.email = decryptPiiField(row.email, row.orgId, 'email');
        updates.emailHash = null; // clear the search hash
        needsUpdate = true;
      }
      if (typeof row.phone === 'string' && isEncrypted(row.phone)) {
        updates.phone = decryptPiiField(row.phone, row.orgId, 'phone');
        needsUpdate = true;
      }

      if (needsUpdate) {
        stats.decrypted++;
        if (!DRY_RUN) {
          await prisma.contact.update({ where: { id: row.id }, data: updates });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  contacts: ${stats.processed} processed, ${stats.decrypted} decrypted`,
    );
  }

  process.stdout.write('\n');
  return stats;
}

async function rollbackLeads(): Promise<Stats> {
  const stats: Stats = { processed: 0, decrypted: 0, skipped: 0 };
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

      if (typeof row.email === 'string' && isEncrypted(row.email)) {
        updates.email = decryptPiiField(row.email, row.orgId, 'email');
        updates.emailHash = null;
        needsUpdate = true;
      }
      if (typeof row.phone === 'string' && isEncrypted(row.phone)) {
        updates.phone = decryptPiiField(row.phone, row.orgId, 'phone');
        needsUpdate = true;
      }

      if (needsUpdate) {
        stats.decrypted++;
        if (!DRY_RUN) {
          await prisma.lead.update({ where: { id: row.id }, data: updates });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  leads: ${stats.processed} processed, ${stats.decrypted} decrypted`,
    );
  }

  process.stdout.write('\n');
  return stats;
}

async function rollbackUsers(): Promise<Stats> {
  const stats: Stats = { processed: 0, decrypted: 0, skipped: 0 };
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

      if (typeof row.email === 'string' && isEncrypted(row.email)) {
        const plain = decryptPiiField(row.email, row.orgId, 'email');
        stats.decrypted++;
        if (!DRY_RUN) {
          await prisma.user.update({ where: { id: row.id }, data: { email: plain } });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  users: ${stats.processed} processed, ${stats.decrypted} decrypted`,
    );
  }

  process.stdout.write('\n');
  return stats;
}

async function main(): Promise<void> {
  if (!process.env.PII_ENCRYPTION_MASTER_KEY) {
    process.stderr.write('ERROR: PII_ENCRYPTION_MASTER_KEY is not set. Aborting.\n');
    process.exit(1);
  }

  process.stdout.write('=== BidStack PII Decryption Rollback ===\n');
  process.stdout.write(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE (DESTRUCTIVE — stores plaintext PII)'}\n\n`);

  if (!DRY_RUN) {
    process.stdout.write(
      'WARNING: This will store PII as plaintext in PostgreSQL.\n' +
        'Confirm with CTRL-C within 5 seconds to abort.\n',
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  const contactStats = await rollbackContacts();
  const leadStats = await rollbackLeads();
  const userStats = await rollbackUsers();

  process.stdout.write('\n=== Summary ===\n');
  process.stdout.write(`Contact: ${contactStats.decrypted} decrypted\n`);
  process.stdout.write(`Lead:    ${leadStats.decrypted} decrypted\n`);
  process.stdout.write(`User:    ${userStats.decrypted} decrypted\n`);
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`Fatal: ${String(err)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
