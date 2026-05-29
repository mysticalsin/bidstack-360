/**
 * sales-orders.ts — Sales Orders routes (BS-R1 file-size refactor barrel).
 *
 * Implementation split:
 *   sales-orders.helpers.ts      — toPrismaState, mintNextNumber, loadDetail,
 *                                   isUniqueViolation, parseQuantityThousandths
 *   sales-orders.read.routes.ts  — GET /sales/orders, GET /sales/orders/:id
 *   sales-orders.write.routes.ts — POST create + send/confirm/done/cancel/reopen
 *
 * Public export `salesOrdersRoutes` is preserved so server.ts needs no changes.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { salesOrdersExportRoutes } from './sales-orders.export.js';
import { salesOrdersRoutesRead } from './sales-orders.read.routes.js';
import { salesOrdersRoutesWrite } from './sales-orders.write.routes.js';

export const salesOrdersRoutes: FastifyPluginAsyncZod = async (server) => {
  await server.register(salesOrdersRoutesRead);
  await server.register(salesOrdersRoutesWrite);
  await server.register(salesOrdersExportRoutes);
};
