/**
 * custom-objects.ts — Custom Objects routes (BS-R1 file-size refactor barrel).
 *
 * Implementation split:
 *   custom-objects.helpers.ts       — serializers + IdParam/IdAndRecordParam
 *   custom-objects.defs.routes.ts   — defs CRUD, fields, relations
 *   custom-objects.records.routes.ts — records CRUD + search
 *
 * Public export `customObjectRoutes` is preserved so server.ts needs no changes.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { customObjectDefRoutes } from './custom-objects.defs.routes.js';
import { customObjectRecordRoutes } from './custom-objects.records.routes.js';

export const customObjectRoutes: FastifyPluginAsyncZod = async (server) => {
  await server.register(customObjectDefRoutes);
  await server.register(customObjectRecordRoutes);
};
