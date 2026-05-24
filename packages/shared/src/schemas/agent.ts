import { z } from 'zod';

import { AgentConfig } from './rfp-agent.js';

export const AgentStatus = z.enum(['idle', 'running', 'error', 'disabled']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentRunStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

export const Agent = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable(),
  systemPrompt: z.string().max(10000),
  tools: z.array(z.record(z.unknown())).default([]),
  status: AgentStatus,
  scheduleCron: z.string().max(100).nullable(),
  lastRunAt: z.string().datetime().nullable(),
  config: AgentConfig.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentCreate = Agent.omit({
  id: true,
  orgId: true,
  status: true,
  lastRunAt: true,
  createdAt: true,
  updatedAt: true,
});
export type AgentCreate = z.infer<typeof AgentCreate>;

export const AgentPatch = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).nullable().optional(),
    systemPrompt: z.string().max(10000).optional(),
    tools: z.array(z.record(z.unknown())).optional(),
    status: AgentStatus.optional(),
    scheduleCron: z.string().max(100).nullable().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type AgentPatch = z.infer<typeof AgentPatch>;

export const AgentRun = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  agentId: z.string().uuid(),
  status: AgentRunStatus,
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).nullable(),
  costMicros: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AgentRun = z.infer<typeof AgentRun>;

export const AgentRunCreate = z.object({
  input: z.record(z.unknown()).default({}),
});
export type AgentRunCreate = z.infer<typeof AgentRunCreate>;

export const AgentListResult = z.object({
  items: z.array(Agent),
  nextCursor: z.string().uuid().optional(),
});
export type AgentListResult = z.infer<typeof AgentListResult>;

export const AgentRunListResult = z.object({
  items: z.array(AgentRun),
  nextCursor: z.string().uuid().optional(),
});
export type AgentRunListResult = z.infer<typeof AgentRunListResult>;
