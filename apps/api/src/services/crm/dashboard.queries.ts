/**
 * dashboard.queries.ts — Prisma query wrappers and row serializers for the
 * CRM dashboard pipeline.
 *
 * WHY a separate module: all code that touches PrismaClient lives here.
 * The rest of the dashboard pipeline is pure-transform and can be tested
 * without a DB connection. Queries are always org-scoped (WHERE orgId = ?)
 * per the multi-tenancy contract.
 */
import { type z } from 'zod';

import { OpportunityStage, Prisma, type PrismaClient } from '@bidstack/db';
import type {
  CrmCompany,
  CrmDeal,
  DashboardWidget,
  AccountCockpitSnapshot,
  ProviderHealth,
  QueueHealth,
  ReleaseScore,
} from '@bidstack/shared';

import { buildCompanies } from './company-enrichment.service.js';
import {
  buildCockpit,
  COCKPIT_CONTACT_PAGE,
  COCKPIT_OPP_PAGE,
  COCKPIT_TASK_PAGE,
  microsText,
  type AccountPerformance,
} from './dashboard.cockpit.js';
import { defaultReleaseScore } from './dashboard.defaults.js';
import { asProviderStatus, normalizeName, record, recordedDealStage } from './dashboard.utils.js';
import {
  applyOpportunityScope,
  countryVariantsForScope,
  type AccessScope,
} from '../../lib/access-scope.js';
import { canReadAccount } from '../../lib/account-access.js';
import { excludeClosedOutcome } from '../../routes/opportunities.helpers.js';

// ─── Row serializers ──────────────────────────────────────────────────────────

export function serializeDeal(opportunity: {
  id: string;
  customer: string;
  companyId?: string | null;
  name: string;
  stage: string;
  pipelineStage: {
    key: string;
    name: string;
    probability: number | unknown;
    color: string | null;
    isWon: boolean;
    isLost: boolean;
    deletedAt?: Date | null;
  } | null;
  valueMicros: bigint | number | unknown;
  probability: number;
  dueDate: Date | null;
  ownerId: string | null;
  owner: { name: string | null; email: string } | null;
  updatedAt: Date;
  /** Opportunity has no currency column. Callers must not invent one. */
  currencyCode?: string | null;
}): z.infer<typeof CrmDeal> {
  const recorded = opportunity.currencyCode?.trim();
  const liveStage = opportunity.pipelineStage?.deletedAt ? null : opportunity.pipelineStage;
  return {
    id: opportunity.id,
    source: 'external_crm',
    companyId: opportunity.companyId ?? null,
    companyName: opportunity.customer,
    name: opportunity.name,
    stage: recordedDealStage(opportunity),
    stageName: liveStage?.name ?? null,
    amountMicros: microsText(
      typeof opportunity.valueMicros === 'bigint' || typeof opportunity.valueMicros === 'number'
        ? opportunity.valueMicros
        : null,
    ),
    currencyCode: recorded && recorded.length === 3 ? recorded : null,
    // A blank probability is stored as 0. That is not a measured win chance.
    probability: opportunity.probability === 0 ? null : opportunity.probability,
    closeDate: opportunity.dueDate ? opportunity.dueDate.toISOString().slice(0, 10) : null,
    ownerId: opportunity.ownerId,
    ownerName: opportunity.owner?.name ?? opportunity.owner?.email ?? null,
    updatedAt: opportunity.updatedAt.toISOString(),
  };
}

export function serializeWidget(widget: {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: unknown;
}): z.infer<typeof DashboardWidget> {
  return {
    id: widget.id,
    kind: widget.kind as z.infer<typeof DashboardWidget>['kind'],
    title: widget.title,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    config: record(widget.config),
  };
}

export function serializeProviderHealth(row: {
  provider: string;
  status: string;
  latencyMs: number | null;
  lastCheckedAt: Date;
  message: string | null;
}): z.infer<typeof ProviderHealth> {
  return {
    provider: row.provider,
    status: asProviderStatus(row.status),
    latencyMs: row.latencyMs,
    lastCheckedAt: row.lastCheckedAt.toISOString(),
    message: row.message,
  };
}

