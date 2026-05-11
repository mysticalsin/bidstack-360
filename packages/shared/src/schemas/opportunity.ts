import { z } from 'zod';

export const OpportunityStage = z.enum([
  'discovery',
  'qualified',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
]);
export type OpportunityStage = z.infer<typeof OpportunityStage>;

// Industry is stored as an unrestricted string in the database so Dust
// enrichment and manual inserts can add new verticals without a schema
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
export const Industry = z.string();
export type Industry = string;

export const Opportunity = z.object({
  id: z.string().uuid(),
  code: z.string().regex(/^OP-\d{4}$/),
  customer: z.string().min(1),
  name: z.string().min(1),
  stage: OpportunityStage,
  value: z.number().nonnegative(),
  probability: z.number().int().min(0).max(100),
  dueDate: z.string().date().nullable(),
  owner: z.string().email().nullable(),
  industry: Industry.nullable(),
  logo: z.string().url().nullable(),
  updatedAt: z.string().datetime(),
});
export type Opportunity = z.infer<typeof Opportunity>;

export const OpportunityCreate = Opportunity.omit({
  id: true,
  updatedAt: true,
}).extend({
  code: z
    .string()
    .regex(/^OP-\d{4}$/)
    .optional(),
});
export type OpportunityCreate = z.infer<typeof OpportunityCreate>;

export const OpportunityPatch = Opportunity.partial().omit({
  id: true,
  code: true,
  updatedAt: true,
});
export type OpportunityPatch = z.infer<typeof OpportunityPatch>;

// Filter is consumed from query strings — coerce numerics so callers can pass
// `?limit=20` without manual casting.
export const OpportunityFilter = z.object({
  stage: OpportunityStage.optional(),
  owner: z.string().optional(),
  industry: Industry.optional(),
  search: z.string().optional(),
  cursor: z.string().optional(),
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
  intel: z.record(z.unknown()),
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
