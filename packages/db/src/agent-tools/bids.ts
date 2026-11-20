import { z } from 'zod';

import { prisma } from '../index.js';

import {
  callerCan,
  isoDate,
  oppCitation,
  proposalOwnerWhere,
  type AgentCitation,
  type AgentTool,
  type AgentToolCtx,
} from './types.js';

const OPEN_PROPOSAL_STATUSES = ['draft', 'review', 'approved'] as const;
// Approved proposals are immutable; a substantive edit needs a revision first
// (apps/api/src/routes/proposals.approval.ts).
const EDITABLE_PROPOSAL_STATUSES = ['draft', 'review'] as const;
const CLOSED_STAGES = ['closed_won', 'closed_lost'] as const;

async function userNames(orgId: string, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { orgId, id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name ?? u.email]));
}

function proposalCitation(p: { id: string; name: string; dueDate: Date | null }): AgentCitation {
  return { kind: 'proposal', label: p.name, href: `/proposals/${p.id}`, date: isoDate(p.dueDate) };
}

// Plain object (no .refine) so the MCP server can read `.shape`.
const StatusInput = z.object({
  proposalId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
});

export const proposalStatus: AgentTool<typeof StatusInput> = {
  description:
    'Where a proposal stands: status, version, owner, due date, compliance score and section progress. Takes a proposal, an opportunity or an account. Falls back to the opportunity stage when no proposal exists.',
  input: StatusInput,
  kind: 'read',
  permission: 'proposals:read',
  inputJsonSchema: {
    type: 'object',
    properties: {
      proposalId: { type: 'string', format: 'uuid' },
      opportunityId: { type: 'string', format: 'uuid' },
      accountId: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    if (!args.proposalId && !args.opportunityId && !args.accountId) {
      throw new Error('Provide proposalId, opportunityId or accountId');
    }
    const scope = args.proposalId
      ? { id: args.proposalId }
      : args.opportunityId
        ? { opportunityId: args.opportunityId }
        : { opportunity: { companyId: args.accountId } };
    const proposals = await prisma.proposal.findMany({
      where: { orgId: ctx.orgId, deletedAt: null, ...scope, ...proposalOwnerWhere(ctx) },
      include: {
        opportunity: { select: { id: true, code: true, name: true, stage: true, dueDate: true } },
        sections: {
          where: { deletedAt: null },
          select: { aiDrafted: true, humanReviewed: true, wordCount: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });

    if (proposals.length === 0) {
      const opps = await prisma.opportunity.findMany({
        where: {
          orgId: ctx.orgId,
          deletedAt: null,
          ...(args.opportunityId ? { id: args.opportunityId } : { companyId: args.accountId }),
        },
        include: { owner: { select: { name: true, email: true } } },
        take: 5,
      });
      return {
        proposals: [],
        opportunities: opps.map((o) => ({
          code: o.code,
          name: o.name,
          stage: o.stage,
          dueDate: isoDate(o.dueDate),
          owner: o.owner?.name ?? o.owner?.email ?? null,
        })),
        missing: ['No proposal record exists yet for this request.'],
        citations: opps.map(oppCitation),
      };
    }

    const owners = await userNames(
      ctx.orgId,
      proposals.map((p) => p.ownerId),
    );
    return {
      proposals: proposals.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        version: p.version,
        dueDate: isoDate(p.dueDate),
        complianceScore: p.complianceScore,
        owner: p.ownerId ? (owners.get(p.ownerId) ?? null) : null,
        approved: p.approvedAt !== null,
        updatedAt: p.updatedAt.toISOString(),
        sections: {
          total: p.sections.length,
          drafted: p.sections.filter((s) => s.wordCount > 0).length,
          reviewed: p.sections.filter((s) => s.humanReviewed).length,
        },
        opportunity: p.opportunity
          ? { code: p.opportunity.code, name: p.opportunity.name, stage: p.opportunity.stage }
          : null,
      })),
      missing: proposals.some((p) => !p.dueDate) ? ['A proposal has no due date.'] : [],
      citations: [
        ...proposals.map(proposalCitation),
        ...proposals.flatMap((p) => (p.opportunity ? [oppCitation(p.opportunity)] : [])),
      ],
    };
  },
};

const OverdueInput = z.object({ limit: z.number().int().min(1).max(50).default(25) });

export const bidsOverdue: AgentTool<typeof OverdueInput> = {
  description:
    'Open bids past their due date: open opportunities and unsubmitted proposals whose due date is before today, with owners and days overdue.',
  input: OverdueInput,
  kind: 'read',
  permission: 'opportunities:read',
  inputJsonSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 } },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const showProposals = await callerCan(ctx, 'proposals:read');
    const [opps, proposals] = await Promise.all([
      prisma.opportunity.findMany({
        where: {
          orgId: ctx.orgId,
          deletedAt: null,
          stage: { notIn: [...CLOSED_STAGES] },
          dueDate: { lt: today },
        },
        include: { owner: { select: { name: true, email: true } } },
        orderBy: { dueDate: 'asc' },
        take: args.limit,
      }),
      showProposals
        ? prisma.proposal.findMany({
            where: {
              orgId: ctx.orgId,
              deletedAt: null,
              status: { in: [...OPEN_PROPOSAL_STATUSES] },
              dueDate: { lt: today },
              ...proposalOwnerWhere(ctx),
            },
            include: { opportunity: { select: { code: true } } },
            orderBy: { dueDate: 'asc' },
            take: args.limit,
          })
        : Promise.resolve([]),
    ]);
    const owners = await userNames(
      ctx.orgId,
      proposals.map((p) => p.ownerId),
    );
    const daysLate = (d: Date | null) =>
      d ? Math.max(1, Math.round((today.getTime() - d.getTime()) / 86_400_000)) : 0;

    return {
      today: isoDate(today),
      items: [
        ...opps.map((o) => ({
          kind: 'opportunity' as const,
          code: o.code,
          name: o.name,
          customer: o.customer,
          stage: o.stage,
          dueDate: isoDate(o.dueDate),
          daysOverdue: daysLate(o.dueDate),
          owner: o.owner?.name ?? o.owner?.email ?? null,
        })),
        ...proposals.map((p) => ({
          kind: 'proposal' as const,
          code: p.opportunity?.code ?? null,
          name: p.name,
          status: p.status,
          dueDate: isoDate(p.dueDate),
          daysOverdue: daysLate(p.dueDate),
          owner: p.ownerId ? (owners.get(p.ownerId) ?? null) : null,
        })),
      ],
      citations: [...opps.map(oppCitation), ...proposals.map(proposalCitation)],
    };
  },
};

