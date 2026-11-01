import { type Prisma, type OpportunityStage as PrismaStage, prisma } from '@bidstack/db';

import type { Tool } from './index.js';
import {
  ActivityCreateInput,
  ActivityListInput,
  CompanySearchInput,
  DealCreateInput,
  DealUpdateInput,
  EnrichCompanyInput,
  GenerateInsightsInput,
  Stage,
} from './crm-tools.schemas.js';
import {
  companyIdForCustomerRename,
  recordOpportunityStageMove,
  logoUrl,
  mintNextCode,
  normalizeDomain,
  isCompanyUuid,
  normalizeName,
  requireCompanyLink,
  dealOutcome,
  serializeDeal,
  pipelineStageIdForStageChange,
  solePipelineStage,
  source,
} from './crm-tools.helpers.js';

export const crmSearchCompanies: Tool<typeof CompanySearchInput> = {
  description:
    'Search Company rows in the caller org. Returns the canonical company id. Opportunity customer text that does not match a company row is labeled opportunity_text_only and has no match confidence.',
  input: CompanySearchInput,
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const q = args.query?.trim();
    const companies = await prisma.company.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { legalName: { contains: q, mode: 'insensitive' } },
                { domain: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        legalName: true,
        domain: true,
        website: true,
        logoUrl: true,
      },
      orderBy: { name: 'asc' },
      take: args.limit,
    });

    const companyHits = companies.map((company) => ({
      id: company.id,
      name: company.name,
      legalName: company.legalName,
      domain: company.domain,
      website: company.website,
      logoUrl: company.logoUrl,
      matchKind: 'company' as const,
      // Match quality is not a stored score. Do not invent one.
      confidence: null,
    }));

    const remaining = args.limit - companyHits.length;
    if (remaining <= 0) return companyHits;

    const seen = new Set(companyHits.map((company) => company.id));
    const opportunities = await prisma.opportunity.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null,
        ...(q ? { customer: { contains: q, mode: 'insensitive' } } : {}),
      },
      select: { customer: true, logoUrl: true, companyId: true },
      distinct: ['customer'],
      take: remaining,
    });

    const textHits = opportunities
      .filter((row) => !row.companyId || !seen.has(row.companyId))
      .map((row) => ({
        id: row.companyId,
        name: row.customer,
        legalName: null,
        domain: null,
        website: null,
        logoUrl: row.logoUrl,
        matchKind: 'opportunity_text_only' as const,
        confidence: null,
      }));

    return [...companyHits, ...textHits];
  },
};

export const crmCreateDeal: Tool<typeof DealCreateInput> = {
  description:
    'Create a CRM deal linked to one company. Pass companyId, or a customer name that matches exactly one company. The stage key links the one live pipeline stage with that key. Two matches are refused. Omit probability when it is unknown; 0 is stored and adds nothing to weighted pipeline.',
  input: DealCreateInput,
  inputJsonSchema: {
    type: 'object',
    required: ['customer', 'name'],
    properties: {
      customer: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1 },
      stage: { type: 'string', enum: Stage.options, default: 's1_lead' },
      value: { type: 'number', minimum: 0, default: 0 },
      probability: { type: 'integer', minimum: 0, maximum: 100 },
      companyId: { type: 'string', format: 'uuid' },
      dueDate: { type: ['string', 'null'], format: 'date' },
      industry: { type: ['string', 'null'] },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const company = await requireCompanyLink(ctx.orgId, {
      companyId: args.companyId,
      name: args.customer,
    });
    const stageRow = await solePipelineStage(ctx.orgId, args.stage);
    const code = await mintNextCode(ctx.orgId);
    const created = await prisma.opportunity.create({
      data: {
        orgId: ctx.orgId,
        code,
        customer: company.name,
        companyId: company.id,
        name: args.name,
        stage: args.stage as PrismaStage,
        ...(stageRow ? { pipelineStageId: stageRow.id } : {}),
        valueMicros: BigInt(Math.round(args.value * 1_000_000)),
        probability: args.probability ?? 0,
        dueDate: args.dueDate ? new Date(args.dueDate) : null,
        industry: args.industry ?? null,
        intel: {},
      },
      include: { pipelineStage: { select: { isWon: true, isLost: true, deletedAt: true } } },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'crm.create_deal.mcp',
        targetType: 'opportunity',
        targetId: created.id,
        diff: args,
      },
    });

    return {
      ...serializeDeal(created),
      companyId: created.companyId,
      outcome: dealOutcome(created),
    };
  },
};

