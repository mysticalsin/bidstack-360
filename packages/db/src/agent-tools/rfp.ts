import { z } from 'zod';

import { prisma } from '../index.js';

import {
  callerCan,
  isoDate,
  oppCitation,
  proposalOwnerWhere,
  type AgentCitation,
  type AgentTool,
} from './types.js';

const GAP_STATUSES = new Set(['suggested', 'blocked']);
const OPEN_ROW_STATUSES = new Set(['open', 'blocked']);
const TEXT_CAP = 160;

function excerpt(text: string): string {
  return text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}…` : text;
}

const Input = z.object({ opportunityId: z.string().uuid() });

export const rfpSummary: AgentTool<typeof Input> = {
  description:
    'Summarize the RFP on an opportunity: requirement counts, mandatory items, deadlines (submission, proposals, requirement due dates) and gaps (unowned mandatory items, unanswered or blocked requirements).',
  input: Input,
  kind: 'read',
  permission: 'opportunities:read',
  inputJsonSchema: {
    type: 'object',
    required: ['opportunityId'],
    properties: { opportunityId: { type: 'string', format: 'uuid' } },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const opp = await prisma.opportunity.findFirst({
      where: { id: args.opportunityId, orgId: ctx.orgId, deletedAt: null },
      include: { owner: { select: { name: true, email: true } } },
    });
    if (!opp) throw new Error('Opportunity not found');

    const showProposals = await callerCan(ctx, 'proposals:read');
    const [requirements, documents, proposals] = await Promise.all([
      prisma.requirement.findMany({
        where: { orgId: ctx.orgId, opportunityId: opp.id, deletedAt: null },
        select: {
          id: true,
          text: true,
          mandatory: true,
          priority: true,
          status: true,
          ownerId: true,
          dueDate: true,
          matrixRow: { select: { status: true, answerDraft: true, dueDate: true } },
        },
        orderBy: [{ mandatory: 'desc' }, { createdAt: 'asc' }],
        take: 200,
      }),
      prisma.bidDocument.findMany({
        where: { orgId: ctx.orgId, opportunityId: opp.id, deletedAt: null },
        select: { title: true, documentType: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      showProposals
        ? prisma.proposal.findMany({
            where: { orgId: ctx.orgId, opportunityId: opp.id, deletedAt: null, ...proposalOwnerWhere(ctx) },
            select: { id: true, name: true, status: true, dueDate: true },
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of requirements) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    const gaps = requirements
      .filter(
        (r) =>
          GAP_STATUSES.has(r.status) ||
          (r.mandatory && !r.ownerId) ||
          (r.matrixRow !== null && OPEN_ROW_STATUSES.has(r.matrixRow.status) && !r.matrixRow.answerDraft),
      )
      .slice(0, 10)
      .map((r) => ({
        text: excerpt(r.text),
        mandatory: r.mandatory,
        status: r.status,
        reason: !r.ownerId && r.mandatory ? 'mandatory, no owner' : `status ${r.status}`,
      }));

    const deadlines = [
      ...(opp.dueDate ? [{ label: 'Submission due', date: isoDate(opp.dueDate) }] : []),
      ...proposals
        .filter((p) => p.dueDate)
        .map((p) => ({ label: `${p.name} due`, date: isoDate(p.dueDate) })),
      ...requirements
        .map((r) => r.dueDate ?? r.matrixRow?.dueDate ?? null)
        .filter((d): d is Date => d !== null)
        .map((d) => isoDate(d))
        .filter((d, i, all) => all.indexOf(d) === i)
        .slice(0, 5)
        .map((date) => ({ label: 'Requirement due', date })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const missing: string[] = [];
    if (requirements.length === 0) missing.push('No requirements extracted for this RFP yet.');
    if (documents.length === 0) missing.push('No RFP documents uploaded.');
    if (!opp.dueDate) missing.push('No submission deadline on record.');

    const rfpCitation: AgentCitation = {
      kind: 'rfp',
      label: `${opp.code} RFP`,
      href: `/rfp/${opp.id}/pipeline`,
      date: isoDate(opp.dueDate),
    };

    return {
      opportunity: {
        code: opp.code,
        name: opp.name,
        customer: opp.customer,
        stage: opp.stage,
        owner: opp.owner?.name ?? opp.owner?.email ?? null,
      },
      requirements: {
        total: requirements.length,
        mandatory: requirements.filter((r) => r.mandatory).length,
        byStatus,
        top: requirements.slice(0, 8).map((r) => ({ text: excerpt(r.text), mandatory: r.mandatory })),
      },
      deadlines,
      gaps,
      documents: documents.map((d) => ({
        title: d.title,
        type: d.documentType,
        status: d.status,
        uploaded: isoDate(d.createdAt),
      })),
      missing,
      citations: [
        rfpCitation,
        oppCitation(opp),
        ...proposals.map((p) => ({
          kind: 'proposal' as const,
          label: p.name,
          href: `/proposals/${p.id}`,
          date: isoDate(p.dueDate),
        })),
      ],
    };
  },
};
