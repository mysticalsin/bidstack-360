import { z } from 'zod';

import { prisma } from '../index.js';

import { activityText, auditText } from './timeline-text.js';
import {
  callerCan,
  companyScopeWhere,
  isoDate,
  oppCitation,
  proposalOwnerWhere,
  type AgentCitation,
  type AgentTool,
} from './types.js';

const MIN_NAME_LENGTH = 3;
// Candidate rows per record type before scope filters and the final cut.
const CANDIDATES = 50;

interface IdRow {
  id: string;
}

function byLongestName<T>(name: (row: T) => string) {
  return (a: T, b: T) => name(b).length - name(a).length;
}

const ResolveInput = z.object({ text: z.string().min(1).max(2_000) });

export const recordsResolve: AgentTool<typeof ResolveInput> = {
  description:
    'Find the accounts, opportunities and proposals a sentence names (by name, customer or OP-#### code). Use it before reading a record the user named.',
  input: ResolveInput,
  kind: 'read',
  permission: 'accounts:read',
  inputJsonSchema: {
    type: 'object',
    required: ['text'],
    properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const text = args.text.toLowerCase();
    const codes = [...args.text.matchAll(/\bOP-\d{4}\b/gi)].map((m) => m[0].toUpperCase());
    const [showOpps, showProposals] = await Promise.all([
      callerCan(ctx, 'opportunities:read'),
      callerCan(ctx, 'proposals:read'),
    ]);
    const companyScope = companyScopeWhere(ctx);

    // Names and codes are matched in SQL so an older record the user named is
    // found, not just the most recently updated ones.
    const companyHits = await prisma.$queryRaw<IdRow[]>`
      SELECT id FROM companies
      WHERE org_id = ${ctx.orgId}::uuid AND deleted_at IS NULL
        AND length(btrim(name)) >= ${MIN_NAME_LENGTH}
        AND strpos(${text}, lower(btrim(name))) > 0
      ORDER BY length(name) DESC, updated_at DESC
      LIMIT ${CANDIDATES}`;
    const companies = await prisma.company.findMany({
      where: {
        orgId: ctx.orgId,
        id: { in: companyHits.map((r) => r.id) },
        ...(companyScope ? { AND: [companyScope] } : {}),
      },
      select: { id: true, name: true },
    });
    const accounts = companies.sort(byLongestName((c) => c.name)).slice(0, 3);
    const accountIds = accounts.map((a) => a.id);

    const [oppHits, proposalHits] = await Promise.all([
      showOpps
        ? prisma.$queryRaw<IdRow[]>`
            SELECT id FROM opportunities
            WHERE org_id = ${ctx.orgId}::uuid AND deleted_at IS NULL AND (
              upper(code) = ANY(${codes}::text[])
              OR company_id = ANY(${accountIds}::uuid[])
              OR (length(btrim(customer)) >= ${MIN_NAME_LENGTH} AND strpos(${text}, lower(btrim(customer))) > 0)
              OR (length(btrim(name)) >= ${MIN_NAME_LENGTH} AND strpos(${text}, lower(btrim(name))) > 0)
            )
            ORDER BY updated_at DESC
            LIMIT ${CANDIDATES}`
        : Promise.resolve([]),
      showProposals
        ? prisma.$queryRaw<IdRow[]>`
            SELECT id FROM proposals
            WHERE org_id = ${ctx.orgId}::uuid AND deleted_at IS NULL
              AND length(btrim(name)) >= ${MIN_NAME_LENGTH}
              AND strpos(${text}, lower(btrim(name))) > 0
            ORDER BY updated_at DESC
            LIMIT ${CANDIDATES}`
        : Promise.resolve([]),
    ]);
    const [matchedOpps, matchedProposals] = await Promise.all([
      oppHits.length === 0
        ? Promise.resolve([])
        : prisma.opportunity.findMany({
            where: { orgId: ctx.orgId, deletedAt: null, id: { in: oppHits.map((r) => r.id) } },
            select: { id: true, code: true, name: true, customer: true, companyId: true, dueDate: true },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          }),
      proposalHits.length === 0
        ? Promise.resolve([])
        : prisma.proposal.findMany({
            where: {
              orgId: ctx.orgId,
              deletedAt: null,
              id: { in: proposalHits.map((r) => r.id) },
              ...proposalOwnerWhere(ctx),
            },
            select: { id: true, name: true, dueDate: true },
            orderBy: { updatedAt: 'desc' },
            take: 3,
          }),
    ]);

    const citations: AgentCitation[] = [
      ...accounts.map((a) => ({ kind: 'account' as const, label: a.name, href: `/accounts/${a.id}` })),
      ...matchedOpps.map(oppCitation),
      ...matchedProposals.map((p) => ({
        kind: 'proposal' as const,
        label: p.name,
        href: `/proposals/${p.id}`,
        date: isoDate(p.dueDate),
      })),
    ];

    return {
      accounts,
      opportunities: matchedOpps.map((o) => ({
        id: o.id,
        code: o.code,
        name: o.name,
        customer: o.customer,
      })),
      proposals: matchedProposals.map((p) => ({ id: p.id, name: p.name })),
      citations,
    };
  },
};

