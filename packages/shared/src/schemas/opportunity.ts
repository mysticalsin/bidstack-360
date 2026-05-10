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

// Industry values are normalized snake_case. Update this list whenever a new
// vertical lands in the seed or via Dust enrichment — the response serializer
// rejects unknown values (we'd rather see the failure than silently coerce).
export const Industry = z.enum([
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
]);
export type Industry = z.infer<typeof Industry>;

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
  code: z.string().regex(/^OP-\d{4}$/).optional(),
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
