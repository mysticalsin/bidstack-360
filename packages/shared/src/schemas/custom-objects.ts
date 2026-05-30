/**
 * Custom Objects — Zod schemas shared between API routes and frontend hooks.
 *
 * WHY a dedicated file: custom objects have both definition-level schemas
 * (CustomObjectDef) and record-level schemas (CustomObjectRecord) plus
 * relations. Keeping them here avoids duplicating validation in routes.
 */
import { z } from 'zod';

// ─── Cardinality enum ──────────────────────────────────────────────────────

export const CARDINALITIES = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_MANY'] as const;
export const Cardinality = z.enum(CARDINALITIES);
export type Cardinality = z.infer<typeof Cardinality>;

// ─── CustomObjectDef ───────────────────────────────────────────────────────

export const CustomObjectDef = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/, 'key must be lowercase alphanumeric, dash or underscore'),
  labelSingular: z.string().min(1).max(128),
  labelPlural: z.string().min(1).max(128),
  description: z.string().max(512).nullable(),
  icon: z.string().min(1).max(64).default('box'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex string')
    .default('#6366f1'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Populated when listing: number of non-deleted records */
  recordCount: z.number().int().min(0).optional(),
});
export type CustomObjectDef = z.infer<typeof CustomObjectDef>;

export const CustomObjectDefCreate = CustomObjectDef.omit({
  id: true,
  orgId: true,
  createdAt: true,
  updatedAt: true,
  recordCount: true,
}).extend({
  description: z.string().max(512).optional(),
});
export type CustomObjectDefCreate = z.infer<typeof CustomObjectDefCreate>;

export const CustomObjectDefPatch = CustomObjectDef.partial().omit({
  id: true,
  orgId: true,
  key: true, // key is immutable after creation
  createdAt: true,
  updatedAt: true,
  recordCount: true,
});
export type CustomObjectDefPatch = z.infer<typeof CustomObjectDefPatch>;

export const CustomObjectDefList = z.object({
  items: z.array(CustomObjectDef),
});
export type CustomObjectDefList = z.infer<typeof CustomObjectDefList>;

// ─── CustomObjectRelation ──────────────────────────────────────────────────

export const CustomObjectRelation = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  customObjectDefId: z.string().uuid(),
  relationKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().min(1).max(128),
  relatedEntityType: z.string().min(1).max(64),
  cardinality: Cardinality.default('ONE_TO_MANY'),
  required: z.boolean().default(false),
  junctionTableSchema: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomObjectRelation = z.infer<typeof CustomObjectRelation>;

export const CustomObjectRelationCreate = CustomObjectRelation.omit({
  id: true,
  orgId: true,
  customObjectDefId: true,
  createdAt: true,
  updatedAt: true,
});
export type CustomObjectRelationCreate = z.infer<typeof CustomObjectRelationCreate>;

export const CustomObjectRelationList = z.object({
  items: z.array(CustomObjectRelation),
});
export type CustomObjectRelationList = z.infer<typeof CustomObjectRelationList>;

// ─── Field def for custom objects ─────────────────────────────────────────

export const CustomObjectFieldCreate = z.object({
  fieldKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(128),
  fieldType: z.enum([
    'text',
    'number',
    'date',
    'boolean',
    'select',
    'multi_select',
    'currency',
    'url',
    'email',
    'phone',
  ]),
  options: z.array(z.string().max(255)).max(100).optional(),
  defaultValue: z.unknown().optional(),
  required: z.boolean().default(false),
  orderIndex: z.number().int().min(0).max(999).default(0),
});
export type CustomObjectFieldCreate = z.infer<typeof CustomObjectFieldCreate>;

// Read shape for a persisted custom-object field (mirrors the POST response).
export const CustomObjectField = z.object({
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
  orderIndex: z.number().int(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomObjectField = z.infer<typeof CustomObjectField>;

export const CustomObjectFieldList = z.object({
  items: z.array(CustomObjectField),
});
export type CustomObjectFieldList = z.infer<typeof CustomObjectFieldList>;

// ─── CustomObjectRecord ────────────────────────────────────────────────────

export const CustomObjectRecord = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  customObjectDefId: z.string().uuid(),
  recordKey: z.string().min(1).max(32),
  valuesJson: z.record(z.unknown()),
  createdById: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  /** Hydrated on read: def metadata for rendering */
  def: CustomObjectDef.optional(),
});
export type CustomObjectRecord = z.infer<typeof CustomObjectRecord>;

export const CustomObjectRecordCreate = z.object({
  values: z.record(z.unknown()),
});
export type CustomObjectRecordCreate = z.infer<typeof CustomObjectRecordCreate>;

export const CustomObjectRecordPatch = z.object({
  values: z.record(z.unknown()),
});
export type CustomObjectRecordPatch = z.infer<typeof CustomObjectRecordPatch>;

export const CustomObjectRecordPage = z.object({
  items: z.array(CustomObjectRecord),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type CustomObjectRecordPage = z.infer<typeof CustomObjectRecordPage>;

// ─── Query params ──────────────────────────────────────────────────────────

export const CustomObjectRecordListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.string().max(64).optional(),
  /** JSON-encoded filter map fieldKey→value */
  filter: z.string().max(2000).optional(),
});
export type CustomObjectRecordListQuery = z.infer<typeof CustomObjectRecordListQuery>;

export const CustomObjectRecordSearchQuery = z.object({
  q: z.string().min(1).max(256),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CustomObjectRecordSearchQuery = z.infer<typeof CustomObjectRecordSearchQuery>;
