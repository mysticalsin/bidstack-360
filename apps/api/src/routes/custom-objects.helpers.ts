/**
 * custom-objects.helpers.ts — serializers and param schemas.
 *
 * Extracted from custom-objects.ts (BS-R1 file-size refactor).
 * No Fastify server dependency — safe to import from any route sub-file.
 */
import { z } from 'zod';

import type * as svc from '../services/custom-object.service.js';

export const IdParam = z.object({ id: z.string().uuid() });
export const IdAndRecordParam = z.object({ id: z.string().uuid(), rid: z.string().uuid() });

/** Serialises a DB def row to the API response shape. */
export function serializeDef(
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

export function isSerializedDef(
  value: ReturnType<typeof serializeDef>,
): value is NonNullable<ReturnType<typeof serializeDef>> {
  return value !== null;
}

export function serializeRecord(r: NonNullable<Awaited<ReturnType<typeof svc.getRecord>>>) {
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

export function serializeRelation(r: {
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
