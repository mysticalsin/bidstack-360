// Custom fields engine — definitions and values scoped by org.
//
// Definitions describe the shape of a custom field (label, type, options).
// Values store the actual per-entity data.  Both tables are multi-tenant
// via orgId and every route enforces req.auth.orgId.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, Prisma } from '@bidstack/db';
import {
  CustomFieldDefinition,
  CustomFieldDefinitionCreate,
  CustomFieldDefinitionList,
  CustomFieldDefinitionPatch,
  CustomFieldValueBulkList,
  CustomFieldValueBulkUpsert,
  CustomFieldValueList,
  EntityType,
  type EntityType as EntityTypeEnum,
  type FieldType as FieldTypeEnum,
} from '@bidstack/shared';

export const customFieldsRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── Definitions ────────────────────────────────────────────────────────

  // GET /api/custom-fields/definitions?entityType=
  server.get(
    '/custom-fields/definitions',
    {
      schema: {
        querystring: z.object({
          entityType: EntityType,
        }),
        response: { 200: CustomFieldDefinitionList },
      },
    },
    async (req) => {
      const items = await prisma.customFieldDefinition.findMany({
        where: {
          orgId: req.auth.orgId,
          entityType: req.query.entityType,
          active: true,
        },
        orderBy: { orderIndex: 'asc' },
        take: 500,
      });
      return {
        items: items.map((d) => ({
          id: d.id,
          orgId: d.orgId,
          entityType: d.entityType as EntityTypeEnum,
          fieldKey: d.fieldKey,
          label: d.label,
          fieldType: d.fieldType as FieldTypeEnum,
          options: (d.options as string[] | null) ?? [],
          defaultValue: d.defaultValue ?? null,
          required: d.required,
          orderIndex: d.orderIndex,
          active: d.active,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/custom-fields/definitions
  server.post(
    '/custom-fields/definitions',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: CustomFieldDefinitionCreate,
        response: { 201: CustomFieldDefinition },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const created = await prisma.customFieldDefinition.create({
        data: {
          orgId: req.auth.orgId,
          entityType: body.entityType,
          fieldKey: body.fieldKey,
          label: body.label,
          fieldType: body.fieldType,
          options: body.options ?? [],
          defaultValue: (body.defaultValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          required: body.required ?? false,
          orderIndex: body.orderIndex ?? 0,
        },
      });
      return reply.code(201).send({
        id: created.id,
        orgId: created.orgId,
        entityType: created.entityType as EntityTypeEnum,
        fieldKey: created.fieldKey,
        label: created.label,
        fieldType: created.fieldType as FieldTypeEnum,
        options: (created.options as string[] | null) ?? [],
        defaultValue: created.defaultValue ?? null,
        required: created.required,
        orderIndex: created.orderIndex,
        active: created.active,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );

  // PATCH /api/custom-fields/definitions/:id
  server.patch(
    '/custom-fields/definitions/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: CustomFieldDefinitionPatch,
        response: { 200: CustomFieldDefinition },
      },
    },
    async (req) => {
      const existing = await prisma.customFieldDefinition.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!existing) throw server.httpErrors.notFound('Definition not found');

      const data: Record<string, unknown> = {};
      if (req.body.label !== undefined) data.label = req.body.label;
      if (req.body.fieldKey !== undefined) data.fieldKey = req.body.fieldKey;
      if (req.body.fieldType !== undefined) data.fieldType = req.body.fieldType;
      if (req.body.options !== undefined) data.options = req.body.options;
      if (req.body.defaultValue !== undefined) data.defaultValue = req.body.defaultValue;
      if (req.body.required !== undefined) data.required = req.body.required;
      if (req.body.orderIndex !== undefined) data.orderIndex = req.body.orderIndex;
      if (req.body.active !== undefined) data.active = req.body.active;

      const updated = await prisma.customFieldDefinition.update({
        where: { id: existing.id },
        data: {
          ...data,
          defaultValue:
            data.defaultValue === null
              ? Prisma.JsonNull
              : (data.defaultValue as Prisma.InputJsonValue | undefined),
        },
      });
      return {
        id: updated.id,
        orgId: updated.orgId,
        entityType: updated.entityType as EntityTypeEnum,
        fieldKey: updated.fieldKey,
        label: updated.label,
        fieldType: updated.fieldType as FieldTypeEnum,
        options: (updated.options as string[] | null) ?? [],
        defaultValue: updated.defaultValue ?? null,
        required: updated.required,
        orderIndex: updated.orderIndex,
        active: updated.active,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // DELETE /api/custom-fields/definitions/:id  (soft delete)
  server.delete(
    '/custom-fields/definitions/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: CustomFieldDefinition },
      },
    },
    async (req) => {
      const existing = await prisma.customFieldDefinition.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!existing) throw server.httpErrors.notFound('Definition not found');

      const updated = await prisma.customFieldDefinition.update({
        where: { id: existing.id },
        data: { active: false },
      });
      return {
        id: updated.id,
        orgId: updated.orgId,
        entityType: updated.entityType as EntityTypeEnum,
        fieldKey: updated.fieldKey,
        label: updated.label,
        fieldType: updated.fieldType as FieldTypeEnum,
        options: (updated.options as string[] | null) ?? [],
        defaultValue: updated.defaultValue ?? null,
        required: updated.required,
        orderIndex: updated.orderIndex,
        active: updated.active,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  // ── Values ─────────────────────────────────────────────────────────────

  // GET /api/custom-fields/values?entityType=&entityId=
  server.get(
    '/custom-fields/values',
    {
      schema: {
        querystring: z.object({
          entityType: EntityType,
          entityId: z.string().uuid(),
        }),
        response: { 200: CustomFieldValueList },
      },
    },
    async (req) => {
      const items = await prisma.customFieldValue.findMany({
        where: {
          orgId: req.auth.orgId,
          entityType: req.query.entityType,
          entityId: req.query.entityId,
        },
        include: { definition: true },
        take: 500,
      });
      return {
        items: items.map((v) => ({
          id: v.id,
          orgId: v.orgId,
          definitionId: v.definitionId,
          entityType: v.entityType as EntityTypeEnum,
          entityId: v.entityId,
          value: v.value as unknown,
          createdAt: v.createdAt.toISOString(),
          updatedAt: v.updatedAt.toISOString(),
        })),
      };
    },
  );

  // GET /api/custom-fields/values/bulk?entityType=&entityIds=
  server.get(
    '/custom-fields/values/bulk',
    {
      schema: {
        querystring: z.object({
          entityType: EntityType,
          entityIds: z.string().max(5000),
        }),
        response: { 200: CustomFieldValueBulkList },
      },
    },
    async (req) => {
      const ids = req.query.entityIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) return { items: [] };

      const items = await prisma.customFieldValue.findMany({
        where: {
          orgId: req.auth.orgId,
          entityType: req.query.entityType,
          entityId: { in: ids },
        },
        take: 500,
      });
      return {
        items: items.map((v) => ({
          id: v.id,
          orgId: v.orgId,
          definitionId: v.definitionId,
          entityType: v.entityType as EntityTypeEnum,
          entityId: v.entityId,
          value: v.value as unknown,
          createdAt: v.createdAt.toISOString(),
          updatedAt: v.updatedAt.toISOString(),
        })),
      };
    },
  );

  // PATCH /api/custom-fields/values  (bulk upsert)
  server.patch(
    '/custom-fields/values',
    {
      schema: {
        body: CustomFieldValueBulkUpsert,
        response: { 200: CustomFieldValueList },
      },
    },
    async (req) => {
      const { entityType, entityId, values } = req.body;

      // Verify the entity belongs to this org by checking definitions exist.
      const definitionIds = Object.keys(values);
      if (definitionIds.length === 0) return { items: [] };

      const defs = await prisma.customFieldDefinition.findMany({
        where: {
          id: { in: definitionIds },
          orgId: req.auth.orgId,
          entityType,
          active: true,
        },
        select: { id: true },
        take: 500,
      });
      const allowedIds = new Set(defs.map((d) => d.id));

      const results: Array<{
        id: string;
        orgId: string;
        definitionId: string;
        entityType: string;
        entityId: string;
        value: Prisma.JsonValue;
        createdAt: Date;
        updatedAt: Date;
      }> = [];

      for (const [definitionId, value] of Object.entries(values)) {
        if (!allowedIds.has(definitionId)) continue;
        const upserted = await prisma.customFieldValue.upsert({
          where: {
            orgId_entityType_entityId_definitionId: {
              orgId: req.auth.orgId,
              entityType,
              entityId,
              definitionId,
            },
          },
          update: { value: value as Prisma.InputJsonValue },
          create: {
            orgId: req.auth.orgId,
            definitionId,
            entityType,
            entityId,
            value: value as Prisma.InputJsonValue,
          },
        });
        results.push(upserted);
      }

      return {
        items: results.map((v) => ({
          id: v.id,
          orgId: v.orgId,
          definitionId: v.definitionId,
          entityType: v.entityType as EntityTypeEnum,
          entityId: v.entityId,
          value: v.value as unknown,
          createdAt: v.createdAt.toISOString(),
          updatedAt: v.updatedAt.toISOString(),
        })),
      };
    },
  );
};
