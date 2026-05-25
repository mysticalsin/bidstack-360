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
 */

import { prisma, Prisma } from '@bidstack/db';
import { logActivity } from './activity.service.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DefineObjectInput {
  orgId: string;
  key: string;
  labelSingular: string;
  labelPlural: string;
  description?: string;
  icon?: string;
  color?: string;
}

export interface AddFieldInput {
  objectId: string;
  orgId: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  options?: string[];
  defaultValue?: unknown;
  required?: boolean;
  orderIndex?: number;
}

export interface AddRelationInput {
  objectId: string;
  orgId: string;
  relationKey: string;
  label: string;
  relatedEntityType: string;
  cardinality?: string;
  required?: boolean;
  junctionTableSchema?: Record<string, unknown>;
}

export interface CreateRecordInput {
  orgId: string;
  objectId: string;
  values: Record<string, unknown>;
  actorId?: string;
}

export interface UpdateRecordInput {
  orgId: string;
  recordId: string;
  values: Record<string, unknown>;
  actorId?: string;
}

export interface DeleteRecordInput {
  orgId: string;
  recordId: string;
  actorId?: string;
}

export interface ListRecordsInput {
  orgId: string;
  objectId: string;
  filter?: Record<string, unknown>;
  sort?: string;
  page?: number;
  limit?: number;
}

export interface SearchRecordsInput {
  orgId: string;
  objectId: string;
  q: string;
  limit?: number;
}

// ─── Object definition ─────────────────────────────────────────────────────

/**
 * Creates a new custom object definition and bootstraps three system fields:
 * name (text, required), owner (text), and created_date (date).
 * These mirror the "standard fields" pattern in Salesforce.
 */
