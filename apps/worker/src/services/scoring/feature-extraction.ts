/**
 * Predictive scoring — feature extraction layer.
 *
 * WHY pure functions with injected Prisma: makes unit testing trivial
 * without a database connection. The caller (trainer + scoring service)
 * passes the Prisma client instance.
 *
 * WHY no PII in feature vectors: model artifacts must be safe to store
 * and share across debugging sessions. Names, emails, phone numbers are
 * never included — only derived numeric signals.
 *
 * Feature vector encoding:
 *   - Categorical → one-hot (sparse booleans as numbers 0/1)
 *   - Continuous  → raw numeric, caller normalises during training
 *   - Missing     → 0 (safe default; model learns to ignore absent features)
 */

import { prisma as defaultPrisma } from '@bidstack/db';

// ─── Types ────────────────────────────────────────────────────────────────

export interface FeatureVector {
  /** Ordered feature names — must match exactly between training and inference. */
  names: string[];
  /** Parallel values array — no PII. */
  values: number[];
}

/** Closed lead used as training sample. */
export interface LabeledLead {
  leadId: string;
  features: FeatureVector;
  /** 1 = converted to opp, 0 = disqualified/lost */
  label: 0 | 1;
}

/** Closed opportunity used as training sample. */
export interface LabeledOpportunity {
  opportunityId: string;
  features: FeatureVector;
  /** 1 = WON, 0 = LOST */
  label: 0 | 1;
}

// ─── Constants ───────────────────────────────────────────────────────────

/** Lead sources that get their own one-hot dimension. */
const LEAD_SOURCES = [
  'website',
  'referral',
  'event',
  'cold_outreach',
  'partner',
  'social',
  'other',
] as const;

/** Industries that get their own one-hot dimension (Top-7 + "other"). */
const INDUSTRIES = [
  'technology',
  'finance',
  'healthcare',
  'manufacturing',
  'retail',
  'consulting',
  'education',
] as const;

/** Seniority keyword maps — first match wins. */
const EXEC_KEYWORDS = ['ceo', 'cto', 'cfo', 'coo', 'president', 'chief', 'founder', 'partner'];
const SENIOR_KEYWORDS = ['vp', 'vice president', 'director', 'head of', 'principal'];
const MID_KEYWORDS = ['manager', 'lead', 'senior', 'sr.', 'staff'];
// junior = fallthrough

// ─── Utility helpers ─────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

function daysSince(d: Date | null | undefined, now = new Date()): number {
  if (!d) return 999;
  return daysBetween(d, now);
}

/** Encode title into seniority bucket: exec=3, senior=2, mid=1, junior=0. */
function titleSeniority(title: string | null | undefined): number {
  if (!title) return 0;
  const lower = title.toLowerCase();
  if (EXEC_KEYWORDS.some((kw) => lower.includes(kw))) return 3;
  if (SENIOR_KEYWORDS.some((kw) => lower.includes(kw))) return 2;
  if (MID_KEYWORDS.some((kw) => lower.includes(kw))) return 1;
  return 0;
}

/**
 * Company size → numeric bucket.
 *   1–10 → 1, 11–50 → 2, 51–200 → 3, 201–500 → 4, 501–2000 → 5, 2001+ → 6
 */
function companySizeBucket(size: string | null | undefined): number {
  if (!size) return 0;
  const n = Number(size.replace(/[^0-9]/g, ''));
  if (isNaN(n)) return 0;
  if (n <= 10) return 1;
  if (n <= 50) return 2;
  if (n <= 200) return 3;
  if (n <= 500) return 4;
  if (n <= 2000) return 5;
  return 6;
}

/**
 * Email domain → rough age proxy bucket.
 * WHY bucketed not exact: we don't do live WHOIS lookups; instead we map
 * well-known domain roots to an age class. Unknown → 2 (neutral).
 *   1 = very new (<3y) — disposable/startup signals
 *   2 = medium  (3-15y)
 *   3 = established (>15y) — enterprise signals
 */
