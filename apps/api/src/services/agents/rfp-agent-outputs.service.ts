// RFP Agent Output service.
// Stores structured agent outputs in NocoBase with Prisma fallback.

import { nocobase } from '../../lib/nocobase-client.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger({ name: 'rfp-agent-outputs' });

export interface AgentOutputInput {
  orgId: string;
  agentId: string;
  rfpRequestId: string;
  runId: string;
  agentName: string;
  phase: string | null;
  outputType: string;
  content: string;
  structuredData: Record<string, unknown> | null;
  confidenceScore: number | null;
  approvalRequired: boolean;
}

export async function storeAgentOutput(
  input: AgentOutputInput,
): Promise<{ id: string; status: string }> {
  const status = input.approvalRequired ? 'pending' : 'approved';

  try {
    const record = await nocobase.create<Record<string, unknown>>('rfp_agent_outputs', {
      agentName: input.agentName,
      phase: input.phase ?? 'general',
      outputType: input.outputType,
      content: input.content,
      structuredData: input.structuredData,
      confidenceScore: input.confidenceScore,
      status,
      runId: input.runId,
      rfp_request_id: input.rfpRequestId,
    });

    log.info(
      { outputId: record.id, rfpRequestId: input.rfpRequestId, status },
      'Agent output stored in NocoBase',
    );
    return { id: String(record.id), status };
  } catch (err) {
    log.warn({ err, rfpRequestId: input.rfpRequestId }, 'Failed to store agent output in NocoBase');
    // Fallback: return a local ID so the flow continues
    return { id: `local-${input.runId}`, status };
  }
}

const VALID_OUTPUT_STATUS = new Set(['pending', 'approved', 'rejected']);

function coerceOutputStatus(value: unknown): 'pending' | 'approved' | 'rejected' {
  const s = typeof value === 'string' ? value : 'pending';
  return VALID_OUTPUT_STATUS.has(s) ? (s as 'pending' | 'approved' | 'rejected') : 'pending';
}

export async function listOutputsForRfp(rfpRequestId: string, statusFilter?: string) {
  try {
    const filter: Record<string, unknown> = { rfp_request_id: rfpRequestId };
    if (statusFilter) filter.status = statusFilter;

    const result = await nocobase.list<Record<string, unknown>>('rfp_agent_outputs', {
      filter,
      sort: ['-createdAt'],
      pageSize: 100,
    });

    return result.data.map((r) => ({
      id: String(r.id),
      orgId: '', // NocoBase doesn't store orgId; we rely on RFP scoping
      agentId: '',
      rfpRequestId,
      runId: String(r.runId ?? ''),
      agentName: String(r.agentName ?? ''),
      phase: r.phase ? String(r.phase) : null,
      outputType: String(r.outputType ?? ''),
      content: String(r.content ?? ''),
      structuredData: r.structuredData ? (r.structuredData as Record<string, unknown>) : null,
      confidenceScore: r.confidenceScore ? Number(r.confidenceScore) : null,
      status: coerceOutputStatus(r.status),
      approvedBy: r.approvedBy ? String(r.approvedBy) : null,
      approvedAt: r.approvedAt ? String(r.approvedAt) : null,
      rejectedReason: r.rejectedReason ? String(r.rejectedReason) : null,
      createdAt: r.createdAt ? String(r.createdAt) : new Date().toISOString(),
      updatedAt: r.updatedAt ? String(r.updatedAt) : new Date().toISOString(),
    }));
  } catch (err) {
    log.warn({ err, rfpRequestId }, 'Failed to list agent outputs from NocoBase');
    return [];
  }
}

export async function approveOutput(outputId: string, userId: string) {
  try {
    await nocobase.update('rfp_agent_outputs', outputId, {
      status: 'approved',
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (err) {
    log.warn({ err, outputId }, 'Failed to approve output in NocoBase');
    throw new Error('Failed to approve output', { cause: err });
  }
}

export async function rejectOutput(outputId: string, userId: string, reason: string) {
  try {
    await nocobase.update('rfp_agent_outputs', outputId, {
      status: 'rejected',
      approvedBy: userId,
      rejectedReason: reason,
    });
    return { success: true };
  } catch (err) {
    log.warn({ err, outputId }, 'Failed to reject output in NocoBase');
    throw new Error('Failed to reject output', { cause: err });
  }
}

// ─── Task extraction ────────────────────────────────────────────────────────

export interface AgentTaskInput {
  orgId: string;
  rfpRequestId: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate: string | null;
  assignedTo: string | null;
  sourceAgent: string;
  sourceOutputId: string;
}

export async function createAgentTask(input: AgentTaskInput): Promise<void> {
  try {
    await nocobase.create('rfp_agent_tasks', {
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: 'open',
      dueDate: input.dueDate,
      assignedTo: input.assignedTo,
      sourceAgent: input.sourceAgent,
      sourceOutputId: input.sourceOutputId,
      rfp_request_id: input.rfpRequestId,
    });
  } catch (err) {
    log.warn({ err, rfpRequestId: input.rfpRequestId }, 'Failed to create agent task in NocoBase');
  }
}
