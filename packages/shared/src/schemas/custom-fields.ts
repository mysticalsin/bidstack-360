import { z } from 'zod';

export const ENTITY_TYPES = [
  'company',
  'contact',
  'opportunity',
  'lead',
  'task',
  'invoice',
] as const;
export const EntityType = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

export const FIELD_TYPES = [
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
] as const;
export const FieldType = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof FieldType>;

export const CustomFieldDefinition = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  entityType: EntityType,
  fieldKey: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  fieldType: FieldType,
  options: z.array(z.string().max(255)).max(100).default([]),
  defaultValue: z.unknown().nullable(),
  required: z.boolean().default(false),
  orderIndex: z.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinition>;

export const CustomFieldDefinitionCreate = CustomFieldDefinition.omit({
  id: true,
  orgId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  options: z.array(z.string().max(255)).max(100).optional(),
  defaultValue: z.unknown().optional(),
});
export type CustomFieldDefinitionCreate = z.infer<typeof CustomFieldDefinitionCreate>;

export const CustomFieldDefinitionPatch = CustomFieldDefinition.partial().omit({
  id: true,
  orgId: true,
  createdAt: true,
  updatedAt: true,
});
export type CustomFieldDefinitionPatch = z.infer<typeof CustomFieldDefinitionPatch>;

export const CustomFieldDefinitionList = z.object({
  items: z.array(CustomFieldDefinition),
});
export type CustomFieldDefinitionList = z.infer<typeof CustomFieldDefinitionList>;

export const CustomFieldValue = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  definitionId: z.string().uuid(),
  entityType: EntityType,
  entityId: z.string().uuid(),
  value: z.unknown(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomFieldValue = z.infer<typeof CustomFieldValue>;

export const CustomFieldValueBulkUpsert = z.object({
  entityType: EntityType,
  entityId: z.string().uuid(),
  values: z.record(z.string().uuid(), z.unknown()),
});
export type CustomFieldValueBulkUpsert = z.infer<typeof CustomFieldValueBulkUpsert>;

export const CustomFieldValueList = z.object({
  items: z.array(CustomFieldValue),
});
export type CustomFieldValueList = z.infer<typeof CustomFieldValueList>;

export const CustomFieldValueBulkList = z.object({
  items: z.array(CustomFieldValue),
});
export type CustomFieldValueBulkList = z.infer<typeof CustomFieldValueBulkList>;

// Lightweight shape used inside entity detail responses.
export const CustomFieldValueLite = z.object({
  id: z.string().uuid(),
  definitionId: z.string().uuid(),
  value: z.unknown(),
});
export type CustomFieldValueLite = z.infer<typeof CustomFieldValueLite>;

// Input shape for PATCHing custom fields through a parent record.
export const CustomFieldValueInput = z.object({
  definitionId: z.string().uuid(),
  value: z.unknown(),
});
export type CustomFieldValueInput = z.infer<typeof CustomFieldValueInput>;
