import { z } from 'zod';

export const ProposalStatus = z.enum(['draft', 'review', 'approved', 'submitted', 'won', 'lost']);

export const ProposalSectionKey = z.enum([
  'executive_summary',
  'technical_approach',
  'pricing',
  'case_studies',
  'team_bios',
  'risk_matrix',
]);

export const ProposalSection = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  key: ProposalSectionKey,
  title: z.string(),
  content: z.string(),
  wordCount: z.number().int().min(0),
  aiDrafted: z.boolean(),
  sortOrder: z.number().int(),
  required: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const Proposal = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  status: ProposalStatus,
  version: z.number().int().min(1),
  ownerId: z.string().uuid().nullable(),
  complianceScore: z.number().int().min(0).max(100).nullable(),
  dueDate: z.string().date().nullable(),
  sections: z.array(ProposalSection).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProposalCreate = z.object({
  opportunityId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  dueDate: z.string().date().optional(),
});

export const ProposalPatch = z.object({
  name: z.string().min(1).max(255).optional(),
  status: ProposalStatus.optional(),
  dueDate: z.string().date().optional().nullable(),
});

export const ProposalSectionPatch = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.string().max(50_000).optional(),
});

export const ProposalFilter = z.object({
  status: ProposalStatus.optional(),
  opportunityId: z.string().uuid().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const ProposalPage = z.object({
  items: z.array(Proposal.omit({ sections: true })),
  total: z.number().int(),
});

export const ProposalDraftRequest = z.object({
  sectionKey: ProposalSectionKey,
  context: z.string().max(2000).optional(),
});

export const ProposalDraftResponse = z.object({
  sectionKey: ProposalSectionKey,
  content: z.string(),
  wordCount: z.number().int(),
  sources: z.array(z.string()),
});
