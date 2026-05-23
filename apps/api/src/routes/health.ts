import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { redis } from '../redis.js';

const CoreHealthSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  redis: z.boolean(),
});

const ReadinessSchema = CoreHealthSchema.extend({
  storage: z.boolean(),
});

async function probeCoreHealth(): Promise<z.infer<typeof CoreHealthSchema>> {
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
}

export function storageConfigReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const driver = (env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (driver === 's3') {
    return Boolean(env.S3_BUCKET && env.S3_BUCKET.trim());
  }
  return env.NODE_ENV !== 'production';
}

export const healthRoute: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/livez',
    {
      config: { public: true },
      schema: {
        response: {
          200: z.object({ ok: z.literal(true) }),
        },
      },
    },
    async () => ({ ok: true as const }),
  );

  server.get(
    '/readyz',
    {
      config: { public: true },
      schema: {
        response: {
          200: ReadinessSchema,
          503: ReadinessSchema,
        },
      },
    },
    async (_req, reply) => {
      const core = await probeCoreHealth();
      const storage = storageConfigReady();
      const body = {
        ...core,
        ok: core.ok && storage,
        storage,
      };
      if (!body.ok) reply.code(503);
      return body;
    },
  );

  server.get(
    '/health',
    {
      config: { public: true },
      schema: {
        response: {
          200: CoreHealthSchema,
        },
      },
    },
    async () => {
      return probeCoreHealth();
    },
  );
};
