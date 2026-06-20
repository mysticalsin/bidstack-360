// GDPR Article 17 (right to erasure) — per-data-subject anonymization.
//
// An org-admin requests erasure of a single data subject (a Contact or a Lead)
// by id. The subject's PII is scrubbed to deterministic tombstones in one
// transaction, the row is soft-deleted, and directly-reachable child PII (a
// contact's ActivityAttendee.email copies) is scrubbed too. The action is
// recorded as a `gdpr.erasure` audit_log row — there is NO dedicated erasure
// table (a Prisma regen is blocked on this machine; the audit log is the
// durable record).
//
// Admin gate: `settings:write` (Admin-only in the canonical RBAC matrix — the
// same gate the GDPR Art. 20 export route uses, so no new permission key and no
// re-seed). Cross-tenant guard: :orgId MUST equal the caller's authenticated
// org. The subject is loaded org-scoped (404 if missing / wrong tenant).
//
// Idempotent: erasing an already-erased subject returns the same summary
// (already-scrubbed fields are detected by their tombstone values and the write
// is a no-op for them), never an error.
//
// Scope (deliberately conservative — Rule 2 / Rule 3): only PII the route can
// reach via a CLEAR foreign key is touched. Contact/Lead Notes, FileAttachments
// and Activities attach to an account via a free-text `accountId` / `companyId`,
// NOT to the person — scrubbing them would over-reach and could erase another
// subject's data, so they are intentionally left alone.

import { createHash } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { Prisma, prisma } from '@bidstack/db';
import { ErasureOrgParams, ErasureRequest, ErasureSummary } from '@bidstack/shared';

// Deterministic tombstones. Stable across re-runs so a second erasure is a
// no-op and the audit trail reads identically.
const TOMBSTONE = {
  name: 'Erased subject',
  freeText: '[erased]',
} as const;

/**
 * Build the deterministic tombstone email for a subject. A null email is left
 * null; a present email becomes `erased+<hash>@erased.invalid` where the hash is
 * derived from (orgId, subjectId) so it is stable across re-runs and cannot be
 * reversed to the original address. `.invalid` is the reserved non-routable TLD
 * (RFC 2606), so the address can never receive mail.
 */
function tombstoneEmail(orgId: string, subjectId: string): string {
  const hash = createHash('sha256').update(`${orgId}:${subjectId}`).digest('hex').slice(0, 16);
  return `erased+${hash}@erased.invalid`;
}

export const erasureRoutes: FastifyPluginAsyncZod = async (server) => {
  // POST /orgs/:orgId/erasure — anonymize one data subject (contact | lead).
  server.post(
    '/orgs/:orgId/erasure',
    {
      config: { permission: 'settings:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('settings:write'),
      schema: {
        params: ErasureOrgParams,
        body: ErasureRequest,
        response: { 200: ErasureSummary },
      },
    },
    async (req) => {
      // Cross-tenant guard: never erase a subject in another org.
      if (req.params.orgId !== req.auth.orgId) {
        throw req.server.httpErrors.forbidden('Cannot erase a subject in another organization');
      }
      const orgId = req.auth.orgId;
      const { subjectType, subjectId } = req.body;

      return subjectType === 'contact'
        ? eraseContact(orgId, subjectId, req)
        : eraseLead(orgId, subjectId, req);
    },
  );
};

// ─── contact erasure ──────────────────────────────────────────────────────────

async function eraseContact(
  orgId: string,
  subjectId: string,
  req: FastifyRequest,
): Promise<ErasureSummary> {
  // Load org-scoped, INCLUDING soft-deleted rows: an already-erased subject must
  // still be found so re-erasing is idempotent (not a 404). The global
  // soft-delete middleware auto-injects `deletedAt: null` UNLESS the caller sets
  // `deletedAt` explicitly; `{ not: undefined }` is an empty filter (matches all
  // rows) that also flips off the auto-injection.
  const contact = await prisma.contact.findFirst({
    where: { id: subjectId, orgId, deletedAt: { not: undefined } },
    select: { id: true, name: true, email: true, phone: true, deletedAt: true },
  });
  if (!contact) throw req.server.httpErrors.notFound('Subject not found');

  const tombEmail = tombstoneEmail(orgId, contact.id);
  const scrubbedFields: string[] = [];
  if (contact.name !== TOMBSTONE.name) scrubbedFields.push('name');
  if (contact.email !== null && contact.email !== tombEmail) scrubbedFields.push('email');
  if (contact.phone !== null) scrubbedFields.push('phone');

  const now = new Date();
  // Interactive transaction so the audit diff can record the exact count of
  // child PII rows scrubbed (the array form cannot reference one result inside
  // another statement).
  const relatedScrubbed = await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      // deletedAt:{not:undefined} = match-all bypass so the soft-delete $use
      // middleware does NOT scope this to live rows — GDPR erasure must scrub PII
      // from an already soft-deleted subject too, and must stay idempotent.
      where: { id: contact.id, deletedAt: { not: undefined } },
      data: {
        name: TOMBSTONE.name,
        // Citext column: keep a deterministic, non-routable, unique-per-subject
        // tombstone so an org-unique email constraint (if any) is never violated.
        email: contact.email === null ? null : tombEmail,
        phone: null,
        // Soft-delete idempotently: preserve the original deletion time if the
        // subject was already soft-deleted.
        deletedAt: contact.deletedAt ?? now,
      },
    });
    // Directly-reachable child PII: an attendee row carries a COPY of the
    // contact's email. Scrub it for every attendee linked to this contact.
    const attendee = await tx.activityAttendee.updateMany({
      where: { orgId, contactId: contact.id, email: { not: null } },
      data: { email: null },
    });
    const related = { activityAttendeeEmails: attendee.count };
    await tx.auditLog.create({
      data: {
        orgId,
        userId: req.auth.userId,
        action: 'gdpr.erasure',
        targetType: 'contact',
        targetId: contact.id,
        diff: {
          subjectType: 'contact',
          subjectId: contact.id,
          scrubbedFields,
          relatedScrubbed: related,
        } satisfies Prisma.InputJsonObject,
      },
    });
    return related;
  });

  return {
    subjectType: 'contact',
    subjectId: contact.id,
    scrubbedFields,
    relatedScrubbed,
    erasedAt: now.toISOString(),
  };
}

