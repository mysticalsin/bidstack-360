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
      schema: {
        response: { 200: z.array(OrgUser) },
      },
    },
    async (req) => {
      const rows = await prisma.user.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: { createdAt: 'asc' },
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
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ role: z.enum(['member', 'admin']) }),
        response: { 200: OrgUser },
      },
    },
    async (req) => {
      if (req.auth.role !== 'admin') {
        throw server.httpErrors.forbidden('Admin required');
      }
      const user = await prisma.user.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!user) throw server.httpErrors.notFound('User not found');
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { role: req.body.role },
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
