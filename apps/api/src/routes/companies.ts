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
import { applyCompanyScope, getAccessScope } from '../lib/access-scope.js';
import { serializeCompany, serializeCompanyDetail } from '../serializers/company.js';
import { syncAccountFinancialsSchedule } from '../services/account-financials/schedule.js';

/** Shown instead of the name of a company outside the caller's access scope. */
const RESTRICTED_COMPANY_NAME = 'Restricted company';

export const companiesRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/companies',
    {
      config: { permission: 'companies:read' },
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
      // Same country / key-account / deal scope as /accounts and
      // /crm/companies/search: a restricted user must not list or search
      // companies outside their access groups through this older route.
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const items = await prisma.company.findMany({
        where: applyCompanyScope(
          {
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
          scope,
        ),
        select: {
          id: true,
          orgId: true,
          name: true,
          legalName: true,
          domain: true,
          industry: true,
          employeeCount: true,
          countryCode: true,
          address: true,
          billingEmail: true,
          taxId: true,
          logoUrl: true,
          website: true,
          source: true,
          confidence: true,
          enrichedAt: true,
          tier: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: req.query.limit + 1,
        ...(req.query.cursor ? { skip: 1, cursor: { id: req.query.cursor } } : {}),
      });

      const hasMore = items.length > req.query.limit;
      const sliced = hasMore ? items.slice(0, -1) : items;
      const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : undefined;

      return { items: sliced.map(serializeCompany), nextCursor };
    },
  );

  server.get(
    '/companies/:id',
    {
      config: { permission: 'companies:read' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: CompanyDetail },
      },
    },
    async (req) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const c = await prisma.company.findFirst({
        where: applyCompanyScope({ id: req.params.id, orgId: req.auth.orgId, deletedAt: null }, scope),
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
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'company.create',
          targetType: 'company',
          targetId: c.id,
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
      const existing = await prisma.company.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Company not found');

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
      // v23: a tier change starts or stops the financials schedule right away.
      if (patch.tier !== undefined && patch.tier !== null) await syncAccountFinancialsSchedule(req.auth.orgId, req.params.id);

      const changedFields: string[] = [];
      const changes: Record<string, unknown> = {};
      const existingRec = existing as Record<string, unknown>;
      for (const [k, patchVal] of Object.entries(patch)) {
        if (k === 'customFieldValues') continue;
        if (patchVal !== undefined && existingRec[k] !== patchVal) {
          changedFields.push(k);
          changes[k] = k === 'taxId' ? { changed: true } : { from: existingRec[k], to: patchVal };
        }
      }

      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'company.update',
          targetType: 'company',
          targetId: req.params.id,
          diff: { actorKind: 'user', changedFields, changes } as unknown as Prisma.InputJsonValue,
        },
      });

      const updated = await prisma.company.findFirstOrThrow({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      return serializeCompany(updated);
    },
  );

  server.get(
    '/companies/:id/hierarchy',
    {
      config: { permission: 'companies:read' },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: CompanyHierarchy },
      },
    },
    async (req) => {
      const scope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const root = await prisma.company.findFirst({
        where: applyCompanyScope({ id: req.params.id, orgId: req.auth.orgId, deletedAt: null }, scope),
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
      // Bounded at the query-guard ceiling (take > 1000 is rejected as
      // unbounded). Org hierarchies above this are vanishingly rare.
      const ORG_COMPANY_CAP = 1_000;
      const allNodes = await prisma.company.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, name: true, parentId: true },
        orderBy: { name: 'asc' },
        take: ORG_COMPANY_CAP,
      });

      // Access scope inside the tree. The root passed the scope check, but its
      // parents and children may not have: a restricted user must not learn
      // their names. Out-of-scope nodes are omitted unless an in-scope company
      // sits below them, in which case they stay as a nameless placeholder so
      // the tree stays connected. Out-of-scope ancestors are kept (they place
      // the root) but redacted. Unrestricted callers skip the extra query.
      const visible: Set<string> | null = scope.unrestricted
        ? null
        : new Set(
            (
              await prisma.company.findMany({
                where: applyCompanyScope({ orgId: req.auth.orgId, deletedAt: null }, scope),
                select: { id: true },
                take: ORG_COMPANY_CAP,
              })
            ).map((c) => c.id),
          );
      const isVisible = (id: string): boolean => visible === null || visible.has(id);
      const shownName = (node: { id: string; name: string }): string =>
        isVisible(node.id) ? node.name : RESTRICTED_COMPANY_NAME;

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

      // Ancestors: follow parentId chain in-memory. A visited-set guards
      // against a corrupt parentId cycle (parentId has no DB-level acyclicity
      // constraint) that would otherwise spin this loop forever and hang the
      // single Node event-loop thread for every tenant on the process.
      const ancestors: Array<{ id: string; name: string }> = [];
      const seenAncestors = new Set<string>();
      let ancestorId: string | null = root.parentId;
      while (ancestorId) {
        if (seenAncestors.has(ancestorId)) break; // cycle — stop, don't spin
        seenAncestors.add(ancestorId);
        const ancestor = byId.get(ancestorId);
        if (!ancestor) break;
        ancestors.unshift({ id: ancestor.id, name: shownName(ancestor) });
        ancestorId = ancestor.parentId;
      }

      // Build full tree recursively in-memory — zero additional DB calls.
      // A visited-set skips any node already placed, so a corrupt parentId
      // cycle can never recurse forever / blow the stack (each node has one
      // parent, so a re-encounter is always a back-edge cycle, never a DAG).
      // Returns null for an out-of-scope subtree with nothing in scope below.
      const placed = new Set<string>();
      function buildTree(node: FlatNode, parentId: string | null): CompanyHierarchyNode | null {
        placed.add(node.id);
        const kids = childrenByParent.get(node.id) ?? [];
        const children = kids
          .filter((k) => !placed.has(k.id))
          .map((k) => buildTree(k, node.id))
          .filter((k): k is CompanyHierarchyNode => k !== null);
        if (!isVisible(node.id) && children.length === 0) return null;
        return { id: node.id, name: shownName(node), parentId, children };
      }
      // The root is in scope (checked above), so it is never pruned.
      const tree = buildTree(root, root.parentId) as CompanyHierarchyNode;

      // Direct children: the root's pruned children, in the orderBy order.
      const directChildren = tree.children.map((n) => ({ id: n.id, name: n.name }));

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
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'company.delete',
          targetType: 'company',
          targetId: req.params.id,
        },
      });
      return reply.code(204).send(null);
    },
  );
};
