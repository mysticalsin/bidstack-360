import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { Contact } from '@bidstack/shared';

export const contactsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/contacts',
    {
      schema: {
        querystring: z.object({
          customer: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.object({ items: z.array(Contact) }) },
      },
    },
    async (req) => {
      const items = await prisma.contact.findMany({
        where: {
          orgId: req.auth.orgId,
          ...(req.query.customer ? { customer: req.query.customer } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: req.query.limit,
      });
      return {
        items: items.map((c) => ({
          id: c.id,
          customer: c.customer,
          name: c.name,
          role: c.role,
          email: c.email,
          phone: c.phone,
          influence: c.influence,
          sentiment: c.sentiment,
          createdAt: c.createdAt.toISOString(),
        })),
      };
    },
  );
};