export function serializeQueueHealth(row: {
  queueName: string;
  waiting: number;
  active: number;
  failed: number;
  completed: number;
  lastCheckedAt: Date;
}): QueueHealth {
  return {
    queueName: row.queueName,
    waiting: row.waiting,
    active: row.active,
    failed: row.failed,
    completed: row.completed,
    lastCheckedAt: row.lastCheckedAt.toISOString(),
  };
}

export function serializeReleaseScore(row: {
  functional: number;
  code: number;
  design: number;
  infra: number;
  scoredAt: Date;
}): z.infer<typeof ReleaseScore> {
  const total = row.functional + row.code + row.design + row.infra;
  return {
    functional: row.functional,
    code: row.code,
    design: row.design,
    infra: row.infra,
    total,
    passed: total >= 95,
    scoredAt: row.scoredAt.toISOString(),
  };
}

// ─── Lean release-score query ──────────────────────────────────────────────────

/**
 * Fetch ONLY the latest release score for an org.
 *
 * WHY: GET /crm/release-score previously built the full 12-query dashboard
 * snapshot just to read this one org-wide row. The score is scope-independent,
 * so this runs the single findFirst that buildDashboardSnapshot already uses and
 * reuses its exact serializer/fallback — the response shape stays identical.
 */
export async function getReleaseScore(
  orgId: string,
  prisma: PrismaClient,
): Promise<z.infer<typeof ReleaseScore>> {
  const row = await prisma.releaseScore.findFirst({
    where: { orgId },
    select: {
      functional: true,
      code: true,
      design: true,
      infra: true,
      scoredAt: true,
    },
    orderBy: { scoredAt: 'desc' },
  });
  return row ? serializeReleaseScore(row) : defaultReleaseScore();
}

// ─── Lean company query ────────────────────────────────────────────────────────

/** Fetch all CrmCompany objects for an org without loading the full dashboard. */
// Single source of truth for the enrichment columns buildCompanies needs, so
// the list builder and the single-company resolver stay in lockstep.
const ENRICHMENT_SELECT = {
  id: true,
  tradeName: true,
  legalName: true,
  domain: true,
  website: true,
  industryCodes: true,
  providerMetadata: true,
  employeeCount: true,
  annualRevenueMicros: true,
  status: true,
  registryIds: true,
  formerNames: true,
  incorporationDate: true,
  logoUrl: true,
  logoSource: true,
  confidenceBps: true,
  sourceAttribution: true,
  updatedAt: true,
} satisfies Prisma.CompanyEnrichmentSelect;

