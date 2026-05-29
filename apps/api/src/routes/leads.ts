/**
 * leads.ts — Lead management routes (BS-R1 file-size refactor barrel).
 *
 * Implementation split:
 *   leads.read.routes.ts  — GET /leads, GET /leads/:id
 *   leads.write.routes.ts — POST /leads, PATCH /leads/:id,
 *                            POST /leads/:id/convert, DELETE /leads/:id
 *
 * Public export `leadRoutes` is preserved so the server registration
 * (apps/api/src/server.ts) needs no changes.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { leadRoutesRead } from './leads.read.routes.js';
import { leadRoutesWrite } from './leads.write.routes.js';

export const leadRoutes: FastifyPluginAsyncZod = async (server) => {
  await server.register(leadRoutesRead);
  await server.register(leadRoutesWrite);
};
