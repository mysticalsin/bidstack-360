/**
 * Consulting partners contracts (slice 15): which third-party consulting
 * firms work with an account, and how we position against each one.
 *
 * Evidence rule: every partner link stores where it came from (a public URL
 * or an internal record id), the date, the excerpt and the method. Links and
 * scores derived by rules are marked inferred.
 */
import { z } from 'zod';

const Iso = z.string();

/** What the firm does for the client. */
export const PartnerRelationship = z.enum([
  'strategic_partner',
  'implementation',
  'managed_services',
  'audit',
  'advisory',
  'engineering',
]);
/** What the firm does for the client. */
export type PartnerRelationship = z.infer<typeof PartnerRelationship>;

/** Display label per relationship type. */
export const PARTNER_RELATIONSHIP_LABEL: Record<PartnerRelationship, string> = {
  strategic_partner: 'Strategic partner',
  implementation: 'Implementation',
  managed_services: 'Managed services',
  audit: 'Audit',
  advisory: 'Advisory',
  engineering: 'Engineering',
};

/** Where the firm works for the client. */
export const PartnerDomain = z.enum(['it', 'engineering', 'digital', 'data', 'sap', 'cloud', 'cyber', 'hema_pharma']);
/** Where the firm works for the client. */
export type PartnerDomain = z.infer<typeof PartnerDomain>;

/** Display label per domain. */
export const PARTNER_DOMAIN_LABEL: Record<PartnerDomain, string> = {
  it: 'IT',
  engineering: 'Engineering',
  digital: 'Digital',
  data: 'Data',
  sap: 'SAP',
  cloud: 'Cloud',
  cyber: 'Cyber',
  hema_pharma: 'HEMA / pharma',
};

/** Public sources are open web; internal sources are our own records. */
export const PartnerEvidenceOrigin = z.enum(['public', 'internal']);
/** Public or internal. */
export type PartnerEvidenceOrigin = z.infer<typeof PartnerEvidenceOrigin>;

/** Where one evidence item was read. */
export const PartnerEvidenceSource = z.enum([
  'gdelt',
  'google_news',
  'firm_site',
  'company_newsroom',
  'account_news',
  'meeting',
  'email',
  'activity',
  'note',
  'win_loss',
  'bid_intel',
  'competitor_insight',
  'fixture',
]);
/** Where one evidence item was read. */
export type PartnerEvidenceSource = z.infer<typeof PartnerEvidenceSource>;

/** Display label per evidence source. */
export const PARTNER_SOURCE_LABEL: Record<PartnerEvidenceSource, string> = {
  gdelt: 'GDELT news',
  google_news: 'Google News',
  firm_site: 'Firm website',
  company_newsroom: 'Company newsroom',
  account_news: 'Account news',
  meeting: 'Meeting note',
  email: 'Email',
  activity: 'Activity',
  note: 'Account note',
  win_loss: 'Win/loss record',
  bid_intel: 'Bid competitor field',
  competitor_insight: 'Competitor insight',
  fixture: 'Sample data',
};

/** Sources that are our own records (subject to record access). */
export const INTERNAL_PARTNER_SOURCES: readonly PartnerEvidenceSource[] = [
  'meeting',
  'email',
  'activity',
  'note',
  'win_loss',
  'bid_intel',
  'competitor_insight',
];

/** How the item was extracted. */
export const PartnerEvidenceMethod = z.enum(['keyword_match', 'record_field', 'llm_extract', 'fixture']);
/** How the item was extracted. */
export type PartnerEvidenceMethod = z.infer<typeof PartnerEvidenceMethod>;

/** Role of the firm in an internal record. */
export const PartnerContext = z.enum(['incumbent', 'competing', 'client_feedback', 'mention']);
/** Role of the firm in an internal record. */
export type PartnerContext = z.infer<typeof PartnerContext>;

/** Tone of the record towards the partner. */
export const PartnerSentiment = z.enum(['positive', 'neutral', 'negative']);
/** Tone of the record towards the partner. */
export type PartnerSentiment = z.infer<typeof PartnerSentiment>;

/** Dimensions a remark can speak to. */
export const RemarkDimension = z.enum(['quality', 'price', 'speed', 'domain']);
/** Dimensions a remark can speak to. */
export type RemarkDimension = z.infer<typeof RemarkDimension>;

/** Score card dimensions. */
export const PositioningDimension = z.enum(['quality', 'price', 'speed', 'domain', 'relationship']);
/** Score card dimensions. */
export type PositioningDimension = z.infer<typeof PositioningDimension>;

/** Display label per score card dimension. */
export const POSITIONING_DIMENSION_LABEL: Record<PositioningDimension, string> = {
  quality: 'Quality',
  price: 'Price',
  speed: 'Speed',
  domain: 'Domain depth',
  relationship: 'Relationship',
};

/** One quality, price, speed or domain remark read from a record. */
export const PartnerRemark = z.object({
  dimension: RemarkDimension,
  favours: z.enum(['us', 'partner', 'neutral']),
  phrase: z.string(),
});
/** One remark read from a record. */
export type PartnerRemark = z.infer<typeof PartnerRemark>;

