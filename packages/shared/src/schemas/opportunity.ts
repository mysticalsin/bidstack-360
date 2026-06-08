import { z } from 'zod';
import { CustomFieldValueLite, CustomFieldValueInput } from './custom-fields.js';
import { IntelPayload } from './intel.js';

/** @deprecated Use PipelineStage table instead of enum. Kept for seed-data and UI transition. */
export const OpportunityStage = z.enum([
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
  'closed_won',
  'closed_lost',
]);
export type OpportunityStage = z.infer<typeof OpportunityStage>;

export const PipelineStage = z.object({
  id: z.string().uuid(),
  name: z.string(),
  probability: z.number(),
  color: z.string().nullable(),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
});
export type PipelineStage = z.infer<typeof PipelineStage>;

// Industry is stored as an unrestricted string in the database so Dust
// data verification and manual inserts can add new verticals without a schema
// change. We provide a helper array for UI pickers but validate as string.
export const INDUSTRIES = [
  'financial_services',
  'insurance',
  'healthcare',
  'manufacturing',
  'retail',
  'technology',
  'energy',
  'government',
  'education',
  'telecom',
  'transportation',
  'logistics',
  'media',
  'real_estate',
  'professional_services',
  'other',
] as const;
export const Industry = z.string().max(100);
export type Industry = string;

export const OpportunityCode = z.string().min(1).max(64);
export const CanonicalOpportunityCode = z.string().regex(/^OP-\d{4}$/);

export const Opportunity = z.object({
  id: z.string().uuid(),
  // Existing CRM data may carry legacy/RFP/test identifiers. Keep reads broad
  // so dirty historical data cannot crash list/detail responses; create/import
  // schemas below still enforce the canonical OP-NNNN format for supplied codes.
  code: OpportunityCode,
  customer: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  stage: z.string().nullable(),
  pipelineStageId: z.string().uuid().nullable(),
  pipelineStage: PipelineStage.nullable(),
  value: z.number().nonnegative().max(1_000_000_000_000),
  probability: z.number().int().min(0).max(100),
  dueDate: z.string().date().nullable(),
  owner: z.string().email().nullable(),
  industry: Industry.nullable(),
  logo: z.string().url().nullable(),
  country: z.string().max(2).nullable(),
  territoryId: z.string().uuid().nullable(),
  territoryName: z.string().nullable(),
  updatedAt: z.string().datetime(),
  taskCount: z.number().int().min(0).default(0),
  commentCount: z.number().int().min(0).default(0),
  viewCount: z.number().int().min(0).default(0),
});
export type Opportunity = z.infer<typeof Opportunity>;

export const OpportunityCreate = Opportunity.omit({
  id: true,
  updatedAt: true,
  taskCount: true,
  commentCount: true,
  viewCount: true,
  territoryName: true,
  pipelineStage: true,
}).extend({
  code: CanonicalOpportunityCode.optional(),
  stage: z.string().nullable().optional(),
  pipelineStageId: z.string().uuid().optional().nullable(),
});
export type OpportunityCreate = z.infer<typeof OpportunityCreate>;

export const OpportunityPatch = Opportunity.partial().omit({
  id: true,
  code: true,
  updatedAt: true,
  taskCount: true,
  commentCount: true,
  viewCount: true,
  territoryName: true,
  pipelineStage: true,
}).extend({
  customFieldValues: z.array(CustomFieldValueInput).optional(),
});
export type OpportunityPatch = z.infer<typeof OpportunityPatch>;

export const OpportunityImport = z.object({
  opportunities: z
    .array(
      OpportunityCreate.omit({ code: true }).extend({
        code: CanonicalOpportunityCode.optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type OpportunityImport = z.infer<typeof OpportunityImport>;

export const OpportunityImportResult = z.object({
  created: z.number().int(),
  errors: z.array(z.object({ index: z.number().int(), message: z.string() })),
});
export type OpportunityImportResult = z.infer<typeof OpportunityImportResult>;

// Filter is consumed from query strings — coerce numerics so callers can pass
// `?limit=20` without manual casting.
export const OpportunityFilter = z.object({
  pipelineStageId: z.string().uuid().optional(),
  stage: OpportunityStage.optional(),
  owner: z.string().optional(),
  industry: Industry.optional(),
  search: z.string().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type OpportunityFilter = z.infer<typeof OpportunityFilter>;

export const OpportunityPage = z.object({
  items: z.array(Opportunity),
  nextCursor: z.string().nullable(),
});
export type OpportunityPage = z.infer<typeof OpportunityPage>;

// Full 360° payload with nested intel, tasks, documents, and timeline.
export const OpportunityFull = Opportunity.extend({
  intel: IntelPayload.nullable().optional(),
  tasks: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      status: z.string(),
      dueDate: z.string().date().nullable(),
    }),
  ),
  documents: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      kind: z.string(),
      bytes: z.number().nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
  timeline: z.array(z.record(z.unknown())).default([]),
  customFieldValues: z.array(CustomFieldValueLite).optional(),
});
export type OpportunityFull = z.infer<typeof OpportunityFull>;

// Dust integration status response.
export const DustStatus = z.object({
  workspace: z.string(),
  lastSyncAt: z.string().datetime().nullable(),
  nextSyncAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  pulled24h: z.number().int(),
  pushed24h: z.number().int(),
  agents: z.array(z.record(z.unknown())),
});
export type DustStatus = z.infer<typeof DustStatus>;
