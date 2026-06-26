// SavedView routes — named, org-scoped, per-user bookmarks of a list page's
// filter / sort / column state (Opportunities, Accounts, Leads, …).
//
// Visibility model:
//   • A caller sees their OWN views plus any view another member marked
//     `shared` (org-wide, read-only to non-owners).
//   • Writes (rename / re-capture / delete) are gated owner-or-admin — a
//     member can only mutate a view they own; an org admin can mutate any.
//     This mirrors the owner-or-admin pattern on /crew-runs (crews.ts).
//
// Every query is org-scoped (`where: { orgId }`) — multi-tenancy is enforced
// at the row level, never trusted from the client.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { Prisma, prisma, type SavedViewEntity as PrismaSavedViewEntity } from '@bidstack/db';
import {
  SavedView,
  SavedViewCreate,
  SavedViewFilters,
  SavedViewList,
  SavedViewListQuery,
  SavedViewPatch,
} from '@bidstack/shared';

const IdParam = z.object({ id: z.string().uuid() });

// The Json columns come back as Prisma.JsonValue; the Zod response schema
// re-validates them, so we narrow with a small serializer rather than casting
// the whole row. Keeping this explicit also documents the on-the-wire shape.
interface SavedViewRow {
  id: string;
  orgId: string;
  userId: string;
  entity: PrismaSavedViewEntity;
  name: string;
  filters: Prisma.JsonValue;
  sort: Prisma.JsonValue;
  columns: Prisma.JsonValue;
  shared: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

function serialize(row: SavedViewRow, callerUserId: string): z.infer<typeof SavedView> {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    entity: row.entity,
    name: row.name,
    // filters defaults to [] at the DB level (legacy) but the app writes {} —
    // coerce a non-object (e.g. the [] default) to {} so the response validates.
    filters: serializeFilters(row.filters),
    sort: (row.sort ?? null) as z.infer<typeof SavedView>['sort'],
    columns: (row.columns ?? null) as z.infer<typeof SavedView>['columns'],
    shared: row.shared,
    sortOrder: row.sortOrder,
    isOwn: row.userId === callerUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SELECT = {
  id: true,
  orgId: true,
  userId: true,
  entity: true,
  name: true,
  filters: true,
  sort: true,
  columns: true,
  shared: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

function serializeFilters(value: Prisma.JsonValue): z.infer<typeof SavedViewFilters> {
  const parsed = SavedViewFilters.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export const savedViewsRoutes: FastifyPluginAsyncZod = async (server) => {
  // Saved views are per-user bookmarks — meaningless for a keyed integration,
  // and an api-role caller's synthetic `apikey:<id>` is not a User UUID, so a
  // write would 500 on the FK and the read OR-filter would throw on the uuid
  // column. Reject api-role up front for the whole router (mirrors kam-drafts.ts
  // / rbac.ts) so every route returns a clean 403 instead of a 500.
  server.addHook('preHandler', async (req) => {
    if (req.auth.role === 'api') {
      throw server.httpErrors.forbidden('Saved views are not available to API keys');
    }
  });

  // ─── GET /api/v1/saved-views ──────────────────────────────────────────
  // The caller's own views + org-shared views, optionally narrowed to one
  // entity (the page that mounted the picker passes ?entity=OPPORTUNITY).
  server.get(
    '/saved-views',
    {
      schema: {
        querystring: SavedViewListQuery,
        response: { 200: SavedViewList },
      },
    },
    async (req) => {
      const items = await prisma.savedView.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.query.entity ? { entity: req.query.entity } : {}),
          OR: [{ userId: req.auth.userId }, { shared: true }],
        },
        select: SELECT,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: 200,
      });
      return { items: items.map((row) => serialize(row, req.auth.userId)) };
    },
  );

  // ─── POST /api/v1/saved-views ─────────────────────────────────────────
  // Any authenticated member can create a view for themselves.
  server.post(
    '/saved-views',
    {
      schema: {
        body: SavedViewCreate,
        response: { 201: SavedView },
      },
    },
    async (req, reply) => {
      const created = await prisma.$transaction(async (tx) => {
        const view = await tx.savedView.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            entity: req.body.entity,
            name: req.body.name,
            filters: req.body.filters as Prisma.InputJsonValue,
            sort: (req.body.sort ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            columns: (req.body.columns ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            shared: req.body.shared,
          },
          select: SELECT,
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'savedView.create',
            targetType: 'savedView',
            targetId: view.id,
            diff: { entity: view.entity, name: view.name, shared: view.shared },
          },
        });
        return view;
      });
      return reply.code(201).send(serialize(created, req.auth.userId));
    },
  );

  // ─── PATCH /api/v1/saved-views/:id ────────────────────────────────────
  // Rename / re-capture / toggle share / reorder. Owner-or-admin only.
  server.patch(
    '/saved-views/:id',
    {
      schema: {
        params: IdParam,
        body: SavedViewPatch,
        response: { 200: SavedView },
      },
    },
    async (req) => {
      const existing = await loadOwnedOrAdmin(req.auth, req.params.id, server);

      const updated = await prisma.$transaction(async (tx) => {
        const view = await tx.savedView.update({
          where: { id: existing.id },
          data: {
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.filters !== undefined
              ? { filters: req.body.filters as Prisma.InputJsonValue }
              : {}),
            ...(req.body.sort !== undefined
              ? { sort: (req.body.sort ?? Prisma.JsonNull) as Prisma.InputJsonValue }
              : {}),
            ...(req.body.columns !== undefined
              ? { columns: (req.body.columns ?? Prisma.JsonNull) as Prisma.InputJsonValue }
              : {}),
            ...(req.body.shared !== undefined ? { shared: req.body.shared } : {}),
            ...(req.body.sortOrder !== undefined ? { sortOrder: req.body.sortOrder } : {}),
          },
          select: SELECT,
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'savedView.update',
            targetType: 'savedView',
            targetId: view.id,
            diff: req.body as object,
          },
        });
        return view;
      });
      return serialize(updated, req.auth.userId);
    },
  );

  // ─── DELETE /api/v1/saved-views/:id ───────────────────────────────────
  // Soft delete. Owner-or-admin only.
  server.delete(
    '/saved-views/:id',
    {
      schema: {
        params: IdParam,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await loadOwnedOrAdmin(req.auth, req.params.id, server);
      await prisma.$transaction([
        prisma.savedView.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'savedView.delete',
            targetType: 'savedView',
            targetId: existing.id,
            diff: { name: existing.name },
          },
        }),
      ]);
      return reply.code(204).send(null);
    },
  );
};

/**
 * Resolve a view the caller is allowed to write. Org-scoped find first so a
 * cross-org id is indistinguishable from a missing one (404, no info leak).
 * Then enforce owner-or-admin: a non-owner, non-admin member gets 403.
 */
async function loadOwnedOrAdmin(
  auth: { orgId: string; userId: string; role: string },
  id: string,
  server: Parameters<FastifyPluginAsyncZod>[0],
): Promise<{ id: string; userId: string; name: string }> {
  const view = await prisma.savedView.findFirst({
    where: { id, orgId: auth.orgId, deletedAt: null },
    select: { id: true, userId: true, name: true },
  });
  if (!view) throw server.httpErrors.notFound('Saved view not found');

  const isOwner = view.userId === auth.userId;
  const isAdmin = auth.role === 'admin';
  if (!isOwner && !isAdmin) {
    throw server.httpErrors.forbidden('Only the view owner or an admin can modify this view');
  }
  return view;
}
