// Wire-format schemas for /api/leads/* (list + detail + mutations + conversion).

import { z } from 'zod';

export const LeadStatus = z.enum([
  'new',
  'contacted',
  'qualified',
  'nurture',
  'disqualified',
  'converted',
]);
export type LeadStatus = z.infer<typeof LeadStatus>;

export const LeadPriority = z.enum(['low', 'medium', 'high', 'critical']);
export type LeadPriority = z.infer<typeof LeadPriority>;

export const LeadSource = z.enum([
  'website',
  'referral',
  'event',
  'cold_outreach',
  'partner',
  'social',
  'other',
]);
export type LeadSource = z.infer<typeof LeadSource>;

export const LeadFilter = z.object({
  status: LeadStatus.optional(),
  priority: LeadPriority.optional(),
  source: LeadSource.optional(),
  ownerId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type LeadFilter = z.infer<typeof LeadFilter>;

export const LeadSummary = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  companyName: z.string(),
  title: z.string().nullable(),
  source: z.string(),
  status: LeadStatus,
  score: z.number().int().min(0).max(100),
  priority: LeadPriority,
  ownerId: z.string().uuid().nullable(),
  ownerName: z.string().nullable(),
  convertedToOpportunityId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LeadSummary = z.infer<typeof LeadSummary>;

export const LeadPage = z.object({
  items: z.array(LeadSummary),
  nextCursor: z.string().uuid().nullable(),
});
export type LeadPage = z.infer<typeof LeadPage>;

export const LeadDetail = LeadSummary.extend({
  notes: z.string().nullable(),
  budget: z.string().nullable(),
  authority: z.string().nullable(),
  need: z.string().nullable(),
  timeline: z.string().nullable(),
  intel: z.record(z.unknown()).nullable(),
});
export type LeadDetail = z.infer<typeof LeadDetail>;

export const LeadCreate = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  companyName: z.string().min(1).max(255),
  title: z.string().max(100).optional(),
  source: LeadSource.default('website'),
  priority: LeadPriority.default('medium'),
  score: z.number().int().min(0).max(100).default(0),
  ownerId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
  budget: z.string().max(20).optional(),
  authority: z.string().max(20).optional(),
  need: z.string().max(20).optional(),
  timeline: z.string().max(20).optional(),
});
export type LeadCreate = z.infer<typeof LeadCreate>;

export const LeadPatch = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    companyName: z.string().min(1).max(255).optional(),
    title: z.string().max(100).optional().nullable(),
    source: LeadSource.optional(),
    status: LeadStatus.optional(),
    priority: LeadPriority.optional(),
    score: z.number().int().min(0).max(100).optional(),
    ownerId: z.string().uuid().optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
    budget: z.string().max(20).optional().nullable(),
    authority: z.string().max(20).optional().nullable(),
    need: z.string().max(20).optional().nullable(),
    timeline: z.string().max(20).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });
export type LeadPatch = z.infer<typeof LeadPatch>;

export const LeadConvertBody = z.object({
  opportunityName: z.string().min(1).max(255).optional(),
  opportunityValueEur: z.number().min(0).optional(),
  stage: z.string().optional(),
});
export type LeadConvertBody = z.infer<typeof LeadConvertBody>;

export const LeadConvertResult = z.object({
  leadId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  contactId: z.string().uuid(),
});
export type LeadConvertResult = z.infer<typeof LeadConvertResult>;
