/**
 * Feature extraction — API copy.
 *
 * WHY this file exists alongside apps/worker/src/services/scoring/feature-extraction.ts:
 *   The API needs to run inference (scoring on GET requests) without depending
 *   on the worker package. Duplicating the pure feature-extraction functions
 *   (no BullMQ, no S3) keeps the API self-contained.
 *
 *   The worker's copy is authoritative for training. If feature definitions
 *   diverge, scoring will silently degrade — keep these in sync manually or
 *   extract to @bidstack/shared in a future refactor.
 *
 * No PII is included in feature vectors — only derived numeric signals.
 */

import { prisma as defaultPrisma } from '@bidstack/db';

// ─── Types ────────────────────────────────────────────────────────────────

export interface FeatureVector {
  names: string[];
  values: number[];
}

// ─── Constants ───────────────────────────────────────────────────────────

const LEAD_SOURCES = [
  'website', 'referral', 'event', 'cold_outreach', 'partner', 'social', 'other',
] as const;

const INDUSTRIES = [
  'technology', 'finance', 'healthcare', 'manufacturing', 'retail', 'consulting', 'education',
] as const;

const EXEC_KEYWORDS = ['ceo', 'cto', 'cfo', 'coo', 'president', 'chief', 'founder', 'partner'];
const SENIOR_KEYWORDS = ['vp', 'vice president', 'director', 'head of', 'principal'];
const MID_KEYWORDS = ['manager', 'lead', 'senior', 'sr.', 'staff'];

// ─── Helpers ─────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

function daysSince(d: Date | null | undefined, now = new Date()): number {
  if (!d) return 999;
  return daysBetween(d, now);
}

function titleSeniority(title: string | null | undefined): number {
  if (!title) return 0;
  const lower = title.toLowerCase();
  if (EXEC_KEYWORDS.some((kw) => lower.includes(kw))) return 3;
  if (SENIOR_KEYWORDS.some((kw) => lower.includes(kw))) return 2;
  if (MID_KEYWORDS.some((kw) => lower.includes(kw))) return 1;
  return 0;
}

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
    },
  });

  if (!lead) return null;

  const intel = (lead.intel ?? {}) as Record<string, unknown>;
  const industry = ((intel.industry as string) ?? '').toLowerCase();
  const companySize = (intel.companySize as string | undefined) ?? null;

  const activities = await db.activity.findMany({
    where: { orgId, entityType: 'lead', entityId: leadId, occurredAt: { gte: thirtyDaysAgo } },
    select: { type: true, occurredAt: true },
  });

  const engagementCount = activities.length;
  const lastActivityDate = activities.length > 0
    ? activities.reduce((latest, a) => a.occurredAt > latest.occurredAt ? a : latest).occurredAt
    : null;

  const names: string[] = [];
  const values: number[] = [];
  const push = (name: string, value: number) => { names.push(name); values.push(value); };

  for (const src of LEAD_SOURCES) push(`source_${src}`, lead.source === src ? 1 : 0);
  for (const ind of INDUSTRIES) push(`industry_${ind}`, industry.includes(ind) ? 1 : 0);
  push('company_size_bucket', companySizeBucket(companySize));
  push('title_seniority', titleSeniority(lead.title));
  push('email_domain_age_bucket', emailDomainAgeBucket(lead.email));
  push('engagement_count_30d', engagementCount);
  push('activity_recency_days', daysSince(lastActivityDate, now));
  push('lead_age_days', daysSince(lead.createdAt, now));
  push('has_company_data', intel.companyName ? 1 : 0);

  const bantMap: Record<string, number> = { confirmed: 1, likely: 0.5, unknown: 0, none: 0 };
  for (const field of ['budget', 'authority', 'need', 'timeline'] as const) {
    const val = (intel[field] as string | undefined) ?? 'unknown';
    push(`bant_${field}`, bantMap[val] ?? 0);
  }

  return { names, values };
}

// ─── Opportunity feature extraction ──────────────────────────────────────

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
      probability: true,
      dueDate: true,
      createdAt: true,
      ownerId: true,
      pipelineStage: { select: { probability: true, isWon: true, isLost: true } },
      _count: { select: { contacts: true } },
      intel: true,
    },
  });

  if (!opp) return null;

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
  const stageChanges = allActivities
    .filter((a) => a.type === 'stage_change')
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const lastStageChangeDate = stageChanges[0]?.occurredAt ?? opp.createdAt;

  let ownerCloseRate = 0.5;
  if (opp.ownerId) {
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
    const [won, lost] = await Promise.all([
      db.opportunity.count({
        where: {
          orgId, ownerId: opp.ownerId, deletedAt: null,
          updatedAt: { gte: ninetyDaysAgo }, pipelineStage: { isWon: true },
        },
      }),
      db.opportunity.count({
        where: {
          orgId, ownerId: opp.ownerId, deletedAt: null,
          updatedAt: { gte: ninetyDaysAgo }, pipelineStage: { isLost: true },
        },
      }),
    ]);
    const total = won + lost;
    ownerCloseRate = total > 0 ? won / total : 0.5;
  }

  const intel = (opp.intel ?? {}) as Record<string, unknown>;
  const qualScore = typeof intel.qualificationScore === 'number' ? intel.qualificationScore : 50;

  const names: string[] = [];
  const values: number[] = [];
  const push = (name: string, value: number) => { names.push(name); values.push(value); };

  const valueMicros = Number(opp.valueMicros);
  push('log_value_micros', valueMicros > 0 ? Math.log10(valueMicros) : 0);
  push('stage_probability', (opp.pipelineStage?.probability ?? opp.probability) / 100);
  push('days_in_current_stage', daysBetween(lastStageChangeDate, now));
  push('total_age_days', daysBetween(opp.createdAt, now));
  push('days_to_expected_close', opp.dueDate ? daysBetween(opp.dueDate, now) : 365);
  push('num_contacts_on_account', opp._count.contacts);
  push('num_meetings_held', meetings.length);
  push('num_emails_sent_received', emails.length);
  push('last_activity_days_ago', daysSince(lastActivity?.occurredAt ?? null, now));
  push('owner_close_rate_last_90d', ownerCloseRate);
  push('qualification_score_norm', qualScore / 100);
  push('is_won', opp.pipelineStage?.isWon ? 1 : 0);
  push('is_lost', opp.pipelineStage?.isLost ? 1 : 0);

  return { names, values };
}