export const crmUpdateDeal: Tool<typeof DealUpdateInput> = {
  description:
    'Update a CRM deal. Changing customer relinks when that name matches one company, clears the link when it matches none, and refuses when it matches several. A stage change links the one live pipeline stage with the new key, or clears that link when none exists. Two matches are refused and the deal stays put. Repeating the current stage does not. The result outcome is open, won, or lost from the stored key and any live stage flag. Other fields do not touch the company link. Writes an audit entry.',
  input: DealUpdateInput,
  inputJsonSchema: {
    type: 'object',
    required: ['id', 'patch'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      patch: { type: 'object', additionalProperties: true },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const before = await prisma.opportunity.findFirst({
      where: { id: args.id, orgId: ctx.orgId, deletedAt: null }, // skip soft-deleted (Review)
    });
    if (!before) throw new Error('Deal not found');

    const companyId =
      args.patch.customer !== undefined && args.patch.customer !== before.customer
        ? await companyIdForCustomerRename(ctx.orgId, args.patch.customer)
        : undefined;
    const pipelineStageId = await pipelineStageIdForStageChange(
      ctx.orgId,
      before.stage,
      args.patch.stage,
    );
    const updated = await prisma.opportunity.update({
      where: { id: before.id },
      data: {
        ...(args.patch.stage !== undefined ? { stage: args.patch.stage as PrismaStage } : {}),
        ...(pipelineStageId !== undefined ? { pipelineStageId } : {}),
        ...(args.patch.probability !== undefined ? { probability: args.patch.probability } : {}),
        ...(args.patch.value !== undefined
          ? { valueMicros: BigInt(Math.round(args.patch.value * 1_000_000)) }
          : {}),
        ...(args.patch.dueDate !== undefined
          ? { dueDate: args.patch.dueDate ? new Date(args.patch.dueDate) : null }
          : {}),
        ...(args.patch.customer !== undefined ? { customer: args.patch.customer } : {}),
        ...(companyId !== undefined ? { companyId } : {}),
        ...(args.patch.name !== undefined ? { name: args.patch.name } : {}),
        ...(args.patch.industry !== undefined ? { industry: args.patch.industry } : {}),
      },
      include: { pipelineStage: { select: { isWon: true, isLost: true, deletedAt: true } } },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'crm.update_deal.mcp',
        targetType: 'opportunity',
        targetId: updated.id,
        diff: args.patch,
      },
    });

    await recordOpportunityStageMove(ctx.orgId, before, args.patch.stage);
    return {
      ...serializeDeal(updated),
      companyId: updated.companyId,
      outcome: dealOutcome(updated),
    };
  },
};

export const crmEnrichCompany: Tool<typeof EnrichCompanyInput> = {
  description: 'Create or refresh a verified company enrichment profile with source attribution.',
  input: EnrichCompanyInput,
  inputJsonSchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      domain: { type: 'string' },
      website: { type: 'string', format: 'uri' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const domain = normalizeDomain(args.domain);
    const website = args.website ?? (domain ? `https://${domain}/` : null);
    const normalizedName = normalizeName(args.name);
    const confidenceBps = 0;
    const attribution = [source(args.name, website, null)];

    const upserted = await prisma.companyEnrichment.upsert({
      where: {
        orgId_normalizedName: {
          orgId: ctx.orgId,
          normalizedName,
        },
      },
      create: {
        orgId: ctx.orgId,
        normalizedName,
        legalName: null,
        domain,
        website,
        logoUrl: logoUrl(args.name, domain),
        confidenceBps,
        sourceAttribution: attribution as Prisma.InputJsonValue,
      },
      update: {
        domain,
        website,
        logoUrl: logoUrl(args.name, domain),
        confidenceBps,
        sourceAttribution: attribution as Prisma.InputJsonValue,
      },
    });

    return {
      id: upserted.id,
      name: args.name,
      legalName: upserted.legalName,
      domain: upserted.domain,
      website: upserted.website,
      logoUrl: upserted.logoUrl,
      confidence: upserted.confidenceBps / 10000,
      sourceAttribution: upserted.sourceAttribution,
    };
  },
};

