import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

const OrgUser = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.string(),
  createdAt: z.string().datetime(),
});

export const usersRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/users',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({
          // WHY cursor pagination: a hard take:1000 silently drops users in
          // large orgs and loads the full set on every request even when the
          // caller needs a short dropdown. Cursor + limit fixes both.
          limit: z.coerce.number().int().min(1).max(200).default(100),
          cursor: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({
            items: z.array(OrgUser),
            nextCursor: z.string().uuid().nullable(),
          }),
        },
      },
    },
    async (req) => {
      const { limit, cursor } = req.query;
      const rows = await prisma.user.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

      return {
        items: page.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt.toISOString(),
        })),
        nextCursor,
      };
    },
  );

  server.patch(
    '/users/:id/role',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('users:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ role: z.enum(['member', 'admin']) }),
        response: { 200: OrgUser },
      },
    },
    async (req) => {
      const user = await prisma.user.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!user) throw server.httpErrors.notFound('User not found');
      const updateResult = await prisma.user.updateMany({
        where: { id: user.id, orgId: req.auth.orgId },
        data: { role: req.body.role },
      });
      if (updateResult.count === 0) {
        throw server.httpErrors.notFound('User not found');
      }
      const updated = await prisma.user.findFirstOrThrow({
        where: { id: user.id, orgId: req.auth.orgId },
      });
      return {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        createdAt: updated.createdAt.toISOString(),
      };
    },
  );
};
