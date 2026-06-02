import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  Company,
  CompanyCreate,
  CompanyDetail,
  CompanyPatch,
  CompanyHierarchy,
  type CompanyHierarchyNode,
} from '@bidstack/shared';
import { serializeCompany, serializeCompanyDetail } from '../serializers/company.js';

export const companiesRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/companies',
    {
      schema: {
        querystring: z.object({
          search: z.string().max(255).optional(),
          industry: z.string().max(100).optional(),
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
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
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
          parent: { select: { id: true, name: true } },
          children: { where: { deletedAt: null }, select: { id: true, name: true } },
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

      return serializeCompanyDetail(c);
    },
  );

  server.post(
    '/companies',
    {
      preHandler: [server.requirePermission('companies:write'), server.requireRole('admin')],
      schema: {
        body: CompanyCreate,
        response: { 201: Company },
      },
    },
    async (req, reply) => {
      const body = req.body;
      if (body.parentId) {
        const parent = await prisma.company.findFirst({
          where: { id: body.parentId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!parent) throw server.httpErrors.badRequest('Parent company not found');
      }
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
          tier: body.tier,
          parentId: body.parentId,
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
      preHandler: [server.requirePermission('companies:write'), server.requireRole('admin')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CompanyPatch,
        response: { 200: Company },
      },
    },
    async (req) => {
      const patch = req.body;
      if (patch.parentId !== undefined && patch.parentId !== null) {
        const parent = await prisma.company.findFirst({
          where: { id: patch.parentId, orgId: req.auth.orgId, deletedAt: null },
          select: { id: true },
        });
        if (!parent) throw server.httpErrors.badRequest('Parent company not found');
        // Prevent circular reference
        let currentId: string | null = patch.parentId;
        while (currentId) {
          if (currentId === req.params.id) {
            throw server.httpErrors.badRequest('Circular reference detected');
          }
          const row: { parentId: string | null } | null = await prisma.company.findFirst({
            where: { id: currentId, orgId: req.auth.orgId, deletedAt: null },
            select: { parentId: true },
          });
          currentId = row?.parentId ?? null;
        }
      }
      // CF upserts included in the same transaction so a CF failure rolls back
      // the company update — prevents partial-update / data corruption (P0 #5).
      const cfOps = (patch.customFieldValues ?? []).map(({ definitionId, value }) =>
        prisma.customFieldValue.upsert({
          where: {
            orgId_entityType_entityId_definitionId: {
              orgId: req.auth.orgId,
              entityType: 'company',
              entityId: req.params.id,
              definitionId,
            },
          },
          update: { value: value as Prisma.InputJsonValue },
          create: {
            orgId: req.auth.orgId,
            definitionId,
            entityType: 'company',
            entityId: req.params.id,
            value: value as Prisma.InputJsonValue,
          },
        }),
      );

      const [updateResult] = await prisma.$transaction([
        prisma.company.updateMany({
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
            ...(patch.tier !== undefined && patch.tier !== null && { tier: patch.tier }),
            ...(patch.parentId !== undefined && { parentId: patch.parentId }),
          },
        }),
        ...cfOps,
      ]);
      if (updateResult.count === 0) throw server.httpErrors.notFound('Company not found');

      const updated = await prisma.company.findFirstOrThrow({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      return serializeCompany(updated);
    },
  );

  server.get(
    '/companies/:id/hierarchy',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: CompanyHierarchy },
      },
    },
    async (req) => {
      const root = await prisma.company.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, name: true, parentId: true },
      });
      if (!root) throw server.httpErrors.notFound('Company not found');

      // WHY single query: the previous implementation issued one findMany
      // per node in the recursive buildTree() (N+1) and one findFirst per
      // ancestor level in the while-loop (also N+1). For a 6-level, 50-node
      // hierarchy that was 56+ round-trips. A single flat query for all org
      // companies collapses that to 2 DB calls total (root + all nodes) and
      // keeps memory flat: only the ~50-byte {id, name, parentId} tuples are
      // loaded, not full company rows.
      const ORG_COMPANY_CAP = 2_000;
      const allNodes = await prisma.company.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, name: true, parentId: true },
        orderBy: { name: 'asc' },
        take: ORG_COMPANY_CAP,
      });

      // Pre-group children by parentId for O(n) tree assembly.
      type FlatNode = (typeof allNodes)[number];
      const childrenByParent = new Map<string, FlatNode[]>();
      for (const node of allNodes) {
        if (node.parentId) {
          const siblings = childrenByParent.get(node.parentId) ?? [];
          siblings.push(node);
          childrenByParent.set(node.parentId, siblings);
        }
      }

      // Build lookup map for O(1) ancestor resolution.
      const byId = new Map(allNodes.map((n) => [n.id, n]));

      // Ancestors: follow parentId chain in-memory.
      const ancestors: Array<{ id: string; name: string }> = [];
      let ancestorId: string | null = root.parentId;
      while (ancestorId) {
        const ancestor = byId.get(ancestorId);
        if (!ancestor) break;
        ancestors.unshift({ id: ancestor.id, name: ancestor.name });
        ancestorId = ancestor.parentId;
      }

      // Direct children: already grouped and sorted by the orderBy above.
      const directChildren = (childrenByParent.get(root.id) ?? []).map((n) => ({
        id: n.id,
        name: n.name,
      }));

      // Build full tree recursively in-memory — zero additional DB calls.
      function buildTree(id: string, name: string, parentId: string | null): CompanyHierarchyNode {
        const kids = childrenByParent.get(id) ?? [];
        const children = kids.map((k): CompanyHierarchyNode => buildTree(k.id, k.name, id));
        return { id, name, parentId, children };
      }
      const tree = buildTree(root.id, root.name, root.parentId);

      return { ancestors, directChildren, tree };
    },
  );

  server.delete(
    '/companies/:id',
    {
      preHandler: [server.requirePermission('companies:write'), server.requireRole('admin')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.company.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!existing) throw server.httpErrors.notFound('Company not found');

      await prisma.company.updateMany({
        where: { id: existing.id, orgId: req.auth.orgId },
        data: { deletedAt: new Date() },
      });
      return reply.code(204).send(null);
    },
  );
};
