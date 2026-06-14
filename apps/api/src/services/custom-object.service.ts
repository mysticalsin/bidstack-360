/**
 * Custom Object service — all business logic for Wave 7 custom objects.
 *
 * Design decisions:
 * - Record keys (PRJ-0001) are assigned by counting ALL records ever created
 *   for the object (including deleted), so they are monotonic and never reused.
 * - valuesJson is validated on write: unknown field keys are silently stripped,
 *   required fields raise a 400.
 * - Field defaults are applied lazily on read via applyDefaults() so existing
 *   records stay valid when new required fields are added.
 * - Activity logging uses entityType = "custom_object_<defKey>" so timelines
 *   are naturally namespaced without schema changes.
 *
 * Structure:
 *   custom-object.helpers.ts       — shared types + private record utilities
 *   custom-object.records.service.ts — record CRUD
 *   custom-object.service.ts (this) — schema management + re-exports
 */

import { prisma, Prisma } from '@bidstack/db';

import {
  customObjectFieldEntityType,
  customObjectFieldEntityTypes,
} from './custom-object.helpers.js';

// Re-export types and record functions so callers (`import * as svc`) work unchanged
export type {
  DefineObjectInput,
  AddFieldInput,
  AddRelationInput,
  CreateRecordInput,
  UpdateRecordInput,
  DeleteRecordInput,
  ListRecordsInput,
  SearchRecordsInput,
} from './custom-object.helpers.js';

export {
  createRecord,
  getRecord,
  updateRecord,
  deleteRecord,
  listRecords,
  searchRecords,
} from './custom-object.records.service.js';

// ─── Object definition ────────────────────────────────────────────────────────

/**
 * Creates a new custom object definition and bootstraps three system fields:
 * name (text, required), owner (text), and created_date (date).
 * These mirror the "standard fields" pattern in Salesforce.
 */
export async function defineObject(input: {
  orgId: string;
  key: string;
  labelSingular: string;
  labelPlural: string;
  description?: string;
  icon?: string;
  color?: string;
}) {
  const def = await prisma.$transaction(async (tx) => {
    const created = await tx.customObjectDef.create({
      data: {
        orgId: input.orgId,
        key: input.key,
        labelSingular: input.labelSingular,
        labelPlural: input.labelPlural,
        description: input.description ?? null,
        icon: input.icon ?? 'box',
        color: input.color ?? '#6366f1',
      },
    });

    // Bootstrap default fields — entityType 'CUSTOM_OBJECT' + FK
    // Namespace field definitions per object to avoid field-key collisions.
    const entityType = customObjectFieldEntityType(created.id);
    const defaultFields = [
      { fieldKey: 'name', label: 'Name', fieldType: 'text', required: true, orderIndex: 0 },
      { fieldKey: 'owner', label: 'Owner', fieldType: 'text', required: false, orderIndex: 1 },
      {
        fieldKey: 'created_date',
        label: 'Created Date',
        fieldType: 'date',
        required: false,
        orderIndex: 2,
      },
    ];

    for (const f of defaultFields) {
      await tx.customFieldDefinition.create({
        data: {
          orgId: input.orgId,
          entityType,
          customObjectDefId: created.id,
          fieldKey: f.fieldKey,
          label: f.label,
          fieldType: f.fieldType,
          required: f.required,
          orderIndex: f.orderIndex,
          options: [],
        },
      });
    }

    return created;
  });

  return def;
}

/** Returns a single object def scoped to orgId. */
export async function getObjectDef(orgId: string, defId: string) {
  return prisma.customObjectDef.findFirst({
    where: { id: defId, orgId },
  });
}

/** Returns a single object def by its slug key. */
export async function getObjectDefByKey(orgId: string, key: string) {
  return prisma.customObjectDef.findUnique({
    where: { orgId_key: { orgId, key } },
  });
}

