import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { Company, CompanyCreate, CompanyDetail, CompanyPatch } from '@bidstack/shared';

function serializeCompany(c: {
  id: string;
  orgId: string;
  name: string;
  legalName: string | null;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  countryCode: string | null;
  address: unknown;
  billingEmail: string | null;
  taxId: string | null;
  logoUrl: string | null;
  website: string | null;
  source: string;
  confidence: number;
  enrichedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): z.infer<typeof Company> {
  return {
    id: c.id,
    orgId: c.orgId,
    name: c.name,
    legalName: c.legalName,
    domain: c.domain,
    industry: c.industry,
    employeeCount: c.employeeCount,
    countryCode: c.countryCode,
    address: c.address as Record<string, unknown> | null,
    billingEmail: c.billingEmail,
    taxId: c.taxId,
    logoUrl: c.logoUrl,
    website: c.website,
    source: c.source,
    confidence: c.confidence,
    enrichedAt: c.enrichedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const companiesRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/companies',
    {
      schema: {
        querystring: z.object({
          search: z.string().optional(),
          industry: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({ items: z.array(Company), nextCursor: z.string().uuid().optional() }),
        },
      },
    },
    async (req) => {
      const s = req.query.search;
      const items = await prisma.company.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.query.industry ? { industry: req.query.industry } : {}),
          ...(s
            ? {
                OR: [
                  { name: { contains: s, mode: 'insensitive' } },
                  { domain: { contains: s, mode: 'insensitive' } },
                  { industry: { contains: s, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit + 1,
        ...(req.query.cursor ? { skip: 1, cursor: { id: req.query.cursor } } : {}),
      });

      let nextCursor: string | undefined;
      if (items.length > req.query.limit) {
        nextCursor = items[req.query.limit]!.id;
        items.pop();
      }

      return { items: items.map(serializeCompany), nextCursor };
    },
  );

  server.get(
    '/companies/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: CompanyDetail },
      },
    },
    async (req) => {
      const c = await prisma.company.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        include: {
          contacts: {
            where: { deletedAt: null },
            select: { id: true, name: true, role: true, email: true, phone: true },
          },
          opportunities: {
            where: { deletedAt: null },
            select: {
              id: true,
              code: true,
              name: true,
              stage: true,
              valueMicros: true,
              probability: true,
              dueDate: true,
            },
          },
          serviceCases: {
            where: { deletedAt: null, status: { not: 'closed' } },
            select: { id: true, number: true, subject: true, status: true, priority: true },
          },
          notes: {
            where: { deletedAt: null },
            select: { id: true, title: true, author: { select: { name: true } }, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      });
      if (!c) throw server.httpErrors.notFound('Company not found');

      return {
        ...serializeCompany(c),
        contacts: c.contacts.map((x) => ({ ...x, email: x.email ?? null, phone: x.phone ?? null })),
        opportunities: c.opportunities.map((x) => ({
          ...x,
          valueMicros: x.valueMicros.toString(),
          dueDate: x.dueDate?.toISOString() ?? null,
        })),
        openCases: c.serviceCases.map((x) => ({ ...x })),
        notes: c.notes.map((x) => ({
          id: x.id,
          title: x.title,
          authorName: x.author?.name ?? null,
          createdAt: x.createdAt.toISOString(),
        })),
      };
    },
  );

  server.post(
    '/companies',
    {
      schema: {
        body: CompanyCreate,
        response: { 201: Company },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const c = await prisma.company.create({
        data: {
          name: body.name,
          legalName: body.legalName,
          domain: body.domain,
          industry: body.industry,
          employeeCount: body.employeeCount,
          countryCode: body.countryCode,
          address: body.address as unknown as Prisma.InputJsonValue | undefined,
          billingEmail: body.billingEmail,
          taxId: body.taxId,
          logoUrl: body.logoUrl,
          website: body.website,
          orgId: req.auth.orgId,
          source: 'manual',
          confidence: 1,
        },
      });
      reply.status(201);
      return serializeCompany(c);
    },
  );

  server.patch(
    '/companies/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CompanyPatch,
        response: { 200: Company },
      },
    },
    async (req) => {
      const patch = req.body;
      const updateResult = await prisma.company.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.legalName !== undefined && { legalName: patch.legalName }),
          ...(patch.domain !== undefined && { domain: patch.domain }),
          ...(patch.industry !== undefined && { industry: patch.industry }),
          ...(patch.employeeCount !== undefined && { employeeCount: patch.employeeCount }),
          ...(patch.countryCode !== undefined && { countryCode: patch.countryCode }),
          ...(patch.address !== undefined && {
            address: (patch.address ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          }),
          ...(patch.billingEmail !== undefined && { billingEmail: patch.billingEmail }),
          ...(patch.taxId !== undefined && { taxId: patch.taxId }),
          ...(patch.logoUrl !== undefined && { logoUrl: patch.logoUrl }),
          ...(patch.website !== undefined && { website: patch.website }),
        },
      });
      if (updateResult.count === 0) throw server.httpErrors.notFound('Company not found');
      const updated = await prisma.company.findFirstOrThrow({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      return serializeCompany(updated);
    },
  );

  server.delete(
    '/companies/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      await prisma.company.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      reply.status(204).send();
    },
  );
};