const OPP_COMPANY_SELECT = {
  customer: true,
  industry: true,
  logoUrl: true,
  updatedAt: true,
} satisfies Prisma.OpportunitySelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getCompaniesOnly(
  orgId: string,
  prisma: PrismaClient,
  scope?: AccessScope,
): Promise<Array<z.infer<typeof CrmCompany>>> {
  const opportunityWhere = scope ? applyOpportunityScope({ orgId }, scope) : { orgId };
  const [opportunities, enrichments] = await Promise.all([
    prisma.opportunity.findMany({
      where: opportunityWhere,
      select: OPP_COMPANY_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
    prisma.companyEnrichment.findMany({
      where: { orgId },
      select: ENRICHMENT_SELECT,
      take: 500,
    }),
  ]);
  const visibleCompanyKeys =
    scope && !scope.unrestricted
      ? new Set(opportunities.map((opportunity) => normalizeName(opportunity.customer)))
      : null;
  return buildCompanies(opportunities, enrichments).filter(
    (company) => !visibleCompanyKeys || visibleCompanyKeys.has(normalizeName(company.name)),
  );
}

/**
 * Resolve a SINGLE company for the cockpit without loading the whole org.
 *
 * `companyId` is either an enrichment UUID or a normalized account key (the id
 * buildCompanies assigns opportunity-only companies). The previous cockpit path
 * loaded the org's top 200 opps + 500 enrichments and `.find()`-ed one — which
 * both scaled O(n) per request AND silently 404'd any company outside that
 * window. This resolves enrichment-backed companies by their unique
 * (orgId, id|normalizedName) index, falling back to a bounded distinct-customer
 * scan only for opportunity-only companies.
 */
export async function resolveCockpitCompany(
  orgId: string,
  companyId: string,
  prisma: PrismaClient,
): Promise<z.infer<typeof CrmCompany> | null> {
  const isUuid = UUID_RE.test(companyId);
  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { orgId, deletedAt: null, ...(isUuid ? { id: companyId } : { normalizedName: companyId }) },
    select: ENRICHMENT_SELECT,
  });
  if (enrichment) return buildCompanies([], [enrichment])[0] ?? null;
  if (isUuid) {
    // A UUID that isn't an enrichment may be a Company-table row (manual / key /
    // top account). Resolve it so the cockpit doesn't 404; merge its by-name
    // enrichment for richer fields, then stamp the authoritative id/domain.
    const company = await prisma.company.findFirst({
      where: { orgId, deletedAt: null, id: companyId },
      select: { id: true, name: true, domain: true, logoUrl: true, legalName: true },
    });
    if (!company) return null;
    const byNameEnrichment = await prisma.companyEnrichment.findFirst({
      where: { orgId, deletedAt: null, normalizedName: normalizeName(company.name) },
      select: ENRICHMENT_SELECT,
    });
    const list = byNameEnrichment
      ? buildCompanies([], [byNameEnrichment], [company])
      : buildCompanies(
          [{ customer: company.name, industry: null, logoUrl: company.logoUrl, updatedAt: new Date() }],
          [],
          [company],
        );
    const resolved = list[0];
    if (resolved) {
      resolved.id = company.id;
      if (company.domain) resolved.domain = company.domain;
    }
    return resolved ?? null;
  }
  // Opportunity-only company: no normalized column to index on, so match within
  // a bounded set of distinct customers (kept under the dev query-guard's 1000
  // cap; ~5x the old 200 window).
  const opportunities = await prisma.opportunity.findMany({
    where: { orgId },
    select: OPP_COMPANY_SELECT,
    orderBy: { updatedAt: 'desc' },
    distinct: ['customer'],
    take: 1000,
  });
  return buildCompanies(opportunities, []).find((c) => c.id === companyId) ?? null;
}

// ─── Per-company cockpit query ────────────────────────────────────────────────

/**
 * Lean per-company cockpit builder for GET /crm/companies/:id.
 *
 * WHY: The original handler called buildDashboardSnapshot (12 parallel queries,
 * ~1 000 rows) just to look up one company. This builds the same
 * AccountCockpitSnapshot using 7 targeted queries — it skips widgets,
 * bidOpportunities, insights, providers, queues, and releaseScore entirely,
 * and scopes opportunities, contacts, and tasks to the requested company.
 *
 * Returns null when the company cannot be found (caller should throw 404).
 */
export const ISSUE_PAGE = 50;
const RISK_OPEN = ['open', 'in_progress'] as const;
const COMPLIANCE_OPEN = ['blocked', 'in_progress', 'not_started'] as const;

/** Open rows first, so a page of closed items cannot hide an open one. */
export async function loadRegisterPage<T, W extends Record<string, unknown>>(
  find: (where: W, take: number) => Promise<T[]>,
  count: (where: W) => Promise<number>,
  where: W,
  openStatuses: readonly string[],
): Promise<{ rows: T[]; openCount: number; capped: boolean }> {
  const openWhere = { ...where, status: { in: [...openStatuses] } } as W;
  const openRows = await find(openWhere, ISSUE_PAGE);
  const openCount = openRows.length < ISSUE_PAGE ? openRows.length : await count(openWhere);
  let rows = openRows;
  if (openCount <= ISSUE_PAGE && rows.length < ISSUE_PAGE) {
    const restWhere = { ...where, status: { notIn: [...openStatuses] } } as W;
    rows = [...rows, ...(await find(restWhere, ISSUE_PAGE - rows.length))];
  }
  const capped =
    openCount > ISSUE_PAGE ||
    (rows.length === ISSUE_PAGE && (await count(where)) > ISSUE_PAGE);
  return { rows, openCount, capped };
}

const riskSelect = {
  id: true,
  opportunityId: true,
  title: true,
  severity: true,
  owner: true,
  mitigation: true,
  dueDate: true,
  status: true,
  companyName: true,
} as const;

const complianceSelect = {
  id: true,
  opportunityId: true,
  label: true,
  status: true,
  owner: true,
  sourceAttribution: true,
} as const;

