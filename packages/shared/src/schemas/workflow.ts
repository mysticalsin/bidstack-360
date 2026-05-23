import { z } from 'zod';

export const WorkflowTriggerKind = z.enum([
  'record_created',
  'record_updated',
  'stage_changed',
  'schedule',
  'webhook_received',
  'manual',
]);
export type WorkflowTriggerKind = z.infer<typeof WorkflowTriggerKind>;

export const WorkflowActionKind = z.enum([
  'send_email',
  'send_slack',
  'create_task',
  'update_field',
  'call_webhook',
  'assign_owner',
  'run_dust_agent',
  'create_notification',
]);
export type WorkflowActionKind = z.infer<typeof WorkflowActionKind>;

export const WorkflowAction = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  kind: WorkflowActionKind,
  config: z.record(z.unknown()).default({}),
  sortOrder: z.number().int().default(0),
  createdAt: z.string().datetime(),
});
export type WorkflowAction = z.infer<typeof WorkflowAction>;

export const Workflow = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable(),
  active: z.boolean().default(true),
  triggerKind: WorkflowTriggerKind,
  triggerConfig: z.record(z.unknown()).default({}),
  actions: z.array(WorkflowAction).default([]),
  runCount: z.number().int().default(0),
  lastRunAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Workflow = z.infer<typeof Workflow>;

export const WorkflowRunStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled']);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;

export const WorkflowRun = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  workflowId: z.string().uuid(),
  status: WorkflowRunStatus,
  triggerRecordType: z.string().nullable(),
  triggerRecordId: z.string().uuid().nullable(),
  input: z.record(z.unknown()).default({}),
  output: z.record(z.unknown()).default({}),
  error: z.string().nullable(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type WorkflowRun = z.infer<typeof WorkflowRun>;

export const WorkflowCreate = Workflow.omit({
  id: true,
  orgId: true,
  runCount: true,
  lastRunAt: true,
  createdAt: true,
  updatedAt: true,
  actions: true,
}).extend({
  actions: z
    .array(
      z.object({
        kind: WorkflowActionKind,
        config: z.record(z.unknown()).default({}),
        sortOrder: z.number().int().default(0),
      }),
    )
    .max(50)
    .default([]),
});
export type WorkflowCreate = z.infer<typeof WorkflowCreate>;