export const crmListActivities: Tool<typeof ActivityListInput> = {
  description:
    'List follow-up tasks and logged activities for one company or deal. A company name must match exactly one company. Tasks match the company id or the opportunity company. Activities match the company, its linked deals, or its linked people. A matching customer label is not included.',
  input: ActivityListInput,
  inputJsonSchema: {
    type: 'object',
    properties: {
      company: {
        type: 'string',
        description: 'Company id, or a name that matches exactly one company.',
      },
      dealId: { type: 'string', format: 'uuid' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const company = args.company
      ? await requireCompanyLink(
          ctx.orgId,
          isCompanyUuid(args.company) ? { companyId: args.company } : { name: args.company },
        )
      : null;
    if (args.dealId && company) {
      const deal = await prisma.opportunity.findFirst({
        where: {
          id: args.dealId,
          orgId: ctx.orgId,
          deletedAt: null,
          companyId: company.id,
        },
        select: { id: true },
      });
      // The deal is not this company's. Do not return its timeline under the account.
      if (!deal) return [];
    }

    const linkedIds = await linkedActivityIds(ctx.orgId, company?.id, args.dealId);
    const [tasks, activities] = await Promise.all([
      prisma.task.findMany({
        where: {
          orgId: ctx.orgId,
          deletedAt: null, // skip soft-deleted (Review)
          ...(args.dealId ? { oppId: args.dealId } : {}),
          ...(company
            ? {
                OR: [
                  { accountId: company.id },
                  { opportunity: { companyId: company.id, deletedAt: null } },
                ],
              }
            : {}),
        },
        include: { opportunity: true, assignee: true },
        orderBy: { createdAt: 'desc' },
        take: args.limit,
      }),
      prisma.activity.findMany({
        where: {
          orgId: ctx.orgId,
          deletedAt: null,
          ...(linkedIds ? { OR: linkedIds } : {}),
        },
        include: { owner: true },
        orderBy: { occurredAt: 'desc' },
        take: args.limit,
      }),
    ]);

    return [
      ...tasks.map((task) => ({
        id: task.id,
        kind: 'task' as const,
        subject: task.title,
        company: company?.name ?? task.opportunity?.customer ?? null,
        dealId: task.oppId,
        actor: task.assignee?.email ?? null,
        occurredAt: task.createdAt.toISOString(),
      })),
      ...activities.map((activity) => ({
        id: activity.id,
        kind: activity.type,
        subject: activity.subject,
        company: company?.name ?? null,
        dealId: activity.entityType === 'opportunity' ? activity.entityId : null,
        actor: activity.owner?.email ?? null,
        occurredAt: activity.occurredAt.toISOString(),
      })),
    ]
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
      .slice(0, args.limit);
  },
};

/** Company, linked-deal, and linked-person activity targets. Null means no entity filter. */
async function linkedActivityIds(
  orgId: string,
  companyId: string | undefined,
  dealId: string | undefined,
): Promise<Prisma.ActivityWhereInput[] | null> {
  if (dealId) return [{ entityType: 'opportunity', entityId: dealId }];
  if (!companyId) return null;
  const [opportunities, contacts] = await Promise.all([
    prisma.opportunity.findMany({
      where: { orgId, deletedAt: null, companyId },
      select: { id: true },
    }),
    prisma.contact.findMany({
      where: { orgId, deletedAt: null, companyId },
      select: { id: true },
    }),
  ]);
  const or: Prisma.ActivityWhereInput[] = [{ entityType: 'company', entityId: companyId }];
  if (opportunities.length > 0) {
    or.push({ entityType: 'opportunity', entityId: { in: opportunities.map((row) => row.id) } });
  }
  if (contacts.length > 0) {
    or.push({ entityType: 'contact', entityId: { in: contacts.map((row) => row.id) } });
  }
  return or;
}

export const crmCreateActivity: Tool<typeof ActivityCreateInput> = {
  description: 'Create a CRM activity as a follow-up task on a deal.',
  input: ActivityCreateInput,
  inputJsonSchema: {
    type: 'object',
    required: ['dealId', 'subject'],
    properties: {
      dealId: { type: 'string', format: 'uuid' },
      subject: { type: 'string', minLength: 1, maxLength: 200 },
      dueDate: { type: ['string', 'null'], format: 'date' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const deal = await prisma.opportunity.findFirst({
      where: { id: args.dealId, orgId: ctx.orgId, deletedAt: null }, // skip soft-deleted (Review)
    });
    if (!deal) throw new Error('Deal not found');
    const task = await prisma.task.create({
      data: {
        orgId: ctx.orgId,
        oppId: deal.id,
        title: args.subject,
        dueDate: args.dueDate ? new Date(args.dueDate) : null,
      },
    });
    return {
      id: task.id,
      dealId: task.oppId,
      subject: task.title,
      occurredAt: task.createdAt.toISOString(),
    };
  },
};

export const crmGenerateInsights: Tool<typeof GenerateInsightsInput> = {
  description: 'Generate deterministic CRM insight records for Dust agents to review or extend.',
  input: GenerateInsightsInput,
  inputJsonSchema: {
    type: 'object',
    properties: {
      company: { type: 'string' },
      dealId: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const deal = args.dealId
      ? await prisma.opportunity.findFirst({
          where: { id: args.dealId, orgId: ctx.orgId, deletedAt: null }, // skip soft-deleted (Review)
        })
      : await prisma.opportunity.findFirst({
          where: {
            orgId: ctx.orgId,
            deletedAt: null, // skip soft-deleted (Review)
            ...(args.company
              ? {
                  companyId: (
                    await requireCompanyLink(
                      ctx.orgId,
                      isCompanyUuid(args.company) ? { companyId: args.company } : { name: args.company },
                    )
                  ).id,
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
        });

    // No insight row is stored. Do not invent a next action or a confidence score.
    void ctx.orgId;
    return {
      insight: null,
      confidence: null,
      confidenceBasis: 'not_scored',
      summary: deal
        ? `No scored next action is stored for ${deal.customer}.`
        : 'No scored next action is stored.',
      dealId: deal?.id ?? null,
      companyName: deal?.customer ?? args.company ?? null,
    };
  },
};