const ESTABLISHED_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com',
  'microsoft.com', 'google.com', 'apple.com', 'amazon.com',
  'salesforce.com', 'oracle.com', 'ibm.com', 'sap.com',
]);
const NEW_DOMAIN_TLDS = ['.io', '.ai', '.xyz', '.app', '.dev'];

function emailDomainAgeBucket(email: string | null | undefined): number {
  if (!email) return 2;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (ESTABLISHED_DOMAINS.has(domain)) return 3;
  if (NEW_DOMAIN_TLDS.some((tld) => domain.endsWith(tld))) return 1;
  return 2;
}

// ─── Lead feature extraction ──────────────────────────────────────────────

/**
 * Extracts a fixed-width feature vector for a single lead.
 * Returns null if the lead is not found or doesn't belong to the org.
 */
export async function extractLeadFeatures(
  leadId: string,
  orgId: string,
  db = defaultPrisma,
): Promise<FeatureVector | null> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const lead = await db.lead.findFirst({
    where: { id: leadId, orgId, deletedAt: null },
    select: {
      source: true,
      title: true,
      email: true,
      intel: true,
      createdAt: true,
      updatedAt: true,
      convertedToOpportunityId: true,
    },
  });

  if (!lead) return null;

  // Industry + company size come from the linked company or from intel blob
  const intel = (lead.intel ?? {}) as Record<string, unknown>;
  const industry = ((intel.industry as string) ?? '').toLowerCase();
  const companySize = (intel.companySize as string | undefined) ?? null;

  // Engagement: activities on this lead in last 30d
  const activities = await db.activity.findMany({
    where: {
      orgId,
      entityType: 'lead',
      entityId: leadId,
      occurredAt: { gte: thirtyDaysAgo },
    },
    select: { type: true, occurredAt: true },
  });

  const engagementCount = activities.length;
  const lastActivityDate =
    activities.length > 0
      ? activities.reduce((latest, a) =>
          a.occurredAt > latest.occurredAt ? a : latest,
        ).occurredAt
      : null;

  // ── Build vector ───────────────────────────────────────────────────────
  const names: string[] = [];
  const values: number[] = [];

  const push = (name: string, value: number) => {
    names.push(name);
    values.push(value);
  };

  // Source one-hot (7 dims)
  for (const src of LEAD_SOURCES) {
    push(`source_${src}`, lead.source === src ? 1 : 0);
  }

  // Industry one-hot (7 dims)
  for (const ind of INDUSTRIES) {
    push(`industry_${ind}`, industry.includes(ind) ? 1 : 0);
  }

  // Company size bucket (1 dim)
  push('company_size_bucket', companySizeBucket(companySize));

  // Job title seniority (1 dim)
  push('title_seniority', titleSeniority(lead.title));

  // Email domain age bucket (1 dim)
  push('email_domain_age_bucket', emailDomainAgeBucket(lead.email));

  // Engagement features (2 dims)
  push('engagement_count_30d', engagementCount);
  push('activity_recency_days', daysSince(lastActivityDate, now));

  // Lead age (1 dim)
  push('lead_age_days', daysSince(lead.createdAt, now));

  // Has company (1 dim) — from intel
  push('has_company_data', intel.companyName ? 1 : 0);

  // BANT fields from intel (4 dims) — 1=confirmed, 0.5=likely, 0=unknown/none
  const bantMap: Record<string, number> = { confirmed: 1, likely: 0.5, unknown: 0, none: 0 };
  for (const field of ['budget', 'authority', 'need', 'timeline'] as const) {
    const val = (intel[field] as string | undefined) ?? 'unknown';
    push(`bant_${field}`, bantMap[val] ?? 0);
  }

  return { names, values };
}

// ─── Opportunity feature extraction ──────────────────────────────────────

