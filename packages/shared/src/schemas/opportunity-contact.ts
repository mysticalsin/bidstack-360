import { z } from 'zod';

export const OpportunityContact = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  contactId: z.string().uuid(),
  role: z.string().default('stakeholder'),
  isPrimary: z.boolean().default(false),
  influence: z.number().int().min(1).max(5).nullable(),
  sentiment: z.enum(['hot', 'warm', 'neutral', 'cold']).nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  contact: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    role: z.string().nullable(),
  }),
});
export type OpportunityContact = z.infer<typeof OpportunityContact>;

export const OpportunityContactCreate = z.object({
  contactId: z.string().uuid(),
  role: z.string().max(255).optional(),
  isPrimary: z.boolean().optional(),
});
export type OpportunityContactCreate = z.infer<typeof OpportunityContactCreate>;

export const OpportunityContactPatch = z.object({
  role: z.string().optional(),
  isPrimary: z.boolean().optional(),
  influence: z.number().int().min(1).max(5).nullable().optional(),
  sentiment: z.enum(['hot', 'warm', 'neutral', 'cold']).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type OpportunityContactPatch = z.infer<typeof OpportunityContactPatch>;
