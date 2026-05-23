import { z } from 'zod';

export const Company = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(255),
  legalName: z.string().max(255).nullable(),
  domain: z.string().max(255).nullable(),
  industry: z.string().max(100).nullable(),
  employeeCount: z.number().int().min(0).max(999999).nullable(),
  countryCode: z.string().length(2).nullable(),
  address: z.record(z.unknown()).nullable(),
  billingEmail: z.string().email().max(255).nullable(),
  taxId: z.string().max(100).nullable(),
  logoUrl: z.string().url().max(500).nullable(),
  website: z.string().url().max(500).nullable(),
  source: z.string(),
  confidence: z.number(),
  enrichedAt: z.string().datetime().nullable(),
  tier: z.enum(['key', 'top', 'standard']).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Company = z.infer<typeof Company>;

export const CompanyCreate = Company.omit({
  id: true,
  orgId: true,
  createdAt: true,
  updatedAt: true,
  enrichedAt: true,
  confidence: true,
  source: true,
}).extend({
  tier: z.enum(['key', 'top', 'standard']).optional(),
});
export type CompanyCreate = z.infer<typeof CompanyCreate>;

export const CompanyPatch = z
  .object({
    name: z.string().min(1).optional(),
    legalName: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    industry: z.string().nullable().optional(),
    employeeCount: z.number().int().nullable().optional(),
    countryCode: z.string().length(2).nullable().optional(),
    address: z.record(z.unknown()).nullable().optional(),
    billingEmail: z.string().email().nullable().optional(),
    taxId: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    tier: z.enum(['key', 'top', 'standard']).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type CompanyPatch = z.infer<typeof CompanyPatch>;

export const CompanyDetail = Company.extend({
  contacts: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      role: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
    }),
  ),
  opportunities: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      stage: z.string(),
      valueMicros: z.string(),
      probability: z.number(),
      dueDate: z.string().datetime().nullable(),
    }),
  ),
  openCases: z.array(
    z.object({
      id: z.string().uuid(),
      number: z.string(),
      subject: z.string(),
      status: z.string(),
      priority: z.string(),
    }),
  ),
  notes: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      authorName: z.string().nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
});
export type CompanyDetail = z.infer<typeof CompanyDetail>;
