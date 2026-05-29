// RFP Agent Assignment service.
// Links BidStack agents to NocoBase RFP requests and builds prompt context.

import type { Prisma } from '@bidstack/db';
import { prisma } from '@bidstack/db';

import { nocobase } from '../../lib/nocobase-client.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger({ name: 'rfp-agent-assignments' });

// ─── Serialization ──────────────────────────────────────────────────────────

function serializeAssignment(a: Prisma.RfpAgentAssignmentGetPayload<{ include: { agent: true } }>) {
  return {
    id: a.id,
    orgId: a.orgId,
    agentId: a.agentId,
    rfpRequestId: a.rfpRequestId,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    agent: {
      id: a.agent.id,
      name: a.agent.name,
      description: a.agent.description,
      systemPrompt: a.agent.systemPrompt,
      status: a.agent.status,
      config: a.agent.config as Record<string, unknown>,
      scheduleCron: a.agent.scheduleCron,
      lastRunAt: a.agent.lastRunAt?.toISOString() ?? null,
    },
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function listAssignmentsForRfp(orgId: string, rfpRequestId: string) {
  const items = await prisma.rfpAgentAssignment.findMany({
    where: { orgId, rfpRequestId, deletedAt: null },
    include: { agent: true },
    orderBy: { createdAt: 'desc' },
  });
  return { items: items.map(serializeAssignment) };
}

export async function assignAgentToRfp(orgId: string, agentId: string, rfpRequestId: string) {
  // Verify agent exists and belongs to org
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, orgId, deletedAt: null },
  });
  if (!agent) throw new Error('Agent not found');

  // Prevent duplicate active assignment
  const existing = await prisma.rfpAgentAssignment.findFirst({
    where: { orgId, agentId, rfpRequestId, deletedAt: null },
  });
  if (existing) {
    if (existing.status === 'paused') {
      const updated = await prisma.rfpAgentAssignment.update({
        where: { id: existing.id },
        data: { status: 'active', updatedAt: new Date() },
        include: { agent: true },
      });
      return serializeAssignment(updated);
    }
    throw new Error('Agent is already assigned to this RFP');
  }

  const created = await prisma.rfpAgentAssignment.create({
    data: { orgId, agentId, rfpRequestId, status: 'active' },
    include: { agent: true },
  });

  log.info({ orgId, agentId, rfpRequestId }, 'Agent assigned to RFP');
  return serializeAssignment(created);
}

export async function unassignAgentFromRfp(orgId: string, assignmentId: string) {
  const assignment = await prisma.rfpAgentAssignment.findFirst({
    where: { id: assignmentId, orgId, deletedAt: null },
  });
  if (!assignment) throw new Error('Assignment not found');

  await prisma.rfpAgentAssignment.update({
    where: { id: assignmentId },
    data: { deletedAt: new Date(), status: 'paused' },
  });

  log.info({ orgId, assignmentId }, 'Agent unassigned from RFP');
  return { success: true };
}

// ─── RFP Context for Prompt Injection ───────────────────────────────────────

export interface RfpContext {
  rfp: {
    id: string;
    name: string;
    status: string;
    submissionDeadline: string | null;
    questionDeadline: string | null;
    industry: string | null;
    region: string | null;
    priority: string;
    aiSummary: string | null;
  };
  documents: Array<{
    id: string;
    name: string;
    fileType: string;
    version: number;
    parsedText: string | null;
    pageCount: number | null;
  }>;
  sections: Array<{
    id: string;
    title: string;
    sectionNumber: string | null;
    sectionType: string;
    importanceLevel: string;
    riskLevel: string;
    rawText: string | null;
    aiSummary: string | null;
  }>;
}

export async function getRfpContextForAgent(rfpRequestId: string): Promise<RfpContext | null> {
  try {
    const rfp = await nocobase.get<Record<string, unknown>>('rfp_requests', rfpRequestId, {
      appends: ['documents', 'sections'],
    });

    const docs = (rfp.documents as Array<Record<string, unknown>> | undefined) ?? [];
    const secs = (rfp.sections as Array<Record<string, unknown>> | undefined) ?? [];

    return {
      rfp: {
        id: String(rfp.id),
        name: String(rfp.name ?? ''),
        status: String(rfp.status ?? ''),
        submissionDeadline: rfp.submissionDeadline ? String(rfp.submissionDeadline) : null,
        questionDeadline: rfp.questionDeadline ? String(rfp.questionDeadline) : null,
        industry: rfp.industry ? String(rfp.industry) : null,
        region: rfp.region ? String(rfp.region) : null,
        priority: String(rfp.priority ?? ''),
        aiSummary: rfp.aiSummary ? String(rfp.aiSummary) : null,
      },
      documents: docs.map((d) => ({
        id: String(d.id),
        name: String(d.name ?? ''),
        fileType: String(d.fileType ?? ''),
        version: Number(d.version ?? 1),
        parsedText: d.parsedText ? String(d.parsedText) : null,
        pageCount: d.pageCount ? Number(d.pageCount) : null,
      })),
      sections: secs.map((s) => ({
        id: String(s.id),
        title: String(s.title ?? ''),
        sectionNumber: s.sectionNumber ? String(s.sectionNumber) : null,
        sectionType: String(s.sectionType ?? ''),
        importanceLevel: String(s.importanceLevel ?? ''),
        riskLevel: String(s.riskLevel ?? ''),
        rawText: s.rawText ? String(s.rawText) : null,
        aiSummary: s.aiSummary ? String(s.aiSummary) : null,
      })),
    };
  } catch (err) {
    log.warn({ err, rfpRequestId }, 'Failed to fetch RFP context from NocoBase');
    return null;
  }
}

export function buildRfpContextBlock(ctx: RfpContext, maxChars = 12000): string {
  const lines: string[] = [];
  lines.push('=== RFP CONTEXT ===');
  lines.push(`Name: ${ctx.rfp.name}`);
  lines.push(`Status: ${ctx.rfp.status}`);
  lines.push(`Priority: ${ctx.rfp.priority}`);
  if (ctx.rfp.submissionDeadline) lines.push(`Submission Deadline: ${ctx.rfp.submissionDeadline}`);
  if (ctx.rfp.questionDeadline) lines.push(`Question Deadline: ${ctx.rfp.questionDeadline}`);
  if (ctx.rfp.industry) lines.push(`Industry: ${ctx.rfp.industry}`);
  if (ctx.rfp.region) lines.push(`Region: ${ctx.rfp.region}`);
  if (ctx.rfp.aiSummary) lines.push(`AI Summary: ${ctx.rfp.aiSummary}`);

  if (ctx.documents.length > 0) {
    lines.push('');
    lines.push('--- DOCUMENTS ---');
    for (const doc of ctx.documents) {
      lines.push(
        `[${doc.name}] type=${doc.fileType} version=${doc.version} pages=${doc.pageCount ?? '?'}`,
      );
    }
  }

  if (ctx.sections.length > 0) {
    lines.push('');
    lines.push('--- SECTIONS ---');
    for (const sec of ctx.sections) {
      lines.push(
        `[${sec.sectionNumber ?? '?'}] ${sec.title} | type=${sec.sectionType} | importance=${sec.importanceLevel} | risk=${sec.riskLevel}`,
      );
      if (sec.aiSummary) lines.push(`  Summary: ${sec.aiSummary}`);
    }
  }

  let block = lines.join('\n');
  if (block.length > maxChars) {
    block = block.slice(0, maxChars) + '\n...[truncated]';
  }
  return block;
}
