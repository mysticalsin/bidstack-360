import { z } from 'zod';

import { AgentConfig } from './rfp-agent.js';

export const RfpAgentAssignmentStatus = z.enum(['active', 'paused']);
export type RfpAgentAssignmentStatus = z.infer<typeof RfpAgentAssignmentStatus>;

export const RfpAgentAssignment = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  agentId: z.string().uuid(),
  rfpRequestId: z.string(),
  status: RfpAgentAssignmentStatus,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RfpAgentAssignment = z.infer<typeof RfpAgentAssignment>;

export const RfpAgentAssignmentWithAgent = RfpAgentAssignment.extend({
  agent: z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    systemPrompt: z.string(),
    status: z.enum(['idle', 'running', 'error', 'disabled']),
    config: AgentConfig.default({}),
    scheduleCron: z.string().nullable(),
    lastRunAt: z.string().datetime().nullable(),
  }),
});
export type RfpAgentAssignmentWithAgent = z.infer<typeof RfpAgentAssignmentWithAgent>;

export const RfpAgentAssignmentCreate = z.object({
  agentId: z.string().uuid(),
  rfpRequestId: z.string().min(1),
});
export type RfpAgentAssignmentCreate = z.infer<typeof RfpAgentAssignmentCreate>;

export const RfpAgentAssignmentListResult = z.object({
  items: z.array(RfpAgentAssignmentWithAgent),
});
export type RfpAgentAssignmentListResult = z.infer<typeof RfpAgentAssignmentListResult>;

// ─── Agent Output (stored in NocoBase + Prisma fallback) ────────────────────

export const RfpAgentOutputStatus = z.enum(['pending', 'approved', 'rejected']);
export type RfpAgentOutputStatus = z.infer<typeof RfpAgentOutputStatus>;

export const RfpAgentOutput = z.object({
  id: z.string(),
  orgId: z.string().uuid(),
  agentId: z.string().uuid(),
  rfpRequestId: z.string(),
  runId: z.string().uuid(),
  agentName: z.string(),
  phase: z.string().nullable(),
  outputType: z.string(),
  content: z.string(),
  structuredData: z.record(z.unknown()).nullable(),
  confidenceScore: z.number().min(0).max(1).nullable(),
  status: RfpAgentOutputStatus,
  approvedBy: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  rejectedReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RfpAgentOutput = z.infer<typeof RfpAgentOutput>;

export const RfpAgentOutputListResult = z.object({
  items: z.array(RfpAgentOutput),
});
export type RfpAgentOutputListResult = z.infer<typeof RfpAgentOutputListResult>;

export const RfpAgentOutputApprove = z.object({
  status: z.literal('approved'),
});

export const RfpAgentOutputReject = z.object({
  status: z.literal('rejected'),
  reason: z.string().min(1).max(2000),
});

// ─── Agent Task (extracted from agent outputs) ──────────────────────────────

export const RfpAgentTaskStatus = z.enum(['open', 'in_progress', 'done']);
export type RfpAgentTaskStatus = z.infer<typeof RfpAgentTaskStatus>;

export const RfpAgentTaskPriority = z.enum(['low', 'medium', 'high', 'critical']);
export type RfpAgentTaskPriority = z.infer<typeof RfpAgentTaskPriority>;

export const RfpAgentTask = z.object({
  id: z.string(),
  orgId: z.string().uuid(),
  rfpRequestId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: RfpAgentTaskPriority,
  status: RfpAgentTaskStatus,
  dueDate: z.string().datetime().nullable(),
  assignedTo: z.string().nullable(),
  sourceAgent: z.string(),
  sourceOutputId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RfpAgentTask = z.infer<typeof RfpAgentTask>;

export const RfpAgentTaskListResult = z.object({
  items: z.array(RfpAgentTask),
});
export type RfpAgentTaskListResult = z.infer<typeof RfpAgentTaskListResult>;
