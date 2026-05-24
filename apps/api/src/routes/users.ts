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
        response: { 200: z.array(OrgUser) },
      },
    },
    async (req) => {
      const rows = await prisma.user.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      });
      return rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
      }));
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
