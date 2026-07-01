import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashPiiField, isEncrypted } from '@bidstack/shared/crypto/pii-field-cipher';

import type { PrismaClient } from '../generated/client/index.js';

const MASTER_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2';

type RawContactRow = {
  email: string | null;
  phone: string | null;
  email_hash: string | null;
};

let prisma: PrismaClient | null = null;
let dbReachable = false;
let orgId: string | null = null;
let previousPiiFlag: string | undefined;
let previousPiiKey: string | undefined;
let previousTenantGuard: string | undefined;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    return;
  }

  previousPiiFlag = process.env.PII_FIELD_ENCRYPTION;
  previousPiiKey = process.env.PII_ENCRYPTION_MASTER_KEY;
  previousTenantGuard = process.env.BIDSTACK_TENANT_SCOPE_GUARD;
  process.env.PII_FIELD_ENCRYPTION = 'true';
  process.env.PII_ENCRYPTION_MASTER_KEY = MASTER_KEY;
  process.env.BIDSTACK_TENANT_SCOPE_GUARD = 'off';

  vi.resetModules();
  const globalWithPrisma = globalThis as { prisma?: PrismaClient };
  if (globalWithPrisma.prisma) {
    await globalWithPrisma.prisma.$disconnect().catch(() => undefined);
    delete globalWithPrisma.prisma;
  }

  const dbModule = await import('./index.js');
  prisma = dbModule.prisma;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (dbReachable && prisma && orgId) {
    await prisma.org.deleteMany({ where: { id: orgId } }).catch(() => undefined);
  }
  await prisma?.$disconnect().catch(() => undefined);

  restoreEnv('PII_FIELD_ENCRYPTION', previousPiiFlag);
  restoreEnv('PII_ENCRYPTION_MASTER_KEY', previousPiiKey);
  restoreEnv('BIDSTACK_TENANT_SCOPE_GUARD', previousTenantGuard);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

const testIfDb = (name: string, fn: () => Promise<void>) =>
  it.skipIf(!process.env.DATABASE_URL)(name, async () => {
    if (!dbReachable || !prisma) {
      throw new Error(`${name} - DATABASE_URL is configured but not reachable`);
    }
    await fn();
  });

describe('PII field encryption live DB storage', () => {
  testIfDb('stores Contact PII as ciphertext via the @bidstack/db singleton', async () => {
    const client = prisma!;
    orgId = randomUUID();
    const email = `pii-live-${randomUUID()}@example.com`;
    const phone = '+15550109999';

    await client.org.create({
      data: {
        id: orgId,
        clerkOrg: `org_pii_live_${randomUUID()}`,
        name: 'PII Live Ciphertext Test',
      },
    });

    const contact = await client.contact.create({
      data: {
        orgId,
        customer: 'Ciphertext Regression',
        name: 'PII Contact',
        email,
        phone,
      },
    });

    const rows = await client.$queryRaw<RawContactRow[]>`
      SELECT email::text AS email, phone, email_hash
      FROM contacts
      WHERE id = ${contact.id}::uuid
    `;
    const raw = rows[0];

    // WHY: app reads can decrypt transparently, so only raw DB storage proves
    // the middleware was actually registered and plaintext cannot persist.
    expect(raw).toBeDefined();
    expect(raw.email).not.toBe(email);
    expect(raw.phone).not.toBe(phone);
    expect(isEncrypted(raw.email)).toBe(true);
    expect(isEncrypted(raw.phone)).toBe(true);
    expect(raw.email_hash).toBe(hashPiiField(email, orgId));

    const readable = await client.contact.findFirstOrThrow({
      where: { id: contact.id, orgId },
    });
    expect(readable.email).toBe(email);
    expect(readable.phone).toBe(phone);
  });
});
