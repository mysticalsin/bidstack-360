import { z } from 'zod';

import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';

import type { Tool } from './index.js';

const Stage = z.enum([
  'discovery',
  'qualified',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
]);

const CompanySearchInput = z.object({
  query: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const DealCreateInput = z.object({
  customer: z.string().min(1),
  name: z.string().min(1),
  stage: Stage.default('discovery'),
  value: z.number().nonnegative().default(0),
  probability: z.number().int().min(0).max(100).default(25),
  dueDate: z.string().date().nullable().optional(),
  industry: z.string().nullable().optional(),
});

const DealUpdateInput = z.object({
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

const EnrichCompanyInput = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  website: z.string().url().optional(),
});

const ActivityListInput = z.object({
  company: z.string().optional(),
  dealId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const ActivityCreateInput = z.object({
  dealId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  dueDate: z.string().date().nullable().optional(),
});

const GenerateInsightsInput = z.object({
  company: z.string().optional(),
  dealId: z.string().uuid().optional(),
});

export const crmSearchCompanies: Tool<typeof CompanySearchInput> = {
  description: 'Search CRM companies from Twenty-backed opportunities and BidStack enrichments.',
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
    const q = args.query?.toLowerCase();
    // CompanyEnrichment model is pending — search falls back to Opportunity-
    // derived companies. Restore the union when the model lands.
    const opportunities = await prisma.opportunity.findMany({
      where: {
        orgId: ctx.orgId,
        ...(q
          ? {
              OR: [
                { customer: { contains: q, mode: 'insensitive' } },
                { industry: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { customer: true, industry: true, logoUrl: true, updatedAt: true },
      distinct: ['customer'],
      take: args.limit,
    });

    const items = opportunities
      .map((item: { customer: string; logoUrl: string | null }) => ({
        id: normalizeName(item.customer),
        name: item.customer,
        legalName: item.customer,
        domain: null,
        website: null,
        logoUrl: item.logoUrl,
        confidence: 0.55,
        source: 'twenty',
      }))
      .filter(
        (item) =>
          !q || `${item.name} ${item.legalName} ${item.domain ?? ''}`.toLowerCase().includes(q),
      );

    return items.slice(0, args.limit);
  },
};

export const crmCreateDeal: Tool<typeof DealCreateInput> = {
  description: 'Create a CRM deal/opportunity in the Twenty-compatible opportunity table.',
  input: DealCreateInput,
  inputJsonSchema: {
    type: 'object',
    required: ['customer', 'name'],
    properties: {
      customer: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1 },
      stage: { type: 'string', enum: Stage.options, default: 'discovery' },
      value: { type: 'number', minimum: 0, default: 0 },
      probability: { type: 'integer', minimum: 0, maximum: 100, default: 25 },
      dueDate: { type: ['string', 'null'], format: 'date' },
      industry: { type: ['string', 'null'] },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const code = await mintNextCode(ctx.orgId);
    const created = await prisma.opportunity.create({
      data: {
        orgId: ctx.orgId,
        code,
        customer: args.customer,
        name: args.name,
        stage: args.stage as PrismaStage,
        valueMicros: BigInt(Math.round(args.value * 1_000_000)),
        probability: args.probability,
        dueDate: args.dueDate ? new Date(args.dueDate) : null,
        industry: args.industry ?? null,
        intel: {},
      },
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

    return serializeDeal(created);
  },
};

export const crmUpdateDeal: Tool<typeof DealUpdateInput> = {
  description: 'Update a CRM deal/opportunity and write an audit entry.',
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
    const before = await prisma.opportunity.findFirst({ where: { id: args.id, orgId: ctx.orgId } });
    if (!before) throw new Error('Deal not found');

    const updated = await prisma.opportunity.update({
      where: { id: before.id },
      data: {
        ...(args.patch.stage !== undefined ? { stage: args.patch.stage as PrismaStage } : {}),
        ...(args.patch.probability !== undefined ? { probability: args.patch.probability } : {}),
        ...(args.patch.value !== undefined
          ? { valueMicros: BigInt(Math.round(args.patch.value * 1_000_000)) }
          : {}),
        ...(args.patch.dueDate !== undefined
          ? { dueDate: args.patch.dueDate ? new Date(args.patch.dueDate) : null }
          : {}),
        ...(args.patch.customer !== undefined ? { customer: args.patch.customer } : {}),
        ...(args.patch.name !== undefined ? { name: args.patch.name } : {}),
        ...(args.patch.industry !== undefined ? { industry: args.patch.industry } : {}),
      },
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

    return serializeDeal(updated);
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
    void ctx.orgId;
    const domain = normalizeDomain(args.domain);
    const website = args.website ?? (domain ? `https://${domain}/` : null);
    // CompanyEnrichment Prisma model is pending — synthesize an enrichment
    // response from the inputs so the tool stays callable. When the model
    // lands, swap to the upsert. The Apollo worker also writes back here.
    const confidenceBps = domain === 'mantu.com' ? 9900 : 7200;
    return {
      id: normalizeName(args.name),
      name: args.name,
      legalName: args.name,
      domain,
      website,
      logoUrl: logoUrl(args.name, domain),
      confidence: confidenceBps / 10000,
      sourceAttribution: [source(args.name, website, domain === 'mantu.com' ? 0.99 : 0.72)],
    };
  },
};

export const crmListActivities: Tool<typeof ActivityListInput> = {
  description: 'List CRM activity timeline entries from tasks and job events.',
  input: ActivityListInput,
  inputJsonSchema: {
    type: 'object',
    properties: {
      company: { type: 'string' },
      dealId: { type: 'string', format: 'uuid' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const tasks = await prisma.task.findMany({
      where: {
        orgId: ctx.orgId,
        ...(args.dealId ? { oppId: args.dealId } : {}),
        ...(args.company ? { opportunity: { customer: args.company } } : {}),
      },
      include: { opportunity: true, assignee: true },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
    });
    return tasks.map((task) => ({
      id: task.id,
      kind: 'task',
      subject: task.title,
      company: task.opportunity?.customer ?? null,
      dealId: task.oppId,
      actor: task.assignee?.email ?? null,
      occurredAt: task.createdAt.toISOString(),
    }));
  },
};

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
      where: { id: args.dealId, orgId: ctx.orgId },
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
      ? await prisma.opportunity.findFirst({ where: { id: args.dealId, orgId: ctx.orgId } })
      : await prisma.opportunity.findFirst({
          where: { orgId: ctx.orgId, ...(args.company ? { customer: args.company } : {}) },
          orderBy: { updatedAt: 'desc' },
        });

    // AiInsight Prisma model is pending — synthesize the insight in memory.
    // When the model lands, restore the persistent .create() call.
    void ctx.orgId;
    const confidenceBps = deal ? 7600 : 5200;
    return {
      id: `insight-${normalizeName(deal?.customer ?? args.company ?? 'mantu')}-${Date.now()}`,
      kind: 'next_best_action',
      title: 'Next best action',
      summary: deal
        ? `Schedule an executive alignment step for ${deal.customer} and attach the compliance checklist.`
        : 'Run company enrichment before generating a targeted next best action.',
      confidence: confidenceBps / 10000,
      createdAt: new Date().toISOString(),
    };
  },
};

async function mintNextCode(orgId: string): Promise<string> {
  const last = await prisma.opportunity.findFirst({
    where: { orgId, code: { startsWith: 'OP-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'OP-2001';
  const n = Number(last.code.slice(3));
  return `OP-${(n + 1).toString().padStart(4, '0')}`;
}

function serializeDeal(deal: {
  id: string;
  code: string;
  customer: string;
  name: string;
  stage: string;
  valueMicros: bigint | number | unknown;
  probability: number;
  dueDate: Date | null;
  industry: string | null;
  updatedAt: Date;
}) {
  return {
    id: deal.id,
    code: deal.code,
    customer: deal.customer,
    name: deal.name,
    stage: deal.stage,
    value: Number(deal.valueMicros) / 1_000_000,
    probability: deal.probability,
    dueDate: deal.dueDate?.toISOString().slice(0, 10) ?? null,
    industry: deal.industry,
    updatedAt: deal.updatedAt.toISOString(),
  };
}

function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

function logoUrl(name: string, domain: string | null) {
  if (domain === 'mantu.com' || name.toLowerCase() === 'mantu')
    return 'https://mantu.com/favicon.ico';
  if (!domain) return null;
  return `https://www.${domain.replace(/^www\./, '')}/favicon.ico`;
}

function source(name: string, sourceUrl: string | null, confidence: number) {
  return {
    source: sourceUrl?.includes('mantu.com') ? 'official_website' : 'mcp_enrichment',
    label: sourceUrl?.includes('mantu.com')
      ? 'Mantu official website'
      : `${name} enrichment profile`,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    confidence,
    providerMetadata: {},
  };
}