/** Lists all object defs for the org including record counts. */
export async function listObjectDefs(orgId: string) {
  // `take` is required: the app's query guard rejects unbounded findMany with
  // a 400, which had been breaking the entire Custom Objects feature (the
  // admin list + editor both 400'd). 200 is far above any realistic number of
  // object definitions for one org.
  const defs = await prisma.customObjectDef.findMany({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  // Efficient count query — one round-trip via groupBy
  const counts = await prisma.customObjectRecord.groupBy({
    by: ['customObjectDefId'],
    where: { orgId, deletedAt: null },
    _count: { id: true },
  });

  const countMap = new Map(counts.map((c) => [c.customObjectDefId, c._count.id]));
  return defs.map((d) => ({ ...d, recordCount: countMap.get(d.id) ?? 0 }));
}

export async function updateObjectDef(
  orgId: string,
  defId: string,
  data: {
    labelSingular?: string;
    labelPlural?: string;
    description?: string;
    icon?: string;
    color?: string;
  },
) {
  const existing = await prisma.customObjectDef.findFirst({ where: { id: defId, orgId } });
  if (!existing) return null;

  return prisma.customObjectDef.update({
    where: { id: defId },
    data: {
      ...(data.labelSingular !== undefined && { labelSingular: data.labelSingular }),
      ...(data.labelPlural !== undefined && { labelPlural: data.labelPlural }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.icon !== undefined && { icon: data.icon }),
      ...(data.color !== undefined && { color: data.color }),
    },
  });
}

/**
 * Deletes a custom object def and cascades to all records.
 * WHY: Prisma's onDelete: Cascade handles the DB cascade; we just need to
 * confirm the def belongs to this org before deleting.
 */
export async function deleteObjectDef(orgId: string, defId: string) {
  const existing = await prisma.customObjectDef.findFirst({ where: { id: defId, orgId } });
  if (!existing) return null;

  // Cascade is handled by DB foreign keys (onDelete: Cascade)
  await prisma.customObjectDef.delete({ where: { id: defId } });
  return existing;
}

// ─── Fields ───────────────────────────────────────────────────────────────────

/** Adds a custom field to an existing custom object def. */
export async function addFieldToObject(input: {
  objectId: string;
  orgId: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  options?: string[];
  defaultValue?: unknown;
  required?: boolean;
  orderIndex?: number;
}) {
  const def = await prisma.customObjectDef.findFirst({
    where: { id: input.objectId, orgId: input.orgId },
  });
  if (!def) return null;

  return prisma.customFieldDefinition.create({
    data: {
      orgId: input.orgId,
      entityType: customObjectFieldEntityType(input.objectId),
      customObjectDefId: input.objectId,
      fieldKey: input.fieldKey,
      label: input.label,
      fieldType: input.fieldType,
      options: input.options ?? [],
      defaultValue:
        input.defaultValue !== undefined
          ? (input.defaultValue as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      required: input.required ?? false,
      orderIndex: input.orderIndex ?? 0,
    },
  });
}

/** Lists active field defs for a custom object def. */
export async function listObjectFields(orgId: string, objectId: string) {
  return prisma.customFieldDefinition.findMany({
    where: {
      orgId,
      customObjectDefId: objectId,
      entityType: { in: customObjectFieldEntityTypes(objectId) },
      active: true,
    },
    orderBy: { orderIndex: 'asc' },
    take: 500,
  });
}

// ─── Relations ────────────────────────────────────────────────────────────────

export async function addRelation(input: {
  objectId: string;
  orgId: string;
  relationKey: string;
  label: string;
  relatedEntityType: string;
  cardinality?: string;
  required?: boolean;
  junctionTableSchema?: Record<string, unknown>;
}) {
  const def = await prisma.customObjectDef.findFirst({
    where: { id: input.objectId, orgId: input.orgId },
  });
  if (!def) return null;

  return prisma.customObjectRelation.create({
    data: {
      orgId: input.orgId,
      customObjectDefId: input.objectId,
      relationKey: input.relationKey,
      label: input.label,
      relatedEntityType: input.relatedEntityType,
      cardinality: input.cardinality ?? 'ONE_TO_MANY',
      required: input.required ?? false,
      junctionTableSchema: input.junctionTableSchema
        ? (input.junctionTableSchema as Prisma.InputJsonObject)
        : Prisma.JsonNull,
    },
  });
}

export async function listRelations(orgId: string, objectId: string) {
  return prisma.customObjectRelation.findMany({
    where: { orgId, customObjectDefId: objectId },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
}