const SectionInput = z.object({
  proposalId: z.string().uuid(),
  key: z.string().regex(/^[a-z][a-z_]{1,39}$/),
  title: z.string().min(1).max(120).optional(),
  content: z.string().min(1).max(8_000),
});

const PREVIEW_CHARS = 400;

function humanize(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function findOpenProposal(ctx: AgentToolCtx, id: string) {
  const proposal = await prisma.proposal.findFirst({
    where: { id, orgId: ctx.orgId, deletedAt: null, ...proposalOwnerWhere(ctx) },
    select: { id: true, name: true, status: true, dueDate: true },
  });
  if (!proposal) throw new Error('Proposal not found');
  if (!(EDITABLE_PROPOSAL_STATUSES as readonly string[]).includes(proposal.status)) {
    throw new Error(`Proposal is ${proposal.status}; sections are locked`);
  }
  return proposal;
}

export const proposalSectionDraft: AgentTool<typeof SectionInput> = {
  description:
    'Save a draft into one proposal section (for example executive_summary). Marks it AI drafted and not yet reviewed. Never submits the proposal.',
  input: SectionInput,
  kind: 'write',
  permission: 'proposals:write',
  inputJsonSchema: {
    type: 'object',
    required: ['proposalId', 'key', 'content'],
    properties: {
      proposalId: { type: 'string', format: 'uuid' },
      key: { type: 'string', pattern: '^[a-z][a-z_]{1,39}$' },
      title: { type: 'string', minLength: 1, maxLength: 120 },
      content: { type: 'string', minLength: 1, maxLength: 8000 },
    },
    additionalProperties: false,
  },
  preview: async (args, ctx) => {
    const proposal = await findOpenProposal(ctx, args.proposalId);
    const existing = await prisma.proposalSection.findFirst({
      where: { orgId: ctx.orgId, proposalId: proposal.id, key: args.key, deletedAt: null },
      select: { wordCount: true },
    });
    const excerpt =
      args.content.length > PREVIEW_CHARS
        ? `${args.content.slice(0, PREVIEW_CHARS)}…`
        : args.content;
    return {
      title: 'Draft proposal section',
      changes: [
        { field: 'Proposal', value: proposal.name },
        { field: 'Section', value: args.title ?? humanize(args.key) },
        {
          field: 'Replaces',
          value: existing ? `${existing.wordCount} words` : 'new section',
        },
        { field: 'Content', value: excerpt },
      ],
      citation: proposalCitation(proposal),
    };
  },
  handler: async (args, ctx) => {
    const proposal = await findOpenProposal(ctx, args.proposalId);
    const words = wordCount(args.content);
    const section = await prisma.proposalSection.upsert({
      where: { proposalId_key: { proposalId: proposal.id, key: args.key } },
      create: {
        orgId: ctx.orgId,
        proposalId: proposal.id,
        key: args.key,
        title: args.title ?? humanize(args.key),
        content: args.content,
        wordCount: words,
        aiDrafted: true,
        humanReviewed: false,
      },
      update: {
        content: args.content,
        wordCount: words,
        aiDrafted: true,
        humanReviewed: false,
        ...(args.title ? { title: args.title } : {}),
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        userId: ctx.userId ?? null,
        action: 'proposal.section.draft',
        targetType: 'proposal',
        targetId: proposal.id,
        diff: { key: args.key, wordCount: words, surface: ctx.surface ?? 'mcp' },
      },
    });
    return { id: section.id, proposalId: proposal.id, key: section.key, wordCount: words };
  },
};
