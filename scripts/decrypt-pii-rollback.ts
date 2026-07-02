/**
 * Emergency PII decryption rollback script.
 *
 * WHY: If PII_FIELD_ENCRYPTION must be turned off (e.g. key management
 * incident, upgrade blocked, emergency access needed by legacy tooling),
 * this script reverses the encrypt-existing-pii.ts migration by decrypting
 * all current enc:v1 envelopes back to plaintext. It also decrypts legacy
 * User.email envelopes from the pre-User.emailHash implementation so auth can
 * recover if that older script was ever run.
 *
 * WARNING: Running this script stores PII as plaintext in PostgreSQL.
 * Use only under an approved incident/rollback plan.
 *
 * SAFETY: every decrypted value is checked against the decryption-failure
 * masks before it is written. If the master key is wrong/rotated, the script
 * aborts on the first undecryptable row instead of overwriting ciphertext
 * with masks (which would be unrecoverable). Run --dry-run first — it
 * decrypts and validates every row without writing.
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
import { decryptPiiField, isEncrypted } from '../packages/shared/src/crypto/pii-field-cipher.js';

const CHUNK_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');

// decryptPiiField NEVER throws — on any failure (wrong/rotated master key,
// corrupt envelope) it returns these masks. Writing a mask over the ciphertext
// would permanently destroy the PII: the mask has no enc:v1: prefix, so a
// re-run skips the row as plaintext and the original envelope is gone. Guard
// every decrypted value and abort loudly instead (same contract as
// encrypt-existing-pii.ts's EMAIL_DECRYPTION_MASK check).
const DECRYPTION_MASKS: Record<'email' | 'phone', string> = {
  email: '***@***.***',
  phone: '***-***-****',
};

function decryptOrAbort(
  model: string,
  rowId: string,
  envelope: string,
  orgId: string,
  fieldType: 'email' | 'phone',
): string {
  const plain = decryptPiiField(envelope, orgId, fieldType);
  if (plain === DECRYPTION_MASKS[fieldType]) {
    throw new Error(
      `Unable to decrypt ${model} ${rowId} ${fieldType}; ` +
        'check PII_ENCRYPTION_MASTER_KEY before continuing. ' +
        'No mask was written — the ciphertext is intact.',
    );
  }
  return plain;
}

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
      select: { id: true, orgId: true, email: true, emailHash: true, phone: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      stats.processed++;
      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      if (typeof row.email === 'string' && isEncrypted(row.email)) {
        updates.email = decryptOrAbort('Contact', row.id, row.email, row.orgId, 'email');
        updates.emailHash = null; // clear the search hash
        needsUpdate = true;
      } else if (row.emailHash !== null) {
        updates.emailHash = null;
        needsUpdate = true;
      }
      if (typeof row.phone === 'string' && isEncrypted(row.phone)) {
        updates.phone = decryptOrAbort('Contact', row.id, row.phone, row.orgId, 'phone');
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
      select: { id: true, orgId: true, email: true, emailHash: true, phone: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      stats.processed++;
      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      if (typeof row.email === 'string' && isEncrypted(row.email)) {
        updates.email = decryptOrAbort('Lead', row.id, row.email, row.orgId, 'email');
        updates.emailHash = null;
        needsUpdate = true;
      } else if (row.emailHash !== null) {
        updates.emailHash = null;
        needsUpdate = true;
      }
      if (typeof row.phone === 'string' && isEncrypted(row.phone)) {
        updates.phone = decryptOrAbort('Lead', row.id, row.phone, row.orgId, 'phone');
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

    process.stdout.write(`\r  leads: ${stats.processed} processed, ${stats.decrypted} decrypted`);
  }

  process.stdout.write('\n');
  return stats;
}

async function rollbackKamConsultants(): Promise<Stats> {
  const stats: Stats = { processed: 0, decrypted: 0, skipped: 0 };
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

      if (typeof row.email === 'string' && isEncrypted(row.email)) {
        const plain = decryptOrAbort('KamConsultant', row.id, row.email, row.orgId, 'email');
        const updates = { email: plain, emailHash: null };
        stats.decrypted++;
        if (!DRY_RUN) {
          await prisma.kamConsultant.update({ where: { id: row.id }, data: updates });
        }
      } else if (row.emailHash !== null) {
        stats.decrypted++;
        if (!DRY_RUN) {
          await prisma.kamConsultant.update({
            where: { id: row.id },
            data: { emailHash: null },
          });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  kam_consultants: ${stats.processed} processed, ${stats.decrypted} decrypted`,
    );
  }

  process.stdout.write('\n');
  return stats;
}

async function rollbackLegacyUsers(): Promise<Stats> {
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
        const plain = decryptOrAbort('User', row.id, row.email, row.orgId, 'email');
        stats.decrypted++;
        if (!DRY_RUN) {
          await prisma.user.update({ where: { id: row.id }, data: { email: plain } });
        }
      } else {
        stats.skipped++;
      }
    }

    process.stdout.write(
      `\r  legacy_users: ${stats.processed} processed, ${stats.decrypted} decrypted`,
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
  process.stdout.write(
    `Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE (DESTRUCTIVE — stores plaintext PII)'}\n\n`,
  );

  if (!DRY_RUN) {
    process.stdout.write(
      'WARNING: This will store PII as plaintext in PostgreSQL.\n' +
        'Confirm with CTRL-C within 5 seconds to abort.\n',
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  const contactStats = await rollbackContacts();
  const leadStats = await rollbackLeads();
  const kamConsultantStats = await rollbackKamConsultants();
  const legacyUserStats = await rollbackLegacyUsers();

  process.stdout.write('\n=== Summary ===\n');
  process.stdout.write(`Contact: ${contactStats.decrypted} decrypted\n`);
  process.stdout.write(`Lead:    ${leadStats.decrypted} decrypted\n`);
  process.stdout.write(`KAM:     ${kamConsultantStats.decrypted} decrypted\n`);
  process.stdout.write(`Legacy User: ${legacyUserStats.decrypted} decrypted\n`);
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`Fatal: ${String(err)}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
