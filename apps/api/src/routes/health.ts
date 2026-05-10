import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

export const healthRoute: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/health',
    {
      config: { public: true },
      schema: {
        response: {
          200: z.object({
            ok: z.boolean(),
            db: z.boolean(),
            uptimeSec: z.number(),
            version: z.string(),
          }),
        },
      },
    },
    async () => {
      let db = false;
      try {
        await prisma.$queryRaw`SELECT 1`;
        db = true;
      } catch {
        db = false;
      }
      return {
        ok: db,
        db,
        uptimeSec: Math.round(process.uptime()),
        version: process.env.npm_package_version ?? '0.1.0',
      };
    },
  );
};
