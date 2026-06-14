/**
 * custom-objects.defs.routes.ts — object definitions, fields, and relations.
 *
 *   GET    /custom-objects
 *   POST   /custom-objects
 *   PUT    /custom-objects/:id
 *   DELETE /custom-objects/:id
 *   POST   /custom-objects/:id/fields
 *   GET    /custom-objects/:id/relations
 *   POST   /custom-objects/:id/relations
 *
 * Extracted from custom-objects.ts (BS-R1 file-size refactor).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  CustomObjectDef,
  CustomObjectDefCreate,
  CustomObjectDefList,
  CustomObjectDefPatch,
  CustomObjectFieldCreate,
  CustomObjectFieldList,
  CustomObjectRelationCreate,
  CustomObjectRelationList,
} from '@bidstack/shared';

import * as svc from '../services/custom-object.service.js';
import {
  IdParam,
  isSerializedDef,
  serializeDef,
  serializeRelation,
} from './custom-objects.helpers.js';

export const customObjectDefRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── Object Definitions ───────────────────────────────────────────────────

  // GET /custom-objects
  server.get(
    '/custom-objects',
    {
      preHandler: server.requirePermission('customObjects:read'),
      schema: { response: { 200: CustomObjectDefList } },
    },
    async (req) => {
      const defs = await svc.listObjectDefs(req.auth.orgId);
      return { items: defs.map(serializeDef).filter(isSerializedDef) };
    },
  );

  // POST /custom-objects
  server.post(
    '/custom-objects',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('customObjects:write'), server.requireRole('admin')],
      schema: {
        body: CustomObjectDefCreate,
        response: { 201: CustomObjectDef },
      },
    },
    async (req, reply) => {
      const created = await svc.defineObject({ orgId: req.auth.orgId, ...req.body });
      const serialized = serializeDef(created);
      if (!serialized) throw server.httpErrors.internalServerError('Failed to create object');
      return reply.code(201).send(serialized);
    },
  );

  // PUT /custom-objects/:id
  server.put(
    '/custom-objects/:id',
    {
      preHandler: [server.requirePermission('customObjects:write'), server.requireRole('admin')],
      schema: {
        params: IdParam,
        body: CustomObjectDefPatch,
        response: { 200: CustomObjectDef },
      },
    },
    async (req) => {
      const updated = await svc.updateObjectDef(req.auth.orgId, req.params.id, {
        ...req.body,
        description: req.body.description ?? undefined,
      });
      if (!updated) throw server.httpErrors.notFound('Custom object not found');
      const serialized = serializeDef(updated);
      if (!serialized) throw server.httpErrors.internalServerError();
      return serialized;
    },
  );

  // DELETE /custom-objects/:id  — cascades all records (confirm dialog client-side)
  server.delete(
    '/custom-objects/:id',
    {
      preHandler: [server.requirePermission('customObjects:write'), server.requireRole('admin')],
      schema: {
        params: IdParam,
        response: { 200: CustomObjectDef },
      },
    },
    async (req) => {
      const deleted = await svc.deleteObjectDef(req.auth.orgId, req.params.id);
      if (!deleted) throw server.httpErrors.notFound('Custom object not found');
      const serialized = serializeDef(deleted);
      if (!serialized) throw server.httpErrors.internalServerError();
      return serialized;
    },
  );

  // ── Fields ───────────────────────────────────────────────────────────────

  // GET /custom-objects/:id/fields — list the object's custom fields
  server.get(
    '/custom-objects/:id/fields',
    {
      preHandler: server.requirePermission('customObjects:read'),
      schema: {
        params: IdParam,
        response: { 200: CustomObjectFieldList },
      },
    },
    async (req) => {
      const fields = await svc.listObjectFields(req.auth.orgId, req.params.id);
      return {
        items: fields.map((f) => ({
          id: f.id,
          orgId: f.orgId,
          entityType: f.entityType,
          customObjectDefId: f.customObjectDefId ?? null,
          fieldKey: f.fieldKey,
          label: f.label,
          fieldType: f.fieldType,
          options: (f.options as string[] | null) ?? [],
          defaultValue: f.defaultValue ?? null,
          required: f.required,
          orderIndex: f.orderIndex,
          active: f.active,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /custom-objects/:id/fields
  server.post(
    '/custom-objects/:id/fields',
    {
      preHandler: [server.requirePermission('customObjects:write'), server.requireRole('admin')],
      schema: {
        params: IdParam,
        body: CustomObjectFieldCreate,
        response: {
          201: z.object({
            id: z.string().uuid(),
            orgId: z.string().uuid(),
            entityType: z.string(),
            customObjectDefId: z.string().uuid().nullable(),
            fieldKey: z.string(),
            label: z.string(),
            fieldType: z.string(),
            options: z.array(z.string()).nullable(),
            defaultValue: z.unknown().nullable(),
            required: z.boolean(),
            orderIndex: z.number(),
            active: z.boolean(),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      const field = await svc.addFieldToObject({
        orgId: req.auth.orgId,
        objectId: req.params.id,
        ...req.body,
      });
      if (!field) throw server.httpErrors.notFound('Custom object not found');
      return reply.code(201).send({
        id: field.id,
        orgId: field.orgId,
        entityType: field.entityType,
        customObjectDefId: field.customObjectDefId ?? null,
        fieldKey: field.fieldKey,
        label: field.label,
        fieldType: field.fieldType,
        options: (field.options as string[] | null) ?? [],
        defaultValue: field.defaultValue ?? null,
        required: field.required,
        orderIndex: field.orderIndex,
        active: field.active,
        createdAt: field.createdAt.toISOString(),
        updatedAt: field.updatedAt.toISOString(),
      });
    },
  );

  // ── Relations ────────────────────────────────────────────────────────────

  // GET /custom-objects/:id/relations
  server.get(
    '/custom-objects/:id/relations',
    {
      preHandler: server.requirePermission('customObjects:read'),
      schema: {
        params: IdParam,
        response: { 200: CustomObjectRelationList },
      },
    },
    async (req) => {
      const all = await svc.listRelations(req.auth.orgId, req.params.id);
      return { items: all.map(serializeRelation) };
    },
  );

  // POST /custom-objects/:id/relations
  server.post(
    '/custom-objects/:id/relations',
    {
      preHandler: [server.requirePermission('customObjects:write'), server.requireRole('admin')],
      schema: {
        params: IdParam,
        body: CustomObjectRelationCreate,
        response: { 201: CustomObjectRelationList },
      },
    },
    async (req, reply) => {
      const relation = await svc.addRelation({
        orgId: req.auth.orgId,
        objectId: req.params.id,
        ...req.body,
        junctionTableSchema: req.body.junctionTableSchema ?? undefined,
      });
      if (!relation) throw server.httpErrors.notFound('Custom object not found');

      // Return full list so the client can refresh in one shot
      const all = await svc.listRelations(req.auth.orgId, req.params.id);
      return reply.code(201).send({ items: all.map(serializeRelation) });
    },
  );
};