/** One evidence item for a partner link. */
export const PartnerEvidence = z.object({
  id: z.string(),
  firmKey: z.string(),
  firmName: z.string(),
  origin: PartnerEvidenceOrigin,
  source: PartnerEvidenceSource,
  sourceLabel: z.string(),
  method: PartnerEvidenceMethod,
  /** The link was derived by rules rather than stated by the source. */
  inferred: z.boolean(),
  url: z.string().nullable(),
  recordType: z.string().nullable(),
  recordId: z.string().nullable(),
  /** App route to the internal record, never an external URL. */
  recordHref: z.string().nullable(),
  title: z.string().nullable(),
  excerpt: z.string(),
  date: Iso.nullable(),
  fetchedAt: Iso,
  relationship: PartnerRelationship.nullable(),
  domains: z.array(PartnerDomain),
  context: PartnerContext.nullable(),
  sentiment: PartnerSentiment.nullable(),
  remarks: z.array(PartnerRemark),
  outcome: z.enum(['won', 'lost']).nullable(),
  sample: z.boolean(),
});
/** One evidence item for a partner link. */
export type PartnerEvidence = z.infer<typeof PartnerEvidence>;

/** Us vs the partner on one dimension, or no evidence. */
export const DimensionScore = z.object({
  dimension: PositioningDimension,
  status: z.enum(['scored', 'no_evidence']),
  us: z.number().int().min(0).max(100).nullable(),
  partner: z.number().int().min(0).max(100).nullable(),
  evidenceCount: z.number().int().min(0),
  evidenceIds: z.array(z.string()),
});
/** Us vs the partner on one dimension. */
export type DimensionScore = z.infer<typeof DimensionScore>;

/** A one line positioning angle, always cited. */
export const PositioningAngle = z.object({
  text: z.string(),
  basis: z.enum(['observed', 'inferred']),
  evidenceIds: z.array(z.string()).min(1),
});
/** A one line positioning angle. */
export type PositioningAngle = z.infer<typeof PositioningAngle>;

/** One dot on the evidence timeline. */
export const PartnerTimelineItem = z.object({
  id: z.string(),
  date: Iso,
  origin: PartnerEvidenceOrigin,
  source: PartnerEvidenceSource,
  label: z.string(),
});
/** One dot on the evidence timeline. */
export type PartnerTimelineItem = z.infer<typeof PartnerTimelineItem>;

/** Everything the account page shows for one partner. */
export const ConsultingPartnerCard = z.object({
  firmKey: z.string(),
  name: z.string(),
  monogram: z.string(),
  website: z.string().nullable(),
  relationships: z.array(PartnerRelationship),
  domains: z.array(PartnerDomain),
  firstSeen: Iso.nullable(),
  lastSeen: Iso.nullable(),
  strength: z.object({
    level: z.enum(['strong', 'medium', 'weak']),
    score: z.number(),
    evidenceCount: z.number().int(),
  }),
  publicCount: z.number().int(),
  internalCount: z.number().int(),
  record: z.object({ wins: z.number().int(), losses: z.number().int(), firstYear: z.number().int().nullable(), lastYear: z.number().int().nullable() }),
  scorecard: z.array(DimensionScore),
  angles: z.array(PositioningAngle).max(3),
  timeline: z.array(PartnerTimelineItem),
  sample: z.boolean(),
});
/** Everything the account page shows for one partner. */
export type ConsultingPartnerCard = z.infer<typeof ConsultingPartnerCard>;

/** Status of the last partner scan for one account. */
export const PartnerRunStatus = z.object({
  status: z.enum(['never', 'queued', 'running', 'ok', 'partial', 'failed', 'not_configured']),
  lastFetchedAt: Iso.nullable(),
  result: z.object({ new: z.number().int(), updated: z.number().int(), skipped: z.number().int(), failed: z.number().int() }),
  detail: z.string().nullable(),
});
/** Status of the last partner scan. */
export type PartnerRunStatus = z.infer<typeof PartnerRunStatus>;

/** GET /companies/:id/consulting-partners */
export const ConsultingPartnersSummary = z.object({
  companyId: z.string(),
  partners: z.array(ConsultingPartnerCard),
  run: PartnerRunStatus,
  sample: z.boolean(),
});
/** GET /companies/:id/consulting-partners */
export type ConsultingPartnersSummary = z.infer<typeof ConsultingPartnersSummary>;

/** GET /companies/:id/consulting-partners/:partnerId/evidence query. */
export const PartnerEvidenceQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  origin: PartnerEvidenceOrigin.optional(),
});
/** Evidence page query. */
export type PartnerEvidenceQuery = z.infer<typeof PartnerEvidenceQuery>;

/** GET /companies/:id/consulting-partners/:partnerId/evidence */
export const PartnerEvidencePage = z.object({
  firmKey: z.string(),
  items: z.array(PartnerEvidence),
  nextCursor: z.string().nullable(),
});
/** One page of evidence. */
export type PartnerEvidencePage = z.infer<typeof PartnerEvidencePage>;

/** POST /companies/:id/consulting-partners/refresh */
export const ConsultingPartnersRefreshResponse = z.object({
  queued: z.boolean(),
  run: PartnerRunStatus,
});
/** Refresh response. */
export type ConsultingPartnersRefreshResponse = z.infer<typeof ConsultingPartnersRefreshResponse>;

/** Firm key as used in routes: lower case slug. */
export const FirmKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
