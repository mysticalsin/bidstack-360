/**
 * custom-objects.records.routes.ts — record CRUD + search.
 *
 *   GET    /custom-objects/:id/records
 *   GET    /custom-objects/:id/records/search
 *   POST   /custom-objects/:id/records
 *   GET    /custom-objects/:id/records/:rid
 *   PUT    /custom-objects/:id/records/:rid
 *   DELETE /custom-objects/:id/records/:rid
 *
 * Extracted from custom-objects.ts (BS-R1 file-size refactor).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  CustomObjectRecord,
  CustomObjectRecordCreate,
  CustomObjectRecordListQuery,
  CustomObjectRecordPage,
  CustomObjectRecordPatch,
  CustomObjectRecordSearchQuery,
} from '@bidstack/shared';

import * as svc from '../services/custom-object.service.js';
import { IdAndRecordParam, IdParam, serializeRecord } from './custom-objects.helpers.js';

export const customObjectRecordRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /custom-objects/:id/records
  server.get(
    '/custom-objects/:id/records',
    {
      preHandler: server.requirePermission('customObjects:read'),
      schema: {
        params: IdParam,
        querystring: CustomObjectRecordListQuery,
        response: { 200: CustomObjectRecordPage },
      },
    },
    async (req) => {
      let filter: Record<string, unknown> | undefined;
      if (req.query.filter) {
        try {
          filter = JSON.parse(req.query.filter) as Record<string, unknown>;
        } catch {
          // Don't silently return everything when the client sent a bad filter.
          throw server.httpErrors.badRequest('Invalid filter JSON');
        }
      }

      const result = await svc.listRecords({
        orgId: req.auth.orgId,
        objectId: req.params.id,
        filter,
        sort: req.query.sort,
        page: req.query.page,
        limit: req.query.limit,
      });

      return {
        items: result.items.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          customObjectDefId: r.customObjectDefId,
          recordKey: r.recordKey,
          valuesJson: r.valuesJson as Record<string, unknown>,
          createdById: r.createdById ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          deletedAt: r.deletedAt?.toISOString() ?? null,
        })),
        total: result.total,
        page: result.page,
        limit: result.limit,
      };
    },
  );

  // GET /custom-objects/:id/records/search
  server.get(
    '/custom-objects/:id/records/search',
    {
      preHandler: server.requirePermission('customObjects:read'),
      schema: {
        params: IdParam,
        querystring: CustomObjectRecordSearchQuery,
      },
    },
    async (req) => {
      return svc.searchRecords({
        orgId: req.auth.orgId,
        objectId: req.params.id,
        q: req.query.q,
        limit: req.query.limit,
      });
    },
  );

  // POST /custom-objects/:id/records
  server.post(
    '/custom-objects/:id/records',
    {
      preHandler: server.requirePermission('customObjects:write'),
      schema: {
        params: IdParam,
        body: CustomObjectRecordCreate,
        response: { 201: CustomObjectRecord },
      },
    },
    async (req, reply) => {
      const record = await svc.createRecord({
        orgId: req.auth.orgId,
        objectId: req.params.id,
        values: req.body.values,
        actorId: req.auth.userId,
      });
      if (!record) throw server.httpErrors.notFound('Custom object not found');
      // Re-fetch to get def hydration and defaults
      const full = await svc.getRecord(req.auth.orgId, record.id);
      if (!full) throw server.httpErrors.internalServerError();
      return reply.code(201).send(serializeRecord(full));
    },
  );

  // GET /custom-objects/:id/records/:rid
  server.get(
    '/custom-objects/:id/records/:rid',
    {
      preHandler: server.requirePermission('customObjects:read'),
      schema: {
        params: IdAndRecordParam,
        response: { 200: CustomObjectRecord },
      },
    },
    async (req) => {
      const record = await svc.getRecord(req.auth.orgId, req.params.rid);
      if (!record) throw server.httpErrors.notFound('Record not found');
      // Verify record belongs to the stated def
      if (record.customObjectDefId !== req.params.id) {
        throw server.httpErrors.notFound('Record not found');
      }
      return serializeRecord(record);
    },
  );

  // PUT /custom-objects/:id/records/:rid
  server.put(
    '/custom-objects/:id/records/:rid',
    {
      preHandler: server.requirePermission('customObjects:write'),
      schema: {
        params: IdAndRecordParam,
        body: CustomObjectRecordPatch,
        response: { 200: CustomObjectRecord },
      },
    },
    async (req) => {
      const updated = await svc.updateRecord({
        orgId: req.auth.orgId,
        recordId: req.params.rid,
        values: req.body.values,
        actorId: req.auth.userId,
      });
      if (!updated) throw server.httpErrors.notFound('Record not found');
      const full = await svc.getRecord(req.auth.orgId, updated.id);
      if (!full) throw server.httpErrors.internalServerError();
      return serializeRecord(full);
    },
  );

  // DELETE /custom-objects/:id/records/:rid  (soft delete)
  server.delete(
    '/custom-objects/:id/records/:rid',
    {
      preHandler: server.requirePermission('customObjects:write'),
      schema: {
        params: IdAndRecordParam,
        response: { 200: CustomObjectRecord },
      },
    },
    async (req) => {
      const deleted = await svc.deleteRecord({
        orgId: req.auth.orgId,
        recordId: req.params.rid,
        actorId: req.auth.userId,
      });
      if (!deleted) throw server.httpErrors.notFound('Record not found');
      return {
        id: deleted.id,
        orgId: deleted.orgId,
        customObjectDefId: deleted.customObjectDefId,
        recordKey: deleted.recordKey,
        valuesJson: deleted.valuesJson as Record<string, unknown>,
        createdById: deleted.createdById ?? null,
        createdAt: deleted.createdAt.toISOString(),
        updatedAt: deleted.updatedAt.toISOString(),
        deletedAt: deleted.deletedAt?.toISOString() ?? null,
      };
    },
  );
};
