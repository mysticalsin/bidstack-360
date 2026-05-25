/**
 * Custom Objects routes — Wave 7 Salesforce parity.
 *
 * Route hierarchy:
 *   /custom-objects                      — org's object defs
 *   /custom-objects/:id                  — single def (update / delete)
 *   /custom-objects/:id/fields           — add field to def
 *   /custom-objects/:id/relations        — add relation to def
 *   /custom-objects/:id/records          — list / create records
 *   /custom-objects/:id/records/search   — text search
 *   /custom-objects/:id/records/:rid     — get / update / delete record
 *
 * All routes enforce orgId from req.auth — multi-tenancy is mandatory.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  CustomObjectDef,
  CustomObjectDefCreate,
  CustomObjectDefList,
  CustomObjectDefPatch,
  CustomObjectFieldCreate,
  CustomObjectRecord,
  CustomObjectRecordCreate,
  CustomObjectRecordPage,
  CustomObjectRecordPatch,
  CustomObjectRecordListQuery,
  CustomObjectRecordSearchQuery,
  CustomObjectRelationCreate,
  CustomObjectRelationList,
} from '@bidstack/shared';

import * as svc from '../services/custom-object.service.js';

const IdParam = z.object({ id: z.string().uuid() });
const IdAndRecordParam = z.object({ id: z.string().uuid(), rid: z.string().uuid() });

/** Serialises a DB def row to the API response shape. */
function serializeDef(
  d: Awaited<ReturnType<typeof svc.getObjectDef>> & { recordCount?: number },
) {
  if (!d) return null;
  return {
    id: d.id,
    orgId: d.orgId,
    key: d.key,
    labelSingular: d.labelSingular,
    labelPlural: d.labelPlural,
    description: d.description ?? null,
    icon: d.icon,
    color: d.color,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    recordCount: 'recordCount' in d ? (d.recordCount ?? 0) : undefined,
  };
}

function isSerializedDef(
  value: ReturnType<typeof serializeDef>,
): value is NonNullable<ReturnType<typeof serializeDef>> {
  return value !== null;
}

function serializeRecord(r: NonNullable<Awaited<ReturnType<typeof svc.getRecord>>>) {
  return {
    id: r.id,
    orgId: r.orgId,
    customObjectDefId: r.customObjectDefId,
    recordKey: r.recordKey,
    valuesJson: r.valuesJson as Record<string, unknown>,
    createdById: r.createdById ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
  };
}

function serializeRelation(r: {
  id: string;
  orgId: string;
  customObjectDefId: string;
  relationKey: string;
  label: string;
  relatedEntityType: string;
  cardinality: string;
  required: boolean;
  junctionTableSchema: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    orgId: r.orgId,
    customObjectDefId: r.customObjectDefId,
    relationKey: r.relationKey,
    label: r.label,
    relatedEntityType: r.relatedEntityType,
    cardinality: r.cardinality as 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_MANY',
    required: r.required,
    junctionTableSchema: (r.junctionTableSchema as Record<string, unknown>) ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export const customObjectRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── Object Definitions ─────────────────────────────────────────────────

  // GET /custom-objects
  server.get(
    '/custom-objects',
    { schema: { response: { 200: CustomObjectDefList } } },
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

  // ── Fields ─────────────────────────────────────────────────────────────

  // POST /custom-objects/:id/fields
  server.post(
    '/custom-objects/:id/fields',
    {
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

  // ── Relations ──────────────────────────────────────────────────────────

  // POST /custom-objects/:id/relations
  server.post(
    '/custom-objects/:id/relations',
    {
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

  // GET /custom-objects/:id/relations
  server.get(
    '/custom-objects/:id/relations',
    {
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

  // ── Records ────────────────────────────────────────────────────────────

  // GET /custom-objects/:id/records
  server.get(
    '/custom-objects/:id/records',
    {
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
          filter = undefined;
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