/**
 * Extracts a fixed-width feature vector for a single opportunity.
 * Returns null if not found or not owned by org.
 */
export async function extractOpportunityFeatures(
  opportunityId: string,
  orgId: string,
  db = defaultPrisma,
): Promise<FeatureVector | null> {
  const now = new Date();

  const opp = await db.opportunity.findFirst({
    where: { id: opportunityId, orgId, deletedAt: null },
    select: {
      valueMicros: true,
      stage: true,
      probability: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
      ownerId: true,
      pipelineStage: {
        select: { name: true, probability: true, isWon: true, isLost: true },
      },
      _count: { select: { contactLinks: true } },
      intel: true,
    },
  });

  if (!opp) return null;

  // Activities on this opportunity
  const allActivities = await db.activity.findMany({
    where: { orgId, entityType: 'opportunity', entityId: opportunityId },
    select: { type: true, occurredAt: true },
    orderBy: { occurredAt: 'desc' },
  });

  const meetings = allActivities.filter((a) => a.type === 'meeting');
  const emails = allActivities.filter(
    (a) => a.type === 'email' || a.type === 'email_opened' || a.type === 'email_clicked',
  );
  const lastActivity = allActivities[0] ?? null;

  // Stage change activities to compute days_in_current_stage
  const stageChanges = allActivities
    .filter((a) => a.type === 'stage_change')
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const lastStageChangeDate = stageChanges[0]?.occurredAt ?? opp.createdAt;

  // Owner win rate last 90d (closed won / total closed)
  let ownerCloseRate = 0.5; // neutral default
  if (opp.ownerId) {
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
    const [won, lost] = await Promise.all([
      db.opportunity.count({
        where: {
          orgId,
          ownerId: opp.ownerId,
          deletedAt: null,
          updatedAt: { gte: ninetyDaysAgo },
          pipelineStage: { isWon: true },
        },
      }),
      db.opportunity.count({
        where: {
          orgId,
          ownerId: opp.ownerId,
          deletedAt: null,
          updatedAt: { gte: ninetyDaysAgo },
          pipelineStage: { isLost: true },
        },
      }),
    ]);
    const total = won + lost;
    ownerCloseRate = total > 0 ? won / total : 0.5;
  }

  // Qualification score from intel blob (may be set by W8-4)
  const intel = (opp.intel ?? {}) as Record<string, unknown>;
  const qualScore = typeof intel.qualificationScore === 'number' ? intel.qualificationScore : 50;

  // ── Build vector ───────────────────────────────────────────────────────
  const names: string[] = [];
  const values: number[] = [];

  const push = (name: string, value: number) => {
    names.push(name);
    values.push(value);
  };

  // Deal value (log-scale to reduce skew)
  const valueMicros = Number(opp.valueMicros);
  push('log_value_micros', valueMicros > 0 ? Math.log10(valueMicros) : 0);

  // Stage probability from pipeline (if set)
  push('stage_probability', Number(opp.pipelineStage?.probability ?? opp.probability) / 100);

  // Time-based features
  push('days_in_current_stage', daysBetween(lastStageChangeDate, now));
  push('total_age_days', daysBetween(opp.createdAt, now));
  push('days_to_expected_close', opp.dueDate ? daysBetween(opp.dueDate, now) : 365);

  // Relationship features
  push('num_contacts_on_account', opp._count.contactLinks);
  push('num_meetings_held', meetings.length);
  push('num_emails_sent_received', emails.length);
  push('last_activity_days_ago', daysSince(lastActivity?.occurredAt ?? null, now));

  // Owner performance
  push('owner_close_rate_last_90d', ownerCloseRate);

  // Qualification score (0-100 → 0-1)
  push('qualification_score_norm', qualScore / 100);

  // Is won / is lost (these are present in historical training only)
  push('is_won', opp.pipelineStage?.isWon ? 1 : 0);
  push('is_lost', opp.pipelineStage?.isLost ? 1 : 0);

  return { names, values };
}
