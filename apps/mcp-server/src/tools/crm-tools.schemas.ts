/**
 * crm-tools.schemas.ts — Zod input schemas for CRM MCP tools.
 *
 * Extracted from crm-tools.ts (BS-R1 file-size refactor).
 * Import via crm-tools.ts (re-exported internally).
 */
import { z } from 'zod';

export const Stage = z.enum([
  'discovery',
  'qualified',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
]);

export const CompanySearchInput = z.object({
  query: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const DealCreateInput = z.object({
  customer: z.string().min(1),
  name: z.string().min(1),
  stage: Stage.default('discovery'),
  value: z.number().nonnegative().default(0),
  probability: z.number().int().min(0).max(100).default(25),
  dueDate: z.string().date().nullable().optional(),
  industry: z.string().nullable().optional(),
});

export const DealUpdateInput = z.object({
  id: z.string().uuid(),
  patch: z.object({
    stage: Stage.optional(),
    probability: z.number().int().min(0).max(100).optional(),
    value: z.number().nonnegative().optional(),
    dueDate: z.string().date().nullable().optional(),
    customer: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    industry: z.string().nullable().optional(),
  }),
});

export const EnrichCompanyInput = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  website: z.string().url().optional(),
});

export const ActivityListInput = z.object({
  company: z.string().optional(),
  dealId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const ActivityCreateInput = z.object({
  dealId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  dueDate: z.string().date().nullable().optional(),
});

export const GenerateInsightsInput = z.object({
  company: z.string().optional(),
  dealId: z.string().uuid().optional(),
});
