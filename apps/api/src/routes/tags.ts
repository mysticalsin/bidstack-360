// Tag management routes — CRUD on Tag entities, polymorphic apply/remove on
// any taggable record, and a stub agent endpoint for AI tag suggestions.
//
// Multi-tenancy: every query filters by `req.auth.orgId`. The apply/remove
// endpoints additionally verify the target entity belongs to the caller's
// tenant before mutating EntityTag rows.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  Tag,
  TagCreate,
  TagPatch,
  TagList,
  TagApply,
  EntityTagsResponse,
  TagSuggestRequest,
  TagSuggestResponse,
  TaggableEntityType,
} from '@bidstack/shared';

import { loadEntityTags, suggestTagsLocally, taggableOwnedBy } from './tags.helpers.js';

const TagIdParam = z.object({ id: z.string().uuid() });

export const tagRoutes: FastifyPluginAsyncZod = async (server) => {
  // RBAC: tags were previously ungated — any authenticated user could create,
  // edit, delete, and apply tags (privilege escalation within a tenant). Gate
  // reads (list / entity-tags / AI suggest) behind tags:read and every mutation
  // (create / update / delete / apply / remove) behind tags:write.
  server.addHook('preHandler', (req) => {
    const isRead = req.method === 'GET' || req.url.includes('/tags/suggest');
    return server.requirePermission(isRead ? 'tags:read' : 'tags:write')(req);
  });

  // ─── GET /api/v1/tags ─────────────────────────────────────────────────
  // List every tag in the tenant. Includes a usageCount via subquery so the
  // UI can show "this tag is on 12 records" without a second request.
  server.get(
    '/tags',
    {
      schema: {
        querystring: z.object({
          search: z.string().trim().max(64).optional(),
        }),
        response: { 200: TagList },
      },
    },
    async (req) => {
      const tags = await prisma.tag.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.query.search
            ? { name: { contains: req.query.search, mode: 'insensitive' } }
            : {}),
        },
        orderBy: { name: 'asc' },
        take: 250,
      });

      const usage = await prisma.entityTag.groupBy({
        by: ['tagId'],
        where: { orgId: req.auth.orgId, tagId: { in: tags.map((t) => t.id) } },
        _count: { _all: true },
      });
      const usageByTag = new Map(usage.map((u) => [u.tagId, u._count._all]));

      return {
        items: tags.map((t) => ({
          id: t.id,
          orgId: t.orgId,
          name: t.name,
          color: t.color,
          createdById: t.createdById,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
          usageCount: usageByTag.get(t.id) ?? 0,
        })),
      };
    },
  );

  // ─── POST /api/v1/tags ────────────────────────────────────────────────
  // Create a tag. Duplicate names dedupe (case-insensitive thanks to citext)
  // — if a tag with the same name already exists, return that one and don't
  // create a new row. This is the AC-1.1 contract: "creating an existing
  // tag is a no-op that returns the existing tag."
  server.post(
    '/tags',
    {
      schema: {
        body: TagCreate,
        response: { 201: Tag, 200: Tag },
      },
    },
    async (req, reply) => {
      const existing = await prisma.tag.findFirst({
        where: { orgId: req.auth.orgId, name: req.body.name, deletedAt: null },
      });
      if (existing) {
        return reply.code(200).send({
          id: existing.id,
          orgId: existing.orgId,
          name: existing.name,
          color: existing.color,
          createdById: existing.createdById,
          createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString(),
        });
      }

      const tag = await prisma.tag.create({
        data: {
          orgId: req.auth.orgId,
          name: req.body.name,
          color: req.body.color,
          createdById: req.auth.userId,
        },
      });

      return reply.code(201).send({
        id: tag.id,
        orgId: tag.orgId,
        name: tag.name,
        color: tag.color,
        createdById: tag.createdById,
        createdAt: tag.createdAt.toISOString(),
        updatedAt: tag.updatedAt.toISOString(),
      });
    },
  );

  // ─── PATCH /api/v1/tags/:id ───────────────────────────────────────────
  // Rename / recolour a tag. Cascades to every EntityTag automatically
  // because the join references by id.
  server.patch(
    '/tags/:id',
    {
      schema: {
        params: TagIdParam,
        body: TagPatch,
        response: { 200: Tag },
      },
    },
    async (req) => {
      const tag = await prisma.tag.update({
        where: { id: req.params.id, orgId: req.auth.orgId },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.color !== undefined ? { color: req.body.color } : {}),
        },
      });
      return {
        id: tag.id,
        orgId: tag.orgId,
        name: tag.name,
        color: tag.color,
        createdById: tag.createdById,
        createdAt: tag.createdAt.toISOString(),
        updatedAt: tag.updatedAt.toISOString(),
      };
    },
  );

  // ─── DELETE /api/v1/tags/:id ──────────────────────────────────────────
  // Soft-delete the tag. EntityTag rows are removed via Prisma cascade so
  // the tag stops appearing on every record that used it. AC-1.9 requires
  // the caller to confirm in the UI before issuing the DELETE.
  server.delete(
    '/tags/:id',
    {
      schema: {
        params: TagIdParam,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await prisma.$transaction(async (tx) => {
        await tx.entityTag.deleteMany({
          where: { orgId: req.auth.orgId, tagId: req.params.id },
        });
        await tx.tag.update({
          where: { id: req.params.id, orgId: req.auth.orgId },
          data: { deletedAt: new Date() },
        });
      });
      return reply.code(204).send(null);
    },
  );

  // ─── POST /api/v1/tags/apply ──────────────────────────────────────────
  // Idempotently attach one or more tags to an entity. Order doesn't matter
  // and re-applying an existing tag is a no-op (no duplicate row).
  server.post(
    '/tags/apply',
    {
      schema: {
        body: TagApply,
        response: { 200: EntityTagsResponse },
      },
    },
    async (req) => {
      if (!(await taggableOwnedBy(req.auth.orgId, req.body.entityType, req.body.entityId))) {
        throw server.httpErrors.notFound(`${req.body.entityType} not found`);
      }

      // Validate every tag belongs to the tenant — silently ignore invalid
      // ids rather than half-applying the set.
      const validTagIds = (
        await prisma.tag.findMany({
          where: {
            orgId: req.auth.orgId,
            deletedAt: null,
            id: { in: req.body.tagIds },
          },
          select: { id: true },
        })
      ).map((t) => t.id);

      if (validTagIds.length > 0) {
        await prisma.entityTag.createMany({
          data: validTagIds.map((tagId) => ({
            orgId: req.auth.orgId,
            tagId,
            entityType: req.body.entityType,
            entityId: req.body.entityId,
            taggedById: req.auth.userId,
          })),
          skipDuplicates: true,
        });
      }

      return loadEntityTags(req.auth.orgId, req.body.entityType, req.body.entityId);
    },
  );

  // ─── POST /api/v1/tags/remove ─────────────────────────────────────────
  // Detach a tag from an entity.
  server.post(
    '/tags/remove',
    {
      schema: {
        body: TagApply,
        response: { 200: EntityTagsResponse },
      },
    },
    async (req) => {
      if (!(await taggableOwnedBy(req.auth.orgId, req.body.entityType, req.body.entityId))) {
        throw server.httpErrors.notFound(`${req.body.entityType} not found`);
      }
      await prisma.entityTag.deleteMany({
        where: {
          orgId: req.auth.orgId,
          entityType: req.body.entityType,
          entityId: req.body.entityId,
          tagId: { in: req.body.tagIds },
        },
      });
      return loadEntityTags(req.auth.orgId, req.body.entityType, req.body.entityId);
    },
  );

  // ─── GET /api/v1/tags/entity/:type/:id ────────────────────────────────
  // Return the tags currently applied to a given record.
  server.get(
    '/tags/entity/:type/:id',
    {
      schema: {
        params: z.object({ type: TaggableEntityType, id: z.string().uuid() }),
        response: { 200: EntityTagsResponse },
      },
    },
    async (req) => {
      return loadEntityTags(req.auth.orgId, req.params.type, req.params.id);
    },
  );

  // ─── POST /api/v1/tags/suggest ────────────────────────────────────────
  // AI-suggested tags from arbitrary text (record description, RFP excerpt,
  // intel JSON). Sprint 1 ships a rule-based stub; the Dust prompt-tuning
  // sprint will replace `suggestTagsLocally` with a Dust agent call.
  server.post(
    '/tags/suggest',
    {
      schema: {
        body: TagSuggestRequest,
        response: { 200: TagSuggestResponse },
      },
    },
    async (req) => {
      if (!(await taggableOwnedBy(req.auth.orgId, req.body.entityType, req.body.entityId))) {
        throw server.httpErrors.notFound(`${req.body.entityType} not found`);
      }

      const existing = await prisma.tag.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, name: true },
      });
      const suggestions = suggestTagsLocally(req.body.text, existing);
      return { suggestions };
    },
  );
};

// taggableOwnedBy, loadEntityTags, and suggestTagsLocally extracted to ./tags.helpers.ts (BS-R1)