const UpdatesInput = z.object({
  accountId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(14),
});

export const accountUpdates: AgentTool<typeof UpdatesInput> = {
  description:
    'What changed on an account: timeline events (stage moves, edits), activities (calls, meetings, notes) and new tasks across the account and its opportunities over the last N days (default 14).',
  input: UpdatesInput,
  kind: 'read',
  permission: 'accounts:read',
  inputJsonSchema: {
    type: 'object',
    required: ['accountId'],
    properties: {
      accountId: { type: 'string', format: 'uuid' },
      days: { type: 'integer', minimum: 1, maximum: 90, default: 14 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const company = await prisma.company.findFirst({
      where: { id: args.accountId, orgId: ctx.orgId },
      select: { id: true, name: true },
    });
    if (!company) throw new Error('Account not found');

    const since = new Date(Date.now() - args.days * 86_400_000);
    const opps = await prisma.opportunity.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null,
        OR: [
          { companyId: company.id },
          { customer: { equals: company.name, mode: 'insensitive' } },
        ],
      },
      select: { id: true, code: true, name: true, stage: true, dueDate: true },
      take: 50,
    });
    const oppIds = opps.map((o) => o.id);
    const oppById = new Map(opps.map((o) => [o.id, o]));

    const [activities, audits, tasks] = await Promise.all([
      prisma.activity.findMany({
        where: {
          orgId: ctx.orgId,
          deletedAt: null,
          occurredAt: { gte: since },
          OR: [
            { entityType: { in: ['company', 'account'] }, entityId: company.id },
            { entityType: 'opportunity', entityId: { in: oppIds } },
          ],
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 50,
        include: { owner: { select: { name: true } } },
      }),
      prisma.auditLog.findMany({
        where: {
          orgId: ctx.orgId,
          targetType: 'opportunity',
          targetId: { in: oppIds },
          at: { gte: since },
        },
        orderBy: { at: 'desc' },
        take: 50,
        include: { user: { select: { name: true } } },
      }),
      prisma.task.findMany({
        where: {
          orgId: ctx.orgId,
          deletedAt: null,
          createdAt: { gte: since },
          OR: [{ oppId: { in: oppIds } }, { accountId: company.id }],
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { assignee: { select: { name: true } } },
      }),
    ]);

    const recordFor = (oppId: string | null | undefined) => {
      const opp = oppId ? oppById.get(oppId) : undefined;
      return opp ? `${opp.code}` : company.name;
    };

    const events = [
      ...activities.map((a) => ({
        date: a.occurredAt.toISOString(),
        kind: a.type as string,
        record: a.entityType === 'opportunity' ? recordFor(a.entityId) : company.name,
        text: activityText(a),
        actor: a.owner?.name ?? null,
      })),
      ...audits.map((l) => ({
        date: l.at.toISOString(),
        kind: 'audit',
        record: recordFor(l.targetId),
        text: auditText(l.action, l.diff as Record<string, unknown> | null),
        actor: l.user?.name ?? null,
      })),
      ...tasks.map((t) => ({
        date: t.createdAt.toISOString(),
        kind: 'task',
        record: recordFor(t.oppId),
        text: `Task created: ${t.title}`,
        actor: t.assignee?.name ?? null,
      })),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 40);

    return {
      account: company,
      windowDays: args.days,
      since: since.toISOString().slice(0, 10),
      events,
      opportunities: opps.map((o) => ({
        code: o.code,
        name: o.name,
        stage: o.stage,
        dueDate: isoDate(o.dueDate),
      })),
      citations: [
        { kind: 'account' as const, label: company.name, href: `/accounts/${company.id}` },
        ...opps.slice(0, 5).map(oppCitation),
      ],
    };
  },
};
