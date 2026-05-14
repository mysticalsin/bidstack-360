import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { redis } from '../redis.js';

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
            redis: z.boolean(),
          }),
        },
      },
    },
    async () => {
      let db: boolean;
      try {
        await prisma.$queryRaw`SELECT 1`;
        db = true;
      } catch {
        db = false;
      }
      let redisOk: boolean;
      try {
        await redis.ping();
        redisOk = true;
      } catch {
        redisOk = false;
      }
      return {
        ok: db && redisOk,
        db,
        redis: redisOk,
      };
    },
  );
};
