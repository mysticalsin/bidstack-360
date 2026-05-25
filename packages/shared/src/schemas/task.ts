import { z } from 'zod';
import { CustomFieldValueLite, CustomFieldValueInput } from './custom-fields.js';

export const TaskStatus = z.enum(['open', 'in_progress', 'done', 'blocked']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string().uuid(),
  oppId: z.string().uuid().nullable(),
  title: z.string().min(1).max(255),
  dueDate: z.string().date().nullable(),
  status: TaskStatus,
  assignee: z.string().email().nullable(),
  createdAt: z.string().datetime(),
  customFieldValues: z.array(CustomFieldValueLite).optional(),
});
export type Task = z.infer<typeof Task>;

export const TaskCreate = Task.omit({ id: true, createdAt: true }).extend({
  status: TaskStatus.default('open'),
});
export type TaskCreate = z.infer<typeof TaskCreate>;

// PATCH body — every field optional, at least one required. The audit log
// captures the diff so the trail records intent (e.g. status flips).
export const TaskPatch = z
  .object({
    title: z.string().min(1).optional(),
    dueDate: z.string().date().nullable().optional(),
    status: TaskStatus.optional(),
    assignee: z.string().email().nullable().optional(),
    customFieldValues: z.array(CustomFieldValueInput).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type TaskPatch = z.infer<typeof TaskPatch>;

export const TaskFilter = z.object({
  oppId: z.string().uuid().optional(),
  status: TaskStatus.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type TaskFilter = z.infer<typeof TaskFilter>;

export const TaskPage = z.object({
  items: z.array(Task),
  nextCursor: z.string().nullable(),
});
export type TaskPage = z.infer<typeof TaskPage>;

export const TaskSummary = z.object({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  dueSoon: z.number().int().nonnegative(),
});
export type TaskSummary = z.infer<typeof TaskSummary>;
