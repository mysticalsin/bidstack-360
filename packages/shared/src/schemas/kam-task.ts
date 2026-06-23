/**
 * kam-task.ts — Initiative-scoped KAM tasks + the per-account to-do roll-up.
 *
 * Tasks are the to-do items the group Opportunity-Management tool lacks: every
 * initiative carries a small handful (1–3 expected). The per-account to-do view
 * aggregates open tasks across ALL of an account's initiatives so an owner opens
 * one account and sees everything outstanding.
 */
import { z } from 'zod';

export const KAM_TASK_STATUSES = ['open', 'in_progress', 'done', 'blocked'] as const;
export const KAM_TASK_TYPES = [
  'prospection',
  'follow_up',
  'proposal_prep',
  'internal',
  'other',
] as const;

const StatusEnum = z.enum(KAM_TASK_STATUSES);
const TypeEnum = z.enum(KAM_TASK_TYPES);

export const KamTaskCreate = z.object({
  title: z.string().min(1).max(300),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  type: TypeEnum.optional(),
});
export type KamTaskCreate = z.infer<typeof KamTaskCreate>;

export const KamTaskPatch = z.object({
  title: z.string().min(1).max(300).optional(),
  status: StatusEnum.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  type: TypeEnum.nullable().optional(),
});
export type KamTaskPatch = z.infer<typeof KamTaskPatch>;

export const KamTaskDetail = z.object({
  id: z.string().uuid(),
  initiativeId: z.string().uuid().nullable(),
  accountId: z.string().uuid().nullable(),
  title: z.string(),
  status: StatusEnum,
  type: z.string().nullable(),
  assigneeId: z.string().uuid().nullable(),
  dueDate: z.string().nullable(),
  createdAt: z.string(),
});
export type KamTaskDetail = z.infer<typeof KamTaskDetail>;

export const KamTaskList = z.object({ items: z.array(KamTaskDetail) });

/** One row of the per-account to-do view: a task plus its owning initiative. */
export const KamAccountTodoItem = KamTaskDetail.extend({
  initiativeTitle: z.string(),
  initiativeStage: z.enum(['initiative', 'lead', 'opportunity', 'dropped']),
});

/**
 * Per-account to-do roll-up. `staleInitiativeIds` / `overloadedInitiativeIds`
 * surface the soft 1–3-tasks-per-initiative hint (0 open = stale, >3 open =
 * overloaded) without hard-blocking task creation.
 */
export const KamAccountTodos = z.object({
  companyId: z.string().uuid(),
  openCount: z.number().int(),
  doneCount: z.number().int(),
  items: z.array(KamAccountTodoItem),
  staleInitiativeIds: z.array(z.string().uuid()),
  overloadedInitiativeIds: z.array(z.string().uuid()),
});
export type KamAccountTodos = z.infer<typeof KamAccountTodos>;
