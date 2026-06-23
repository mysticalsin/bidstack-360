/**
 * kam-tools.ts — KAM MCP tools for Dust agents.
 *
 * The write tools require the dedicated `kam` scope (NOT `write`), so a KAM
 * agent key can ingest transcripts + propose drafts but can NEVER call the
 * canonical-write tools (leads.create, notes.create, …) that bypass the human
 * gate. Writes here target STAGING only: a KamSession (transcript container) or
 * a pending KamSessionDraft. Committing to canonical Initiatives/Tasks happens
 * ONLY via the human approve endpoint (REST, humans-only) — never from an agent.
 */
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

// ─── Reads ───────────────────────────────────────────────────────────────────

const ListAccountsInput = z.object({
  status: z.enum(['identified', 'kickoff', 'mapped', 'active', 'paused', 'closed']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const kamListAccounts: Tool<typeof ListAccountsInput> = {
  description: 'List Key Account Management accounts (companies) with their KAM status.',
  input: ListAccountsInput,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['identified', 'kickoff', 'mapped', 'active', 'paused', 'closed'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const rows = await prisma.company.findMany({
      where: { orgId: ctx.orgId, deletedAt: null, ...(args.status ? { kamStatus: args.status } : {}) },
      select: { id: true, name: true, countryCode: true, kamStatus: true, kamOwnerModel: true },
      orderBy: { name: 'asc' },
      take: args.limit,
    });
    return { accounts: rows };
  },
};

const ListInitiativesInput = z.object({
  companyId: z.string().uuid(),
  stage: z.enum(['initiative', 'lead', 'opportunity', 'dropped']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const kamListInitiatives: Tool<typeof ListInitiativesInput> = {
  description: "List a KAM account's initiatives, optionally filtered by stage.",
  input: ListInitiativesInput,
  inputJsonSchema: {
    type: 'object',
    required: ['companyId'],
    properties: {
      companyId: { type: 'string', format: 'uuid' },
      stage: { type: 'string', enum: ['initiative', 'lead', 'opportunity', 'dropped'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const company = await prisma.company.findFirst({
      where: { id: args.companyId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new Error('Account not found');
    const rows = await prisma.kamInitiative.findMany({
      where: { orgId: ctx.orgId, companyId: args.companyId, deletedAt: null, ...(args.stage ? { stage: args.stage } : {}) },
      select: { id: true, title: true, stage: true, priority: true, lastActivityAt: true },
      orderBy: { lastActivityAt: 'desc' },
      take: args.limit,
    });
    return { initiatives: rows.map((r) => ({ ...r, lastActivityAt: r.lastActivityAt.toISOString() })) };
  },
};

// ─── Staging writes (scope: kam) ──────────────────────────────────────────────

const IngestTranscriptInput = z.object({
  companyId: z.string().uuid(),
  title: z.string().max(300).optional(),
  heldAt: z.string().datetime().optional(),
  sourceType: z.enum(['manual_paste', 'sharepoint_pull', 'dust_push']).default('dust_push'),
  sourceRef: z.string().max(2000).optional(),
  transcriptText: z.string().min(1).max(500_000),
});

export const kamIngestTranscript: Tool<typeof IngestTranscriptInput> = {
  description:
    'Ingest a workshop transcript into a new KAM session (staging container). Does NOT commit any initiatives or tasks — call kam_propose_session_draft next, then a human approves.',
  input: IngestTranscriptInput,
  inputJsonSchema: {
    type: 'object',
    required: ['companyId', 'transcriptText'],
    properties: {
      companyId: { type: 'string', format: 'uuid' },
      title: { type: 'string', maxLength: 300 },
      heldAt: { type: 'string', format: 'date-time' },
      sourceType: { type: 'string', enum: ['manual_paste', 'sharepoint_pull', 'dust_push'] },
      sourceRef: { type: 'string', maxLength: 2000 },
      transcriptText: { type: 'string', minLength: 1, maxLength: 500000 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const company = await prisma.company.findFirst({
      where: { id: args.companyId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new Error('Account not found');
    const session = await prisma.kamSession.create({
      data: {
        orgId: ctx.orgId,
        companyId: args.companyId,
        title: args.title ?? null,
        heldAt: args.heldAt ? new Date(args.heldAt) : new Date(),
        sourceType: args.sourceType,
        sourceRef: args.sourceRef ?? null,
        transcriptText: args.transcriptText,
      },
      select: { id: true },
    });
    return { sessionId: session.id, status: 'staged' };
  },
};

const ProposeDraftInput = z.object({
  sessionId: z.string().uuid(),
  noteDraft: z.object({
    summary: z.string().max(10_000),
    keyPoints: z.array(z.string().max(2000)).max(100).default([]),
    decisions: z.array(z.string().max(2000)).max(100).default([]),
    attendees: z.array(z.string().max(200)).max(100).default([]),
  }),
  initiativeDrafts: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        description: z.string().max(5000).optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      }),
    )
    .max(50)
    .default([]),
  taskDrafts: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        type: z.enum(['prospection', 'follow_up', 'proposal_prep', 'internal', 'other']).optional(),
        initiativeIndex: z.number().int().min(0),
      }),
    )
    .max(150)
    .default([]),
  lowConfidence: z
    .array(z.object({ term: z.string().max(500), context: z.string().max(2000).optional() }))
    .max(100)
    .default([]),
});

export const kamProposeSessionDraft: Tool<typeof ProposeDraftInput> = {
  description:
    'Propose an AI-organized note + extracted to-do list for a session. Lands in a PENDING staging draft for human review — NEVER commits to live data. A human must approve via the CRM before anything is created.',
  input: ProposeDraftInput,
  inputJsonSchema: {
    type: 'object',
    required: ['sessionId', 'noteDraft'],
    properties: {
      sessionId: { type: 'string', format: 'uuid' },
      noteDraft: { type: 'object' },
      initiativeDrafts: { type: 'array' },
      taskDrafts: { type: 'array' },
      lowConfidence: { type: 'array' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const session = await prisma.kamSession.findFirst({
      where: { id: args.sessionId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true, companyId: true },
    });
    if (!session) throw new Error('Session not found');
    const draft = await prisma.kamSessionDraft.create({
      data: {
        orgId: ctx.orgId,
        companyId: session.companyId,
        sessionId: session.id,
        status: 'pending',
        source: 'dust_mcp',
        noteDraft: args.noteDraft,
        initiativeDrafts: args.initiativeDrafts,
        taskDrafts: args.taskDrafts,
        lowConfidence: args.lowConfidence,
      },
      select: { id: true },
    });
    return { draftId: draft.id, status: 'pending', note: 'Awaiting human review + approval. Nothing committed.' };
  },
};

const UpdateTaskStatusInput = z.object({
  taskId: z.string().uuid(),
  status: z.enum(['open', 'in_progress', 'done', 'blocked']),
});

export const kamUpdateTaskStatus: Tool<typeof UpdateTaskStatusInput> = {
  description: "Update the status of an existing KAM task (e.g. mark a to-do done). Operates only on KAM tasks (those attached to an initiative/account).",
  input: UpdateTaskStatusInput,
  inputJsonSchema: {
    type: 'object',
    required: ['taskId', 'status'],
    properties: {
      taskId: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['open', 'in_progress', 'done', 'blocked'] },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const task = await prisma.task.findFirst({
      where: { id: args.taskId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true, initiativeId: true, accountId: true },
    });
    if (!task || (!task.initiativeId && !task.accountId)) throw new Error('KAM task not found');
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { status: args.status },
      select: { id: true, status: true },
    });
    if (task.initiativeId) {
      await prisma.kamInitiative.updateMany({
        where: { id: task.initiativeId, orgId: ctx.orgId },
        data: { lastActivityAt: new Date() },
      });
    }
    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        userId: null,
        action: 'kam_task.status_update',
        targetType: 'task',
        targetId: task.id,
        diff: { status: args.status, via: 'mcp' },
      },
    });
    return { id: updated.id, status: updated.status };
  },
};

// ─── KPIs + prospection (S6) ──────────────────────────────────────────────

const GetKpisInput = z.object({ companyId: z.string().uuid() });

export const kamGetKpis: Tool<typeof GetKpisInput> = {
  description: "Per-account KAM KPIs: initiatives by stage, open/done tasks, prospection count, stale-initiative count.",
  input: GetKpisInput,
  inputJsonSchema: {
    type: 'object',
    required: ['companyId'],
    properties: { companyId: { type: 'string', format: 'uuid' } },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const company = await prisma.company.findFirst({
      where: { id: args.companyId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new Error('Account not found');
    const threshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const [stageGroups, openTasks, doneTasks, prospectionCount, staleCount] = await Promise.all([
      prisma.kamInitiative.groupBy({ by: ['stage'], where: { orgId: ctx.orgId, companyId: args.companyId, deletedAt: null }, _count: { _all: true } }),
      prisma.task.count({ where: { orgId: ctx.orgId, accountId: args.companyId, deletedAt: null, status: { not: 'done' } } }),
      prisma.task.count({ where: { orgId: ctx.orgId, accountId: args.companyId, deletedAt: null, status: 'done' } }),
      prisma.kamProspection.count({ where: { orgId: ctx.orgId, companyId: args.companyId, deletedAt: null } }),
      prisma.kamInitiative.count({ where: { orgId: ctx.orgId, companyId: args.companyId, deletedAt: null, stage: { in: ['initiative', 'lead'] }, lastActivityAt: { lt: threshold } } }),
    ]);
    const byStage = { initiative: 0, lead: 0, opportunity: 0, dropped: 0 };
    for (const g of stageGroups) byStage[g.stage] = g._count._all;
    return { companyId: args.companyId, initiativesByStage: byStage, openTasks, doneTasks, prospectionCount, staleInitiativeCount: staleCount };
  },
};

const ReadProspectionsInput = z.object({
  companyId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(100),
});

export const kamReadProspections: Tool<typeof ReadProspectionsInput> = {
  description: 'Read prospection actions (the director KPI) mirrored from ABC for an account.',
  input: ReadProspectionsInput,
  inputJsonSchema: {
    type: 'object',
    required: ['companyId'],
    properties: { companyId: { type: 'string', format: 'uuid' }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const rows = await prisma.kamProspection.findMany({
      where: { orgId: ctx.orgId, companyId: args.companyId, deletedAt: null },
      orderBy: { occurredAt: 'desc' },
      take: args.limit,
      select: { id: true, actionType: true, occurredAt: true, ownerId: true, source: true, externalId: true },
    });
    return { prospections: rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })) };
  },
};

const LogProspectionInput = z.object({
  companyId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  actionType: z.string().min(1).max(100),
  occurredAt: z.string().datetime().optional(),
});

export const kamLogProspection: Tool<typeof LogProspectionInput> = {
  description:
    'Log a prospection action into the mirror (source=manual), pending sync to ABC (the system of record). Does NOT write to ABC directly.',
  input: LogProspectionInput,
  inputJsonSchema: {
    type: 'object',
    required: ['companyId', 'actionType'],
    properties: {
      companyId: { type: 'string', format: 'uuid' },
      ownerId: { type: 'string', format: 'uuid' },
      actionType: { type: 'string', minLength: 1, maxLength: 100 },
      occurredAt: { type: 'string', format: 'date-time' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const company = await prisma.company.findFirst({
      where: { id: args.companyId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new Error('Account not found');
    if (args.ownerId) {
      const owner = await prisma.user.findFirst({ where: { id: args.ownerId, orgId: ctx.orgId, deletedAt: null }, select: { id: true } });
      if (!owner) throw new Error('Owner not found');
    }
    const created = await prisma.kamProspection.create({
      data: {
        orgId: ctx.orgId,
        companyId: args.companyId,
        ownerId: args.ownerId ?? null,
        actionType: args.actionType,
        occurredAt: args.occurredAt ? new Date(args.occurredAt) : new Date(),
        source: 'manual',
        syncedAt: new Date(),
      },
      select: { id: true },
    });
    return { id: created.id, source: 'manual', note: 'Logged to mirror — pending sync to ABC (system of record).' };
  },
};
