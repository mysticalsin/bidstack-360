// Integration tests for the GDPR Art. 17 (right to erasure) route.
// Pattern: tenant-export.integration.test.ts — buildServer + inject against the
// isolated org; role switching via the x-bidstack-e2e-role header.
//
// WHY these assertions matter:
//   - an org-admin must be able to ERASE a data subject (Art. 17 right), the
//     subject's PII must be tombstoned in the DB, and a `gdpr.erasure` audit row
//     must be written (the durable compliance record);
//   - a non-admin (read-only) must be REFUSED (settings:write gate) — erasure is
//     irreversible and must be admin-only;
//   - a subjectId in another org (or unknown) must 404 — the core multi-tenancy
//     invariant, an admin must not be able to probe/erase another tenant's data;
//   - erasing twice must be idempotent (no error, same tombstoned state) so a
//     retried compliance request never half-fails.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
} from '../test-support/isolated-org.js';

let server: Awaited<ReturnType<typeof buildServer>>;
let dbReachable = false;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;
let previousStubRoleHeader: string | undefined;

// Subjects created per-test and cleaned up in afterAll. Hard-deleted (these are
// throwaway test rows) so the seed dataset is left pristine.
const createdContactIds: string[] = [];
const createdLeadIds: string[] = [];

beforeAll(async () => {
  previousStubRoleHeader = process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = 'true';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const iso = await createIsolatedOrg('erasure');
  orgId = iso.orgId;
  restoreAuth = useIsolatedOrgAuth(iso.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  if (orgId) {
    if (createdContactIds.length > 0) {
      // Attendee rows FK to the contact — clear them first.
      await prisma.activityAttendee.deleteMany({ where: { contactId: { in: createdContactIds } } });
      await prisma.contact.deleteMany({ where: { orgId, id: { in: createdContactIds } } });
    }
    if (createdLeadIds.length > 0) {
      await prisma.lead.deleteMany({ where: { orgId, id: { in: createdLeadIds } } });
    }
    await prisma.auditLog.deleteMany({
      where: {
        orgId,
        action: 'gdpr.erasure',
        targetId: { in: [...createdContactIds, ...createdLeadIds] },
      },
    });
  }
  restoreAuth?.();
  if (server) await server.close();
  if (orgId) await dropIsolatedOrg(orgId);
  if (dbReachable) await prisma.$disconnect();
  if (previousStubRoleHeader === undefined) {
    delete process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER;
  } else {
    process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER = previousStubRoleHeader;
  }
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable || !orgId) throw new Error(`[skip] ${name}: DB/isolated org unavailable`);
    await fn();
  });

// Unique email per seed — Contact/Lead carry an org-unique email constraint, so
// reused fixtures would collide across cases.
async function seedContact(): Promise<string> {
  const c = await prisma.contact.create({
    data: {
      orgId: orgId!,
      customer: 'erasure-test-account',
      name: 'Jane Subject',
      email: `jane.subject+${randomUUID()}@example.com`,
      phone: '+33123456789',
    },
    select: { id: true },
  });
  createdContactIds.push(c.id);
  return c.id;
}

async function seedLead(): Promise<string> {
  const l = await prisma.lead.create({
    data: {
      orgId: orgId!,
      firstName: 'John',
      lastName: 'Prospect',
      email: `john.prospect+${randomUUID()}@example.com`,
      phone: '+33987654321',
      companyName: 'Acme Corp',
      notes: 'Met at conference, very interested.',
      intel: { bio: 'Senior buyer', linkedin: 'https://example.com/in/jp' },
    },
    select: { id: true },
  });
  createdLeadIds.push(l.id);
  return l.id;
}

// The global Prisma client filters `deletedAt: null` on reads (soft-delete
// middleware). An erased subject is soft-deleted, so to verify the tombstoned
// row we must opt out by filtering on `deletedAt` explicitly.
function findErasedContact(id: string) {
  return prisma.contact.findFirst({
    where: { id, deletedAt: { not: null } },
    select: { name: true, email: true, phone: true, deletedAt: true },
  });
}

