/**
 * Custom Object record CRUD — create, read, update, delete, list, search.
 *
 * Imported by custom-object.service.ts (which re-exports to the route layer).
 * Uses validateValues/applyDefaults from custom-object.helpers.ts.
 */

import { prisma, type Prisma } from '@bidstack/db';
import { logActivity } from './activity.service.js';
import {
  nextRecordKey,
  validateValues,
  applyDefaults,
  type CreateRecordInput,
  type UpdateRecordInput,
  type DeleteRecordInput,
  type ListRecordsInput,
  type SearchRecordsInput,
} from './custom-object.helpers.js';

// ─── Records CRUD ────────────────────────────────────────────────────────────

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

  const sanitized = await validateValues(
    input.orgId,
    record.customObjectDefId,
    input.values,
    false,
  );
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
