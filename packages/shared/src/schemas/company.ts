import { z } from 'zod';
import { CustomFieldValueLite, CustomFieldValueInput } from './custom-fields.js';

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
  parentId: z.string().uuid().nullable(),
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
  parentId: z.string().uuid().optional(),
});
export type CompanyCreate = z.infer<typeof CompanyCreate>;

export const CompanyPatch = z
  .object({
    // Mirror the bounds + URL validation from the base Company schema — the PATCH
    // path must not be a backdoor for non-URL / unbounded values that corrupt the
    // row and then 500 on read (response is validated against Company). (Review
    // finding, 2026-06-04.)
    name: z.string().min(1).max(255).optional(),
    legalName: z.string().max(255).nullable().optional(),
    domain: z.string().max(255).nullable().optional(),
    industry: z.string().max(100).nullable().optional(),
    employeeCount: z.number().int().min(0).max(999999).nullable().optional(),
    countryCode: z.string().length(2).nullable().optional(),
    address: z.record(z.unknown()).nullable().optional(),
    billingEmail: z.string().email().max(255).nullable().optional(),
    taxId: z.string().max(100).nullable().optional(),
    logoUrl: z.string().url().max(500).nullable().optional(),
    website: z.string().url().max(500).nullable().optional(),
    tier: z.enum(['key', 'top', 'standard']).nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    customFieldValues: z.array(CustomFieldValueInput).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type CompanyPatch = z.infer<typeof CompanyPatch>;

export interface CompanyHierarchyNode {
  id: string;
  name: string;
  parentId: string | null;
  children: CompanyHierarchyNode[];
}

export const CompanyHierarchyNodeSchema = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    parentId: z.string().uuid().nullable(),
    children: z.array(CompanyHierarchyNodeSchema),
  }),
) as z.ZodSchema<CompanyHierarchyNode>;

export const CompanyHierarchy = z.object({
  ancestors: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  directChildren: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  tree: CompanyHierarchyNodeSchema,
});
export type CompanyHierarchy = z.infer<typeof CompanyHierarchy>;

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
  parent: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  children: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  customFieldValues: z.array(CustomFieldValueLite).optional(),
});
export type CompanyDetail = z.infer<typeof CompanyDetail>;