// ─── lead erasure ──────────────────────────────────────────────────────────────

async function eraseLead(
  orgId: string,
  subjectId: string,
  req: FastifyRequest,
): Promise<ErasureSummary> {
  // INCLUDING soft-deleted rows (idempotent re-erasure) — see eraseContact.
  const lead = await prisma.lead.findFirst({
    where: { id: subjectId, orgId, deletedAt: { not: undefined } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      notes: true,
      intel: true,
      deletedAt: true,
    },
  });
  if (!lead) throw req.server.httpErrors.notFound('Subject not found');

  const tombEmail = tombstoneEmail(orgId, lead.id);
  const scrubbedFields: string[] = [];
  if (lead.firstName !== TOMBSTONE.name) scrubbedFields.push('firstName');
  if (lead.lastName !== '') scrubbedFields.push('lastName');
  if (lead.email !== null && lead.email !== tombEmail) scrubbedFields.push('email');
  if (lead.phone !== null) scrubbedFields.push('phone');
  if (lead.notes !== null && lead.notes !== TOMBSTONE.freeText) scrubbedFields.push('notes');
  // `intel` is enrichment JSON that can carry PII (scraped bios, contact data).
  // Erasing it to null is safe and unambiguous.
  if (lead.intel !== null) scrubbedFields.push('intel');

  const now = new Date();
  await prisma.$transaction([
    prisma.lead.update({
      // Match-all bypass (see eraseContact): scrub PII even on a soft-deleted
      // lead and keep re-erasure idempotent under the soft-delete middleware.
      where: { id: lead.id, deletedAt: { not: undefined } },
      data: {
        firstName: TOMBSTONE.name,
        // lastName is NOT NULL — use an empty string as its tombstone.
        lastName: '',
        email: lead.email === null ? null : tombEmail,
        phone: null,
        notes: lead.notes === null ? null : TOMBSTONE.freeText,
        // Json column: `Prisma.JsonNull` sets the DB value to JSON null;
        // `undefined` leaves it untouched (it was already null — no-op).
        intel: lead.intel === null ? undefined : Prisma.JsonNull,
        deletedAt: lead.deletedAt ?? now,
      },
    }),
    prisma.auditLog.create({
      data: {
        orgId,
        userId: req.auth.userId,
        action: 'gdpr.erasure',
        targetType: 'lead',
        targetId: lead.id,
        diff: {
          subjectType: 'lead',
          subjectId: lead.id,
          scrubbedFields,
          relatedScrubbed: {},
        } satisfies Prisma.InputJsonObject,
      },
    }),
  ]);

  return {
    subjectType: 'lead',
    subjectId: lead.id,
    scrubbedFields,
    relatedScrubbed: {},
    erasedAt: now.toISOString(),
  };
}
