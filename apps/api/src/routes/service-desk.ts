import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, Prisma } from '@bidstack/db';
import {
  ServiceCase,
  ServiceCaseFilter,
  ServiceCaseCreate,
  type CasePriority,
  type CaseStatus,
} from '@bidstack/shared';
import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';

export const serviceDeskRoutes: FastifyPluginAsyncZod = async (server) => {
  const validateServiceCaseLinks = async (
    orgId: string,
    links: { accountId?: string | null; contactId?: string | null; ownerId?: string | null },
  ) => {
    if (links.accountId && !(await tenantEntityBelongsToOrg('account', links.accountId, orgId))) {
      throw server.httpErrors.badRequest('Account does not belong to this organization');
    }
    if (links.contactId && !(await tenantEntityBelongsToOrg('contact', links.contactId, orgId))) {
      throw server.httpErrors.badRequest('Contact does not belong to this organization');
    }
    if (links.ownerId && !(await tenantEntityBelongsToOrg('user', links.ownerId, orgId))) {
      throw server.httpErrors.badRequest('Owner does not belong to this organization');
    }
  };

  // GET /api/service-cases
  server.get(
    '/service-cases',
    {
      schema: {
        querystring: ServiceCaseFilter,
        response: {
          200: z.object({ items: z.array(ServiceCase), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (req) => {
      const { status, priority, ownerId, search, cursor, limit } = req.query;
      const items = await prisma.serviceCase.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(status ? { status } : {}),
          ...(priority ? { priority } : {}),
          ...(ownerId ? { ownerId } : {}),
          ...(search
            ? {
                OR: [
                  { subject: { contains: search, mode: 'insensitive' } },
                  { description: { contains: search, mode: 'insensitive' } },
                  { number: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: { owner: { select: { name: true } } },
        // Compound (createdAt, id) tiebreaker: createdAt is not unique, so a
        // bare single-column sort leaves ties in an unspecified heap order that
        // is not stable across the id-cursor + skip:1 keyset walk — a tie
        // straddling a page boundary can be dropped (or duplicated) on the next
        // page. The unique id secondary sort makes the ordering total and the
        // keyset deterministic. Matches the convention in companies.ts/tasks.ts.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      return {
        items: page.map(serializeCase),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
    },
  );

  // POST /api/service-cases
  server.post(
    '/service-cases',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('service-desk:write'),
      schema: {
        body: ServiceCaseCreate,
        response: { 201: ServiceCase },
      },
    },
    async (req, reply) => {
      const body = req.body;
      await validateServiceCaseLinks(req.auth.orgId, body);
      let createdId: string | null = null;
      for (let attempt = 0; attempt < 5 && !createdId; attempt += 1) {
        try {
          createdId = await prisma.$transaction(async (tx) => {
            const number = await mintCaseNumber(tx, req.auth.orgId);
            const created = await tx.serviceCase.create({
              data: {
                orgId: req.auth.orgId,
                number,
                subject: body.subject,
                description: body.description,
                priority: body.priority ?? 'medium',
                status: 'new',
                accountId: body.accountId,
                contactId: body.contactId,
                ownerId: body.ownerId,
                source: body.source ?? 'web',
              },
            });
            return created.id;
          });
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 4) continue;
          throw err;
        }
      }
      if (!createdId) throw server.httpErrors.conflict('Could not allocate case number');
      const created = await prisma.serviceCase.findFirstOrThrow({
        where: { id: createdId, orgId: req.auth.orgId },
        include: { owner: { select: { name: true } } },
      });
      return reply.code(201).send(serializeCase(created));
    },
  );

  // GET /api/service-cases/:id
  server.get(
    '/service-cases/:id',
    {
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: ServiceCase } },
    },
    async (req) => {
      const row = await prisma.serviceCase.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        include: { owner: { select: { name: true } } },
      });
      if (!row) throw server.httpErrors.notFound('Case not found');
      return serializeCase(row);
    },
  );

  // PATCH /api/service-cases/:id
  server.patch(
    '/service-cases/:id',
    {
      preHandler: server.requirePermission('service-desk:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ServiceCaseCreate.partial(),
        response: { 200: ServiceCase },
      },
    },
    async (req) => {
      const existing = await prisma.serviceCase.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Case not found');

      const data: Prisma.ServiceCaseUpdateInput = {};
      if (req.body.subject !== undefined) data.subject = req.body.subject;
      if (req.body.description !== undefined) data.description = req.body.description;
      if (req.body.priority !== undefined) data.priority = req.body.priority;
      if (req.body.status !== undefined) {
        data.status = req.body.status;
        if (req.body.status === 'resolved') data.resolvedAt = new Date();
        if (req.body.status === 'closed') {
          data.resolvedAt = existing.resolvedAt ?? new Date();
          data.closedAt = new Date();
        }
      }
      if (req.body.ownerId !== undefined) {
        if (req.body.ownerId === null) {
          data.owner = { disconnect: true };
        } else {
          await validateServiceCaseLinks(req.auth.orgId, { ownerId: req.body.ownerId });
          data.owner = { connect: { id: req.body.ownerId } };
        }
      }
      if (req.body.satisfaction !== undefined) data.satisfaction = req.body.satisfaction;

      const updateResult = await prisma.serviceCase.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        data,
      });
      if (updateResult.count === 0) {
        throw server.httpErrors.notFound('Case not found');
      }
      const updated = await prisma.serviceCase.findFirstOrThrow({
        where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
        include: { owner: { select: { name: true } } },
      });
      return serializeCase(updated);
    },
  );

  // DELETE /api/service-cases/:id
  server.delete(
    '/service-cases/:id',
    {
      preHandler: server.requirePermission('service-desk:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.serviceCase.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, number: true },
      });
      if (!existing) throw server.httpErrors.notFound('Case not found');

      await prisma.serviceCase.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId },
        data: { deletedAt: new Date() },
      });
      return reply.code(204).send(null);
    },
  );
};

function serializeCase(row: {
  id: string;
  orgId: string;
  number: string;
  subject: string;
  description: string | null;
  priority: string;
  status: string;
  accountId: string | null;
  contactId: string | null;
  ownerId: string | null;
  owner: { name: string | null } | null;
  source: string;
  satisfaction: number | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  slaDeadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof ServiceCase> {
  return {
    id: row.id,
    orgId: row.orgId,
    number: row.number,
    subject: row.subject,
    description: row.description,
    priority: row.priority as z.infer<typeof CasePriority>,
    status: row.status as z.infer<typeof CaseStatus>,
    accountId: row.accountId,
    contactId: row.contactId,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    source: row.source,
    satisfaction: row.satisfaction,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    slaDeadline: row.slaDeadline?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function mintCaseNumber(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  const last = await tx.serviceCase.findFirst({
    where: { orgId, number: { startsWith: 'CS-' }, deletedAt: null },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  if (!last) return 'CS-10001';
  const n = Number(last.number.slice(3));
  return `CS-${(n + 1).toString().padStart(5, '0')}`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
