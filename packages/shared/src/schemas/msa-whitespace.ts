// Ranked MSA whitespace flags and the "who works with them" relationship map
// (slice 13b). A flag says: we hold an MSA with this client through one of our
// entities, but sell nothing in these group lines yet. Every factor carries
// its points and the evidence it came from.
import { z } from 'zod';

import { SigningEntityRef } from './msa-intake.js';

export const WhitespaceFactorKey = z.enum(['scope', 'coverage', 'affiliates', 'rate_card', 'renewal', 'intel', 'size']);
export type WhitespaceFactorKey = z.infer<typeof WhitespaceFactorKey>;

export const WhitespaceCitation = z.object({
  kind: z.enum(['clause', 'countries', 'rate_card', 'renewal', 'hiring', 'theme', 'news', 'firmographics']),
  label: z.string().max(300),
  clause: z.string().max(80).nullable().optional(),
  page: z.number().int().nullable().optional(),
  excerpt: z.string().max(400).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
});
export type WhitespaceCitation = z.infer<typeof WhitespaceCitation>;

export const WhitespaceFactor = z.object({
  key: WhitespaceFactorKey,
  label: z.string(),
  points: z.number().int().min(0),
  max: z.number().int().min(0),
  detail: z.string(),
  citations: z.array(WhitespaceCitation),
});
export type WhitespaceFactor = z.infer<typeof WhitespaceFactor>;

export const WhitespaceState = z.enum(['new', 'accepted', 'dismissed']);
export type WhitespaceState = z.infer<typeof WhitespaceState>;

export const WhitespaceDecisionRef = z.object({
  line: z.string(),
  state: z.enum(['accepted', 'dismissed']),
  reason: z.string().nullable(),
  decidedAt: z.string(),
  decidedBy: z.string().nullable(),
  crossSellActionId: z.string().uuid().nullable(),
  opportunityId: z.string().uuid().nullable(),
});
export type WhitespaceDecisionRef = z.infer<typeof WhitespaceDecisionRef>;

export const WhitespaceFlag = z.object({
  id: z.string(),
  msaId: z.string().uuid(),
  msaTitle: z.string(),
  companyId: z.string().uuid(),
  companyName: z.string(),
  signingEntity: SigningEntityRef.pick({ id: true, slug: true, name: true, brandFamily: true, businessLines: true, verificationStatus: true }),
  global: z.boolean(),
  countries: z.array(z.string()),
  lines: z.array(z.string()),
  headline: z.string(),
  score: z.number().int().min(0).max(100),
  factors: z.array(WhitespaceFactor),
  scopeAllowsOtherServices: z.boolean().nullable(),
  scopeNeedsAmendment: z.boolean(),
  expiryDate: z.string().nullable(),
  evidenceHash: z.string(),
  state: WhitespaceState,
  owner: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  decisions: z.array(WhitespaceDecisionRef),
});
export type WhitespaceFlag = z.infer<typeof WhitespaceFlag>;

export const WhitespaceListQuery = z.object({
  line: z.string().max(40).optional(),
  signingEntityId: z.string().uuid().optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  ownerId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  state: z.enum(['new', 'accepted', 'dismissed', 'all']).default('new'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type WhitespaceListQuery = z.infer<typeof WhitespaceListQuery>;

export const WhitespaceListResponse = z.object({
  items: z.array(WhitespaceFlag),
  total: z.number().int(),
  byLine: z.array(z.object({ line: z.string(), count: z.number().int(), topScore: z.number().int() })),
});
export type WhitespaceListResponse = z.infer<typeof WhitespaceListResponse>;

export const WhitespaceAccept = z
  .object({
    line: z.string().min(1).max(40),
    ownerId: z.string().uuid(),
    dueDate: z.string().date(),
    createOpportunity: z.boolean().default(false),
    note: z.string().max(1000).optional(),
  })
  .strict();
export type WhitespaceAccept = z.infer<typeof WhitespaceAccept>;

export const WhitespaceDismiss = z
  .object({
    line: z.string().min(1).max(40),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type WhitespaceDismiss = z.infer<typeof WhitespaceDismiss>;

export const WhitespaceDecisionResponse = z.object({
  flag: WhitespaceFlag.nullable(),
  crossSellActionId: z.string().uuid().nullable(),
  opportunityId: z.string().uuid().nullable(),
});
export type WhitespaceDecisionResponse = z.infer<typeof WhitespaceDecisionResponse>;

// ── Who works with them ──────────────────────────────────────────────────

export const RelationshipCompany = z.object({
  id: z.string().uuid(),
  name: z.string(),
  relation: z.enum(['self', 'parent', 'affiliate']),
  country: z.string().nullable(),
});

export const RelationshipRow = z.object({
  kind: z.enum(['msa', 'opportunity', 'project', 'revenue', 'contact', 'activity']),
  id: z.string(),
  label: z.string(),
  companyId: z.string().uuid(),
  companyName: z.string(),
  entity: z.string().nullable(),
  line: z.string().nullable(),
  owner: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  lastActivityAt: z.string().nullable(),
  valueMicros: z.number().int().nullable(),
  currency: z.string().nullable(),
  country: z.string().nullable(),
});
export type RelationshipRow = z.infer<typeof RelationshipRow>;

export const RelationshipPerson = z.object({
  owner: z.object({ id: z.string().uuid(), name: z.string() }),
  entities: z.array(z.string()),
  lines: z.array(z.string()),
  lastActivityAt: z.string().nullable(),
  valueMicros: z.number().int(),
  currency: z.string().nullable(),
  counts: z.object({
    msas: z.number().int(),
    opportunities: z.number().int(),
    projects: z.number().int(),
    contacts: z.number().int(),
    activities: z.number().int(),
  }),
});
export type RelationshipPerson = z.infer<typeof RelationshipPerson>;

export const RelationshipMap = z.object({
  companyId: z.string().uuid(),
  companies: z.array(RelationshipCompany),
  entities: z.array(
    z.object({
      id: z.string().uuid(),
      slug: z.string(),
      name: z.string(),
      lines: z.array(z.string()),
      msaIds: z.array(z.string().uuid()),
    }),
  ),
  people: z.array(RelationshipPerson),
  rows: z.array(RelationshipRow),
  lines: z.array(z.object({ line: z.string(), count: z.number().int() })),
  countries: z.array(z.string()),
});
export type RelationshipMap = z.infer<typeof RelationshipMap>;