export async function defineObject(input: DefineObjectInput) {
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
    const defaultFields = [
      {
        fieldKey: 'name',
        label: 'Name',
        fieldType: 'text',
        required: true,
        orderIndex: 0,
      },
      {
        fieldKey: 'owner',
        label: 'Owner',
        fieldType: 'text',
        required: false,
        orderIndex: 1,
      },
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
          entityType: 'CUSTOM_OBJECT',
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
  const defs = await prisma.customObjectDef.findMany({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
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

// ─── Fields ────────────────────────────────────────────────────────────────

/** Adds a custom field to an existing custom object def. */
export async function addFieldToObject(input: AddFieldInput) {
  const def = await prisma.customObjectDef.findFirst({
    where: { id: input.objectId, orgId: input.orgId },
  });
  if (!def) return null;

  return prisma.customFieldDefinition.create({
    data: {
      orgId: input.orgId,
      entityType: 'CUSTOM_OBJECT',
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
      entityType: 'CUSTOM_OBJECT',
      active: true,
    },
    orderBy: { orderIndex: 'asc' },
    take: 500,
  });
}

// ─── Relations ─────────────────────────────────────────────────────────────

export async function addRelation(input: AddRelationInput) {
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
  });
}

// ─── Records ───────────────────────────────────────────────────────────────

/**
 * Generates the next record key for an object def.
 * Counts ALL records ever created (including deleted) to prevent reuse.
 * Format: <PREFIX>-<NNNN> where PREFIX is the first 3 chars of the key uppercased.
 */
async function nextRecordKey(orgId: string, defId: string, defKey: string): Promise<string> {
  const count = await prisma.customObjectRecord.count({
    where: { orgId, customObjectDefId: defId },
  });
  const prefix = defKey.slice(0, 3).toUpperCase();
  const seq = String(count + 1).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/**
 * Validates a values map against the object's active field definitions.
 * - Strips unknown keys (defence-in-depth; UI already enforces this).
 * - Raises if a required field is missing or null.
 * Returns the sanitized values map.
 */
async function validateValues(
  orgId: string,
  defId: string,
  values: Record<string, unknown>,
  isCreate: boolean,
): Promise<Record<string, unknown>> {
  const fields = await prisma.customFieldDefinition.findMany({
    where: { orgId, customObjectDefId: defId, entityType: 'CUSTOM_OBJECT', active: true },
    select: { fieldKey: true, required: true, defaultValue: true },
  });

  const allowed = new Set(fields.map((f) => f.fieldKey));
  const sanitized: Record<string, unknown> = {};

  // Only keep recognised keys
  for (const [k, v] of Object.entries(values)) {
    if (allowed.has(k)) sanitized[k] = v;
  }

  // Apply defaults for missing fields on create
  if (isCreate) {
    for (const f of fields) {
      if (!(f.fieldKey in sanitized) && f.defaultValue !== null) {
        sanitized[f.fieldKey] = f.defaultValue;
      }
    }
  }

  // Check required fields on create
  if (isCreate) {
    const missing = fields.filter(
      (f) => f.required && (sanitized[f.fieldKey] === undefined || sanitized[f.fieldKey] === null),
    );
    if (missing.length > 0) {
      throw Object.assign(new Error(`Required fields missing: ${missing.map((f) => f.fieldKey).join(', ')}`), {
        statusCode: 400,
      });
    }
  }

  return sanitized;
}

/**
 * Applies field defaults lazily on read so existing records are valid
 * even after new required fields are added post-creation.
 */
async function applyDefaults(
  orgId: string,
  defId: string,
  valuesJson: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await prisma.customFieldDefinition.findMany({
    where: { orgId, customObjectDefId: defId, entityType: 'CUSTOM_OBJECT', active: true },
    select: { fieldKey: true, defaultValue: true },
  });

  const result = { ...valuesJson };
  for (const f of fields) {
    if (!(f.fieldKey in result) && f.defaultValue !== null) {
      result[f.fieldKey] = f.defaultValue;
    }
  }
  return result;
}

export async function createRecord(input: CreateRecordInput) {
  const def = await prisma.customObjectDef.findFirst({
    where: { id: input.objectId, orgId: input.orgId },
  });
  if (!def) return null;

  const sanitized = await validateValues(input.orgId, input.objectId, input.values, true);
  const recordKey = await nextRecordKey(input.orgId, input.objectId, def.key);

  const record = await prisma.customObjectRecord.create({
    data: {
      orgId: input.orgId,
      customObjectDefId: input.objectId,
      recordKey,
      valuesJson: sanitized as Prisma.InputJsonObject,
      createdById: input.actorId ?? null,
    },
  });

  await logActivity({
    orgId: input.orgId,
    entityType: `custom_object_${def.key}`,
    entityId: record.id,
    type: 'note',
    actorId: input.actorId,
    actorType: 'user',
    subject: `${def.labelSingular} ${recordKey} created`,
    body: { recordKey, defKey: def.key },
  });

  return record;
}

export async function getRecord(orgId: string, recordId: string) {
  const record = await prisma.customObjectRecord.findFirst({
    where: { id: recordId, orgId, deletedAt: null },
    include: { customObjectDef: true },
  });
  if (!record) return null;

  const withDefaults = await applyDefaults(
    orgId,
    record.customObjectDefId,
    record.valuesJson as Record<string, unknown>,
  );
  return { ...record, valuesJson: withDefaults };
}

export async function updateRecord(input: UpdateRecordInput) {
  const record = await prisma.customObjectRecord.findFirst({
    where: { id: input.recordId, orgId: input.orgId, deletedAt: null },
    include: { customObjectDef: true },
  });
  if (!record) return null;

  const sanitized = await validateValues(input.orgId, record.customObjectDefId, input.values, false);
  // Merge: keep existing values, overlay the provided keys
  const merged = {
    ...(record.valuesJson as Record<string, unknown>),
    ...sanitized,
  };

  const updated = await prisma.customObjectRecord.update({
    where: { id: input.recordId },
    data: { valuesJson: merged as Prisma.InputJsonObject },
  });

  await logActivity({
    orgId: input.orgId,
    entityType: `custom_object_${record.customObjectDef.key}`,
    entityId: input.recordId,
    type: 'note',
    actorId: input.actorId,
    actorType: 'user',
    subject: `${record.customObjectDef.labelSingular} ${record.recordKey} updated`,
    body: { recordKey: record.recordKey, changedKeys: Object.keys(sanitized) },
  });

  return updated;
}

export async function deleteRecord(input: DeleteRecordInput) {
  const record = await prisma.customObjectRecord.findFirst({
    where: { id: input.recordId, orgId: input.orgId, deletedAt: null },
    include: { customObjectDef: true },
  });
  if (!record) return null;

  const deleted = await prisma.customObjectRecord.update({
    where: { id: input.recordId },
    data: { deletedAt: new Date() },
  });

  await logActivity({
    orgId: input.orgId,
    entityType: `custom_object_${record.customObjectDef.key}`,
    entityId: input.recordId,
    type: 'note',
    actorId: input.actorId,
    actorType: 'user',
    subject: `${record.customObjectDef.labelSingular} ${record.recordKey} deleted`,
    body: { recordKey: record.recordKey },
  });

  return deleted;
}

export async function listRecords(input: ListRecordsInput) {
  const page = input.page ?? 1;
  const limit = Math.min(input.limit ?? 50, 200);
  const skip = (page - 1) * limit;

  // Build filter clause from provided JSON filter map
  let valuesFilter: Prisma.CustomObjectRecordWhereInput = {};
  if (input.filter && Object.keys(input.filter).length > 0) {
    // Postgres JSON path filter: path(['fieldKey']) equals value
    // We use a raw approach: filter per key using jsonb path contains
    const conditions = Object.entries(input.filter).map(([k, v]) => ({
      valuesJson: { path: [k], equals: v as Prisma.InputJsonValue },
    }));
    if (conditions.length === 1) {
      valuesFilter = conditions[0] ?? {};
    } else if (conditions.length > 1) {
      valuesFilter = { AND: conditions };
    }
  }

  // Sort: default to createdAt desc; support "field:asc" or "field:desc"
  let orderBy: Prisma.CustomObjectRecordOrderByWithRelationInput = { createdAt: 'desc' };
  if (input.sort) {
    const [field, dir] = input.sort.split(':');
    const direction = dir === 'asc' ? 'asc' : 'desc';
    if (field === 'recordKey') {
      orderBy = { recordKey: direction };
    } else if (field === 'updatedAt') {
      orderBy = { updatedAt: direction };
    }
    // valuesJson sort not supported server-side — client can sort after fetch
  }

  const where: Prisma.CustomObjectRecordWhereInput = {
    orgId: input.orgId,
    customObjectDefId: input.objectId,
    deletedAt: null,
    ...valuesFilter,
  };

  const [items, total] = await Promise.all([
    prisma.customObjectRecord.findMany({ where, skip, take: limit, orderBy }),
    prisma.customObjectRecord.count({ where }),
  ]);

  return { items, total, page, limit };
}

/**
 * Full-text search across all isSearchable fields.
 * WHY: We search by scanning valuesJson values via Postgres ILIKE on the
 * JSON text representation — simple and sufficient for v1; can be upgraded
 * to a tsvector index later.
 */
export async function searchRecords(input: SearchRecordsInput) {
  const limit = Math.min(input.limit ?? 20, 50);
  const term = `%${input.q}%`;

  // Raw query: cast valuesJson to text and ILIKE search
  // Scoped to org + object def + not deleted for multi-tenant safety.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; record_key: string; values_json: unknown }>
  >`
    SELECT id, record_key, values_json
    FROM custom_object_records
    WHERE org_id = ${input.orgId}::uuid
      AND custom_object_def_id = ${input.objectId}::uuid
      AND deleted_at IS NULL
      AND values_json::text ILIKE ${term}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    recordKey: r.record_key,
    valuesJson: r.values_json as Record<string, unknown>,
  }));
}
