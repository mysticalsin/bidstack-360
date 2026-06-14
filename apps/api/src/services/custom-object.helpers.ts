/**
 * Custom Object helpers — shared types and private record utilities.
 *
 * These are implementation details shared between:
 *   custom-object.service.ts  — schema management (defs, fields, relations)
 *   custom-object.records.service.ts — record CRUD
 *
 * nextRecordKey, validateValues, and applyDefaults are only intended for
 * consumption by the two service files above.
 */

import { prisma, type Prisma } from '@bidstack/db';

import { validateFieldValue } from '../lib/custom-field-validation.js';

// ─── Types ──────────────────────────────────────────────────────────────────

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

export function customObjectFieldEntityType(defId: string): string {
  return `CUSTOM_OBJECT:${defId}`;
}

export function customObjectFieldEntityTypes(defId: string): string[] {
  return ['CUSTOM_OBJECT', customObjectFieldEntityType(defId)];
}

// ─── Private record utilities ────────────────────────────────────────────────

/**
 * Generates the next record key for an object def.
 * Counts ALL records ever created (including deleted) to prevent reuse.
 * Format: <PREFIX>-<NNNN> where PREFIX is the first 3 chars of the key uppercased.
 */
export async function nextRecordKey(orgId: string, defId: string, defKey: string): Promise<string> {
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
 * - Raises if a required field is missing or null on create.
 * Returns the sanitized values map.
 */
export async function validateValues(
  orgId: string,
  defId: string,
  values: Record<string, unknown>,
  isCreate: boolean,
): Promise<Record<string, unknown>> {
  const fields = await prisma.customFieldDefinition.findMany({
    where: {
      orgId,
      customObjectDefId: defId,
      entityType: { in: customObjectFieldEntityTypes(defId) },
      active: true,
    },
    select: {
      fieldKey: true,
      required: true,
      defaultValue: true,
      fieldType: true,
      options: true,
    },
    take: 500,
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

  // Validate/coerce every present value against its field type. A bad value
  // (string in a number, off-list select, malformed email) is rejected here
  // rather than stored as opaque JSON. Runs on both create and update.
  for (const f of fields) {
    if (f.fieldKey in sanitized && sanitized[f.fieldKey] !== null && sanitized[f.fieldKey] !== undefined) {
      sanitized[f.fieldKey] = validateFieldValue(
        f.fieldKey,
        f.fieldType,
        (f.options as string[] | null) ?? [],
        sanitized[f.fieldKey],
      );
    }
  }

  // Required-field enforcement: full check on create; on update, reject an
  // explicit null/blank on a required field that was provided in the payload.
  if (isCreate) {
    const missing = fields.filter(
      (f) => f.required && (sanitized[f.fieldKey] === undefined || sanitized[f.fieldKey] === null),
    );
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`Required fields missing: ${missing.map((f) => f.fieldKey).join(', ')}`),
        { statusCode: 400 },
      );
    }
  } else {
    const cleared = fields.filter(
      (f) => f.required && f.fieldKey in values && sanitized[f.fieldKey] == null,
    );
    if (cleared.length > 0) {
      throw Object.assign(
        new Error(`Required fields cannot be cleared: ${cleared.map((f) => f.fieldKey).join(', ')}`),
        { statusCode: 400 },
      );
    }
  }

  return sanitized;
}

/**
 * Applies field defaults lazily on read so existing records are valid
 * even after new required fields are added post-creation.
 */
export async function applyDefaults(
  orgId: string,
  defId: string,
  valuesJson: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await prisma.customFieldDefinition.findMany({
    where: {
      orgId,
      customObjectDefId: defId,
      entityType: { in: customObjectFieldEntityTypes(defId) },
      active: true,
    },
    select: { fieldKey: true, defaultValue: true },
    take: 500,
  });

  const result = { ...valuesJson };
  for (const f of fields) {
    if (!(f.fieldKey in result) && f.defaultValue !== null) {
      result[f.fieldKey] = f.defaultValue;
    }
  }
  return result;
}

// WHY: Prisma type is re-exported so consumers don't need a direct @bidstack/db import
// just for this helper.
export type { Prisma };
