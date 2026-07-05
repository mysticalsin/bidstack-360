// Duplicate detection + merge for Companies and Contacts.
//
// GET  /duplicates/companies — candidate clusters (normalized name / domain)
// GET  /duplicates/contacts  — candidate clusters (email / name+account)
// POST /duplicates/merge     — explicit survivor-choice merge of ONE pair
//
// Detection is deterministic and in code (duplicates.helpers.ts) — no LLM, no
// fuzzy scores. Merge never runs automatically: the caller always names the
// survivor. The merge re-points the high-value child relations, soft-deletes
// the loser, and audit-logs the pair inside one transaction. Retrying a merge
// converges to the same state (updateMany no-ops) instead of erroring.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';

import { clusterCompanies, clusterContacts } from './duplicates.helpers.js';

// Detection is an O(n) scan of the org's live rows. Bounded at the
// query-guard ceiling (take > 1000 is rejected as unbounded); oldest rows
// first because the oldest record is the natural survivor and imports append
// duplicates after it. `truncated: true` tells the client to re-scan after
// merging.
const SCAN_CAP = 1_000;

const CompanyDupRecord = z.object({
  id: z.string().uuid(),
  name: z.string(),
  legalName: z.string().nullable(),
  domain: z.string().nullable(),
  website: z.string().nullable(),
  industry: z.string().nullable(),
  countryCode: z.string().nullable(),
  createdAt: z.string(),
  contactCount: z.number().int(),
  opportunityCount: z.number().int(),
});

const ContactDupRecord = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  role: z.string().nullable(),
  phone: z.string().nullable(),
  customer: z.string(),
  companyName: z.string().nullable(),
  createdAt: z.string(),
  opportunityLinkCount: z.number().int(),
});

const CompanyDupResponse = z.object({
  clusters: z.array(
    z.object({
      reasons: z.array(z.enum(['name', 'domain'])),
      companies: z.array(CompanyDupRecord),
    }),
  ),
  scanned: z.number().int(),
  truncated: z.boolean(),
});

const ContactDupResponse = z.object({
  clusters: z.array(
    z.object({
      reasons: z.array(z.enum(['email', 'name-account'])),
      contacts: z.array(ContactDupRecord),
    }),
  ),
  scanned: z.number().int(),
  truncated: z.boolean(),
});

const MergeBody = z
  .object({
    entity: z.enum(['company', 'contact']),
    survivorId: z.string().uuid(),
    duplicateId: z.string().uuid(),
  })
  .refine((b) => b.survivorId !== b.duplicateId, {
    message: 'survivorId and duplicateId must differ',
  });

const MergeResult = z.object({
  entity: z.enum(['company', 'contact']),
  survivorId: z.string().uuid(),
  duplicateId: z.string().uuid(),
  alreadyMerged: z.boolean(),
  repointed: z.record(z.number().int()),
});

type Tx = Prisma.TransactionClient;

// The global soft-delete middleware injects `deletedAt: null` into unscoped
// reads, which would make a retried merge 404 (the loser is already
// tombstoned). Probing live rows first and tombstones second uses the
// middleware's documented explicit-deletedAt bypass on both queries.
async function findCompanyAnyState(id: string, orgId: string) {
  const select = { id: true, name: true, parentId: true, deletedAt: true } as const;
  const live = await prisma.company.findFirst({ where: { id, orgId, deletedAt: null }, select });
  if (live) return live;
  return prisma.company.findFirst({ where: { id, orgId, deletedAt: { not: null } }, select });
}

async function findContactAnyState(id: string, orgId: string) {
  const select = { id: true, name: true, deletedAt: true } as const;
  const live = await prisma.contact.findFirst({ where: { id, orgId, deletedAt: null }, select });
  if (live) return live;
  return prisma.contact.findFirst({ where: { id, orgId, deletedAt: { not: null } }, select });
}

async function repointCompanyRelations(
  tx: Tx,
  orgId: string,
  survivorId: string,
  duplicateId: string,
): Promise<Record<string, number>> {
  const where = { orgId, companyId: duplicateId };
  const data = { companyId: survivorId };
  const contacts = await tx.contact.updateMany({ where, data });
  const opportunities = await tx.opportunity.updateMany({ where, data });
  const notes = await tx.note.updateMany({ where, data });
  const leads = await tx.lead.updateMany({ where, data });
  const tasks = await tx.task.updateMany({
    where: { orgId, accountId: duplicateId },
    data: { accountId: survivorId },
  });
  const childCompanies = await tx.company.updateMany({
    where: { orgId, parentId: duplicateId, id: { not: survivorId } },
    data: { parentId: survivorId },
  });
  return {
    contacts: contacts.count,
    opportunities: opportunities.count,
    notes: notes.count,
    leads: leads.count,
    tasks: tasks.count,
    childCompanies: childCompanies.count,
  };
}