export function loadAccountRisks(
  prismaClient: PrismaClient,
  where: { orgId: string; deletedAt: null; opportunityId: { in: string[] } },
) {
  return loadRegisterPage(
    (pageWhere, take) =>
      prismaClient.riskRegisterItem.findMany({
        where: pageWhere,
        select: riskSelect,
        orderBy: { updatedAt: 'desc' },
        take,
      }),
    (pageWhere) => prismaClient.riskRegisterItem.count({ where: pageWhere }),
    where,
    RISK_OPEN,
  );
}

export function loadAccountCompliance(
  prismaClient: PrismaClient,
  where: { orgId: string; deletedAt: null; opportunityId: { in: string[] } },
) {
  return loadRegisterPage(
    (pageWhere, take) =>
      prismaClient.complianceCheck.findMany({
        where: pageWhere,
        select: complianceSelect,
        orderBy: { updatedAt: 'desc' },
        take,
      }),
    (pageWhere) => prismaClient.complianceCheck.count({ where: pageWhere }),
    where,
    COMPLIANCE_OPEN,
  );
}

export async function buildCompanyCockpit(
  orgId: string,
  companyId: string,
  prismaClient: PrismaClient,
  scope?: AccessScope,
): Promise<z.infer<typeof AccountCockpitSnapshot> | null> {
  // Step 1: resolve the single company by indexed lookup (was a full-org scan
  // that also capped visibility at the top 200 opps / 500 enrichments).
  const company = await resolveCockpitCompany(orgId, companyId, prismaClient);
  if (!company) return null;
  if (scope) {
    const access = await canReadAccount({
      orgId,
      userId: scope.userId,
      accountId: companyId,
      accountName: company.name,
      scope,
      prismaClient,
    });
    if (!access.allowed) return null;
  }

  const opportunityWhere = scope
    ? applyOpportunityScope({ orgId, companyId: company.id, deletedAt: null }, scope)
    : { orgId, companyId: company.id, deletedAt: null };
  const taskOpportunityWhere = scope
    ? applyOpportunityScope({ companyId: company.id, deletedAt: null }, scope)
    : { companyId: company.id, deletedAt: null };

  // Step 2: load company-specific data in parallel (filtered by company)
  const [opportunities, contacts, tasks, performance, fieldOverrides] = await Promise.all([
      prismaClient.opportunity.findMany({
        where: opportunityWhere,
        select: {
          id: true,
          customer: true,
          companyId: true,
          name: true,
          stage: true,
          valueMicros: true,
          probability: true,
          dueDate: true,
          owner: { select: { name: true, email: true } },
          pipelineStage: {
            select: {
              key: true,
              name: true,
              probability: true,
              color: true,
              isWon: true,
              isLost: true,
              deletedAt: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: COCKPIT_OPP_PAGE,
      }),
      prismaClient.contact.findMany({
        where: { orgId, companyId, deletedAt: null },
        select: {
          id: true,
          customer: true,
          companyId: true,
          name: true,
          role: true,
          email: true,
          phone: true,
          influence: true,
          createdAt: true,
        },
        orderBy: [{ influence: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
        take: COCKPIT_CONTACT_PAGE,
      }),
      prismaClient.task.findMany({
        where: {
          orgId,
          deletedAt: null,
          OR: [{ accountId: company.id }, { opportunity: taskOpportunityWhere }],
        },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          dueDate: true,
          accountId: true,
          opportunity: { select: { id: true, customer: true, companyId: true, name: true } },
          assignee: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: COCKPIT_TASK_PAGE,
      }),
      fetchAccountPerformance(orgId, company.id, prismaClient, scope),
      // WHY: folded into the Promise.all (was a 7th serial query after it) so the
      // cockpit's per-company reads all run in parallel. company.name is already
      // resolved above. Mirrors the shipped pattern in dashboard.service.ts.
      prismaClient.companyFieldOverride.findMany({
        where: { orgId, companyKey: normalizeName(company.name) },
        select: { fieldKey: true, value: true },
        take: 10,
      }),
    ]);

  const taskWhere = {
    orgId,
    deletedAt: null,
    OR: [{ accountId: company.id }, { opportunity: taskOpportunityWhere }],
  };
  const [dealsCapped, contactsCapped, tasksCapped, openDealCount, roleHolders] = await Promise.all([
    opportunities.length < COCKPIT_OPP_PAGE
      ? Promise.resolve(false)
      : prismaClient.opportunity.count({ where: opportunityWhere }).then((total) => total > COCKPIT_OPP_PAGE),
    contacts.length < COCKPIT_CONTACT_PAGE
      ? Promise.resolve(false)
      : prismaClient.contact.count({ where: { orgId, companyId, deletedAt: null } }).then((total) => total > COCKPIT_CONTACT_PAGE),
    tasks.length < COCKPIT_TASK_PAGE
      ? Promise.resolve(false)
      : prismaClient.task.count({ where: taskWhere }).then((total) => total > COCKPIT_TASK_PAGE),
    opportunities.length < COCKPIT_OPP_PAGE
      ? Promise.resolve(undefined)
      : (async () => {
          const total = await prismaClient.opportunity.count({ where: opportunityWhere });
          if (total <= COCKPIT_OPP_PAGE) return undefined;
          const { NOT } = excludeClosedOutcome();
          return prismaClient.opportunity.count({
            where: {
              ...opportunityWhere,
              stage: { notIn: ['closed_won', 'closed_lost', 'customer'] },
              NOT,
            },
          });
        })(),
    includeBuyingRoleContacts(orgId, company.id, contacts, prismaClient),
  ]);
  const cockpitContacts = [...contacts, ...roleHolders.extra];

  const accountOpportunityIds = opportunities.map((opportunity) => opportunity.id);
  const contactIds = cockpitContacts.map((contact) => contact.id);
  const registerWhere = { orgId, deletedAt: null as null, opportunityId: { in: accountOpportunityIds } };
  const [riskPage, compliancePage, buyingRoleFacts] = await Promise.all([
    accountOpportunityIds.length === 0
      ? { rows: [], openCount: 0, capped: false }
      : loadAccountRisks(prismaClient, registerWhere),
    accountOpportunityIds.length === 0
      ? { rows: [], openCount: 0, capped: false }
      : loadAccountCompliance(prismaClient, registerWhere),
    fetchBuyingRoleFacts(orgId, contactIds, prismaClient, company.id),
  ]);

  return buildCockpit({
    company,
    // buildCockpit's type accepts the company list but never reads it; pass the
    // resolved company alone rather than re-loading the whole org.
    companies: [company],
    opportunities,
    contacts: cockpitContacts,
    tasks,
    risks: riskPage.rows,
    compliance: compliancePage.rows,
    openRiskCount: riskPage.openCount,
    openComplianceCount: compliancePage.openCount,
    risksCapped: riskPage.capped,
    complianceCapped: compliancePage.capped,
    buyingRoleFacts: buyingRoleFacts.rows,
    buyingRolesCapped: buyingRoleFacts.capped,
    fieldOverrides,
    winLossAvailable: process.env.WIN_LOSS_DATA_AVAILABLE === 'true',
    performance,
    coveragePages: {
      contactsCapped: contactsCapped || roleHolders.roleHoldersCapped,
      dealsCapped,
      tasksCapped,
    },
    openDealCount,
  });
}

export const BUYING_ROLE_PAGE = 200;

const cockpitContactSelect = {
  id: true,
  customer: true,
  companyId: true,
  name: true,
  role: true,
  email: true,
  phone: true,
  influence: true,
  createdAt: true,
} as const;

/**
 * The influence page is 20 people. A champion just outside it never reaches
 * the buying-role read. Pull accepted role holders the page missed, and say
 * when more than 20 distinct holders exist.
 */
export async function includeBuyingRoleContacts(
  orgId: string,
  companyId: string,
  loaded: ReadonlyArray<{ id: string }>,
  prismaClient: PrismaClient,
): Promise<{
  extra: Array<{
    id: string;
    customer: string;
    companyId: string | null;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    influence: number | null;
    createdAt: Date;
  }>;
  roleHoldersCapped: boolean;
}> {
  const probe = await prismaClient.contactFact.findMany({
    where: {
      orgId,
      deletedAt: null,
      kind: 'buying_role' as const,
      status: 'accepted' as const,
      opportunity: { orgId, companyId, deletedAt: null },
    },
    distinct: ['contactId'],
    select: { contactId: true },
    orderBy: { contactId: 'asc' },
    take: COCKPIT_CONTACT_PAGE + 1,
  });
  const roleHoldersCapped = probe.length > COCKPIT_CONTACT_PAGE;
  const have = new Set(loaded.map((contact) => contact.id));
  const missing = probe
    .slice(0, COCKPIT_CONTACT_PAGE)
    .map((row) => row.contactId)
    .filter((id) => !have.has(id));
  if (missing.length === 0) return { extra: [], roleHoldersCapped };
  const extra = await prismaClient.contact.findMany({
    where: { orgId, companyId, deletedAt: null, id: { in: missing } },
    select: cockpitContactSelect,
    take: missing.length,
  });
  return { extra, roleHoldersCapped };
}

/** Accepted roles only, newest first. A page of suggestions must not hide a champion. */
export async function fetchBuyingRoleFacts(
  orgId: string,
  contactIds: string[],
  prismaClient: PrismaClient,
  companyId: string,
): Promise<{
  rows: Array<{
    contactId: string;
    status: string;
    linkLabel: string | null;
    opportunityId: string | null;
    observedAt: Date | null;
  }>;
  capped: boolean;
}> {
  if (contactIds.length === 0 || !companyId) return { rows: [], capped: false };
  const where = {
    orgId,
    deletedAt: null,
    kind: 'buying_role' as const,
    status: 'accepted' as const,
    contactId: { in: contactIds },
    opportunity: { orgId, companyId, deletedAt: null },
  };
  const rows = await prismaClient.contactFact.findMany({
    where,
    select: {
      contactId: true,
      status: true,
      linkLabel: true,
      opportunityId: true,
      observedAt: true,
    },
    orderBy: [{ observedAt: 'desc' }, { id: 'asc' }],
    take: BUYING_ROLE_PAGE,
  });
  const capped =
    rows.length === BUYING_ROLE_PAGE &&
    (await prismaClient.contactFact.count({ where })) > BUYING_ROLE_PAGE;
  return { rows, capped };
}

/**
 * Exact win/loss + revenue-by-month for ONE account, computed in Postgres so
 * the numbers are correct regardless of how many opportunities the account has
 * (the cockpit's opportunity list is take-capped for display; aggregates must
 * not be). Sums stay integer micros strings so a large book is not rounded.
 */
function isCompanyUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

const EMPTY_ACCOUNT_PERFORMANCE: AccountPerformance = {
  winLoss: {
    wonCount: 0,
    lostCount: 0,
    wonValueMicros: '0',
    lostValueMicros: '0',
    winRate: null,
  },
  revenueEvolution: [],
};

export async function fetchAccountPerformance(
  orgId: string,
  companyId: string,
  prismaClient: PrismaClient,
  scope?: AccessScope,
): Promise<AccountPerformance> {
  // A customer string is not a company. Placeholder accounts use a slug id.
  if (!isCompanyUuid(companyId)) return EMPTY_ACCOUNT_PERFORMANCE;
  const base = { orgId, companyId, deletedAt: null };
  const lostWhere: Prisma.OpportunityWhereInput = {
    ...base,
    OR: [
      { stage: OpportunityStage.closed_lost },
      { pipelineStage: { is: { deletedAt: null, isLost: true } } },
    ],
  };
  const wonWhere: Prisma.OpportunityWhereInput = {
    ...base,
    NOT: {
      OR: [
        { stage: OpportunityStage.closed_lost },
        { pipelineStage: { is: { deletedAt: null, isLost: true } } },
      ],
    },
    OR: [
      { stage: OpportunityStage.closed_won },
      { pipelineStage: { is: { deletedAt: null, isWon: true, isLost: false } } },
    ],
  };
  const scoped = (where: Prisma.OpportunityWhereInput) =>
    scope ? applyOpportunityScope(where, scope) : where;
  const [won, lost, revenueRows] = await Promise.all([
    prismaClient.opportunity.aggregate({
      where: scoped(wonWhere),
      _sum: { valueMicros: true },
      _count: { _all: true },
    }),
    prismaClient.opportunity.aggregate({
      where: scoped(lostWhere),
      _sum: { valueMicros: true },
      _count: { _all: true },
    }),
    fetchRevenueRows(orgId, companyId, prismaClient, scope),
  ]);

  const wonCount = won._count._all;
  const lostCount = lost._count._all;
  const decided = wonCount + lostCount;

  return {
    winLoss: {
      wonCount,
      lostCount,
      wonValueMicros: microsText(won._sum.valueMicros),
      lostValueMicros: microsText(lost._sum.valueMicros),
      winRate: decided > 0 ? Math.round((wonCount / decided) * 100) : null,
    },
    // Raw query returns newest-first (for the LIMIT 12 window); the chart wants
    // oldest-first.
    revenueEvolution: revenueRows
      .map((r) => ({
        period: r.period,
        revenueMicros: microsText(
          typeof r.revenue === 'bigint' || typeof r.revenue === 'number' || typeof r.revenue === 'string'
            ? r.revenue
            : null,
        ),
      }))
      .reverse(),
  };
}

async function fetchRevenueRows(
  orgId: string,
  companyId: string,
  prismaClient: PrismaClient,
  scope?: AccessScope,
): Promise<Array<{ period: string; revenue: string | null }>> {
  if (!scope?.unrestricted && scope) {
    // Aggregate in Postgres for the scoped path too — a JS findMany summed in
    // app code was take-capped (5k rows), so an account with >5k closed_won opps
    // silently under-reported. Mirror the unrestricted SQL below, AND-ed with the
    // same OR-predicate applyOpportunityScope builds (country / territory overlap
    // / own deals). Predicate construction (variants + empty-variants → own-deals
    // only) matches the proven raw-SQL scope in lib/account-access.ts.
    const variants = countryVariantsForScope(scope);
    const countryScopeSql =
      variants.length > 0
        ? Prisma.sql`
            o.country = ANY(ARRAY[${Prisma.join(variants)}]::text[])
            OR t.country_codes && ARRAY[${Prisma.join(variants)}]::text[]
            OR`
        : Prisma.empty;
    return prismaClient.$queryRaw<Array<{ period: string; revenue: string | null }>>(Prisma.sql`
      SELECT to_char(date_trunc('month', o.due_date), 'YYYY-MM') AS period,
             SUM(o.value_micros)::text AS revenue
      FROM opportunities o
      LEFT JOIN territories t ON t.id = o.territory_id
      WHERE o.org_id = ${orgId}::uuid
        AND o.company_id = ${companyId}::uuid
        AND o.deleted_at IS NULL
        AND o.stage <> 'closed_lost'
        AND NOT EXISTS (
          SELECT 1 FROM pipeline_stages ps
          WHERE ps.id = o.pipeline_stage_id
            AND ps.deleted_at IS NULL
            AND ps.is_lost
        )
        AND (
          o.stage = 'closed_won'
          OR EXISTS (
            SELECT 1 FROM pipeline_stages ps
            WHERE ps.id = o.pipeline_stage_id
              AND ps.deleted_at IS NULL
              AND ps.is_won
              AND NOT ps.is_lost
          )
        )
        AND o.due_date IS NOT NULL
        AND (
          ${countryScopeSql}
          o.owner_id = ${scope.userId}::uuid
        )
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 12
    `);
  }

  return prismaClient.$queryRaw<Array<{ period: string; revenue: string | null }>>(Prisma.sql`
    SELECT to_char(date_trunc('month', o.due_date), 'YYYY-MM') AS period,
           SUM(o.value_micros)::text AS revenue
    FROM opportunities o
    WHERE o.org_id = ${orgId}::uuid
      AND o.company_id = ${companyId}::uuid
      AND o.deleted_at IS NULL
      AND o.due_date IS NOT NULL
      AND o.stage <> 'closed_lost'
      AND NOT EXISTS (
        SELECT 1 FROM pipeline_stages ps
        WHERE ps.id = o.pipeline_stage_id
          AND ps.deleted_at IS NULL
          AND ps.is_lost
      )
      AND (
        o.stage = 'closed_won'
        OR EXISTS (
          SELECT 1 FROM pipeline_stages ps
          WHERE ps.id = o.pipeline_stage_id
            AND ps.deleted_at IS NULL
            AND ps.is_won
            AND NOT ps.is_lost
        )
      )
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 12
  `);
}