describe('GDPR Art. 17 erasure route', () => {
  t('admin erases a contact → 200, PII tombstoned in DB, audit row written', async () => {
    const contactId = await seedContact();
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/erasure`,
      payload: { subjectType: 'contact', subjectId: contactId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      subjectType: string;
      subjectId: string;
      scrubbedFields: string[];
      relatedScrubbed: Record<string, number>;
    };
    expect(body.subjectType).toBe('contact');
    expect(body.subjectId).toBe(contactId);
    // All three PII fields held real values and must be reported as scrubbed.
    expect(body.scrubbedFields.sort()).toEqual(['email', 'name', 'phone']);

    // The DB row must be tombstoned and soft-deleted — verify directly so the
    // test fails if the scrub logic changes.
    const row = await findErasedContact(contactId);
    expect(row?.name).toBe('Erased subject');
    expect(row?.phone).toBeNull();
    expect(row?.email).not.toBe('jane.subject@example.com');
    expect(row?.email).toMatch(/^erased\+[0-9a-f]+@erased\.invalid$/);
    expect(row?.deletedAt).not.toBeNull();

    // The compliance record must exist with the right shape.
    const audit = await prisma.auditLog.findFirst({
      where: { orgId: orgId!, action: 'gdpr.erasure', targetType: 'contact', targetId: contactId },
    });
    expect(audit).not.toBeNull();
    const diff = audit?.diff as { subjectType: string; scrubbedFields: string[] } | null;
    expect(diff?.subjectType).toBe('contact');
    expect(diff?.scrubbedFields.sort()).toEqual(['email', 'name', 'phone']);
  });

  t('admin erases a lead → 200, PII + free-text + intel tombstoned', async () => {
    const leadId = await seedLead();
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/erasure`,
      payload: { subjectType: 'lead', subjectId: leadId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { scrubbedFields: string[] };
    expect(body.scrubbedFields.sort()).toEqual(
      ['email', 'firstName', 'intel', 'lastName', 'notes', 'phone'].sort(),
    );

    const row = await prisma.lead.findFirst({
      where: { id: leadId, deletedAt: { not: null } },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        notes: true,
        intel: true,
        deletedAt: true,
      },
    });
    expect(row?.firstName).toBe('Erased subject');
    expect(row?.lastName).toBe('');
    expect(row?.phone).toBeNull();
    expect(row?.notes).toBe('[erased]');
    expect(row?.intel).toBeNull();
    expect(row?.email).toMatch(/^erased\+[0-9a-f]+@erased\.invalid$/);
    expect(row?.deletedAt).not.toBeNull();
  });

  t('erasing twice is idempotent → 200, empty scrubbedFields on the re-run', async () => {
    const contactId = await seedContact();
    const first = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/erasure`,
      payload: { subjectType: 'contact', subjectId: contactId },
    });
    expect(first.statusCode).toBe(200);

    const second = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/erasure`,
      payload: { subjectType: 'contact', subjectId: contactId },
    });
    expect(second.statusCode).toBe(200);
    // Nothing left to scrub — the re-run reports no fields and does not error.
    expect((second.json() as { scrubbedFields: string[] }).scrubbedFields).toEqual([]);

    // The original deletion timestamp must be preserved (not bumped).
    const row = await findErasedContact(contactId);
    expect(row?.deletedAt).not.toBeNull();
  });

  t('non-admin (read-only) is refused with 403', async () => {
    const contactId = await seedContact();
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/erasure`,
      headers: { 'x-bidstack-e2e-role': 'read-only' },
      payload: { subjectType: 'contact', subjectId: contactId },
    });
    expect(res.statusCode).toBe(403);

    // The denied request must NOT have scrubbed anything.
    const row = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { name: true },
    });
    expect(row?.name).toBe('Jane Subject');
  });

  t('an unknown subjectId in this org returns 404', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${orgId}/erasure`,
      payload: { subjectType: 'contact', subjectId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(res.statusCode).toBe(404);
  });

  t('a cross-org :orgId in the path is refused with 403', async () => {
    const contactId = await seedContact();
    const otherOrgId = '00000000-0000-4000-8000-000000000000';
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/orgs/${otherOrgId}/erasure`,
      payload: { subjectType: 'contact', subjectId: contactId },
    });
    expect(res.statusCode).toBe(403);
  });
});