async function mergeCompanyPair(
  server: FastifyInstance,
  auth: { orgId: string; userId: string },
  survivorId: string,
  duplicateId: string,
): Promise<z.infer<typeof MergeResult>> {
  const { orgId, userId } = auth;
  const [survivor, duplicate] = await Promise.all([
    prisma.company.findFirst({
      where: { id: survivorId, orgId, deletedAt: null },
      select: { id: true, parentId: true },
    }),
    // Duplicate is loaded tombstones-included so a retried merge (loser
    // already soft-deleted) converges instead of 404ing. Cross-org ids never
    // resolve here — that's the FK-graft guard.
    findCompanyAnyState(duplicateId, orgId),
  ]);
  if (!survivor || !duplicate) throw server.httpErrors.notFound('Company not found');
  const alreadyMerged = duplicate.deletedAt !== null;

  const repointed = await prisma.$transaction(async (tx) => {
    if (survivor.parentId === duplicateId) {
      // Survivor sat under the loser: hoist it to the loser's parent first,
      // otherwise the blanket child re-point below would make it its own
      // parent. Grandparent-equals-survivor degenerates to root (null).
      const grandparent = duplicate.parentId === survivorId ? null : duplicate.parentId;
      await tx.company.updateMany({
        where: { id: survivorId, orgId },
        data: { parentId: grandparent },
      });
    }
    const counts = await repointCompanyRelations(tx, orgId, survivorId, duplicateId);
    await tx.company.updateMany({
      where: { id: duplicateId, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'company.merge',
        targetType: 'company',
        targetId: survivorId,
        diff: {
          duplicateId,
          duplicateName: duplicate.name,
          repointed: counts,
          alreadyMerged,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return counts;
  });

  return { entity: 'company', survivorId, duplicateId, alreadyMerged, repointed };
}

async function repointContactRelations(
  tx: Tx,
  orgId: string,
  survivorId: string,
  duplicateId: string,
): Promise<Record<string, number>> {
  // OpportunityContact is unique on (orgId, opportunityId, contactId) —
  // soft-deleted rows INCLUDED, so the survivor's coverage check must read
  // tombstoned links too (explicit deletedAt filters bypass the soft-delete
  // middleware). Links whose opportunity the survivor already covers are
  // retired instead of re-pointed, or the merge would 500 on the unique
  // constraint mid-transaction.
  // take: query-guard ceiling. No single contact sits on 1000+ opportunities.
  const dupLinks = await tx.opportunityContact.findMany({
    where: { orgId, contactId: duplicateId, deletedAt: null },
    select: { id: true, opportunityId: true },
    take: 1_000,
  });
  // Sequential on purpose: concurrent queries on one interactive-transaction
  // client are unsupported.
  const liveSurvivorLinks = await tx.opportunityContact.findMany({
    where: { orgId, contactId: survivorId, deletedAt: null },
    select: { opportunityId: true },
    take: 1_000,
  });
  const retiredSurvivorLinks = await tx.opportunityContact.findMany({
    where: { orgId, contactId: survivorId, deletedAt: { not: null } },
    select: { opportunityId: true },
    take: 1_000,
  });
  const covered = new Set(
    [...liveSurvivorLinks, ...retiredSurvivorLinks].map((l) => l.opportunityId),
  );
  const movable = dupLinks.filter((l) => !covered.has(l.opportunityId)).map((l) => l.id);
  const conflicting = dupLinks.filter((l) => covered.has(l.opportunityId)).map((l) => l.id);
  if (movable.length > 0) {
    await tx.opportunityContact.updateMany({
      where: { id: { in: movable }, orgId },
      data: { contactId: survivorId },
    });
  }
  if (conflicting.length > 0) {
    await tx.opportunityContact.updateMany({
      where: { id: { in: conflicting }, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
  const attendees = await tx.activityAttendee.updateMany({
    where: { orgId, contactId: duplicateId },
    data: { contactId: survivorId },
  });
  return {
    opportunityLinks: movable.length,
    opportunityLinksRetired: conflicting.length,
    activityAttendees: attendees.count,
  };
}

async function mergeContactPair(
  server: FastifyInstance,
  auth: { orgId: string; userId: string },
  survivorId: string,
  duplicateId: string,
): Promise<z.infer<typeof MergeResult>> {
  const { orgId, userId } = auth;
  const [survivor, duplicate] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: survivorId, orgId, deletedAt: null },
      select: { id: true },
    }),
    findContactAnyState(duplicateId, orgId),
  ]);
  if (!survivor || !duplicate) throw server.httpErrors.notFound('Contact not found');
  const alreadyMerged = duplicate.deletedAt !== null;

  const repointed = await prisma.$transaction(async (tx) => {
    const counts = await repointContactRelations(tx, orgId, survivorId, duplicateId);
    await tx.contact.updateMany({
      where: { id: duplicateId, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'contact.merge',
        targetType: 'contact',
        targetId: survivorId,
        diff: {
          duplicateId,
          duplicateName: duplicate.name,
          repointed: counts,
          alreadyMerged,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return counts;
  });

  return { entity: 'contact', survivorId, duplicateId, alreadyMerged, repointed };
}

export const duplicatesRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/duplicates/companies',
    {
      preHandler: [server.requirePermission('companies:read')],
      schema: { response: { 200: CompanyDupResponse } },
    },
    async (req) => {
      const rows = await prisma.company.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: {
          id: true,
          name: true,
          legalName: true,
          domain: true,
          website: true,
          industry: true,
          countryCode: true,
          createdAt: true,
          _count: {
            select: {
              contacts: { where: { deletedAt: null } },
              opportunities: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: SCAN_CAP,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const clusters = clusterCompanies(rows).map((cluster) => ({
        reasons: cluster.reasons,
        companies: cluster.ids.map((id) => {
          const r = byId.get(id)!;
          return {
            id: r.id,
            name: r.name,
            legalName: r.legalName,
            domain: r.domain,
            website: r.website,
            industry: r.industry,
            countryCode: r.countryCode,
            createdAt: r.createdAt.toISOString(),
            contactCount: r._count.contacts,
            opportunityCount: r._count.opportunities,
          };
        }),
      }));
      return { clusters, scanned: rows.length, truncated: rows.length === SCAN_CAP };
    },
  );

  server.get(
    '/duplicates/contacts',
    {
      preHandler: [server.requirePermission('contacts:read')],
      schema: { response: { 200: ContactDupResponse } },
    },
    async (req) => {
      const rows = await prisma.contact.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          phone: true,
          customer: true,
          createdAt: true,
          company: { select: { name: true } },
          _count: { select: { opportunityLinks: { where: { deletedAt: null } } } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: SCAN_CAP,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const clusters = clusterContacts(rows).map((cluster) => ({
        reasons: cluster.reasons,
        contacts: cluster.ids.map((id) => {
          const r = byId.get(id)!;
          return {
            id: r.id,
            name: r.name,
            email: r.email,
            role: r.role,
            phone: r.phone,
            customer: r.customer,
            companyName: r.company?.name ?? null,
            createdAt: r.createdAt.toISOString(),
            opportunityLinkCount: r._count.opportunityLinks,
          };
        }),
      }));
      return { clusters, scanned: rows.length, truncated: rows.length === SCAN_CAP };
    },
  );

  server.post(
    '/duplicates/merge',
    {
      preHandler: [
        // Body is validated before preHandler runs, so gating on entity is
        // safe: company merges need companies:write, contact merges
        // contacts:write — same gates as the sibling CRUD routes.
        async (req: FastifyRequest) => {
          const entity = (req.body as { entity?: 'company' | 'contact' } | null)?.entity;
          const permission = entity === 'contact' ? 'contacts:write' : 'companies:write';
          await server.requirePermission(permission)(req);
        },
      ],
      schema: { body: MergeBody, response: { 200: MergeResult } },
    },
    async (req) => {
      const { entity, survivorId, duplicateId } = req.body;
      const auth = { orgId: req.auth.orgId, userId: req.auth.userId };
      return entity === 'company'
        ? mergeCompanyPair(server, auth, survivorId, duplicateId)
        : mergeContactPair(server, auth, survivorId, duplicateId);
    },
  );
};
