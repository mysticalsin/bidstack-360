import { z } from 'zod';

export const TaskStatus = z.enum(['open', 'in_progress', 'done', 'blocked']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string().uuid(),
  oppId: z.string().uuid().nullable(),
  title: z.string().min(1),
  dueDate: z.string().date().nullable(),
  status: TaskStatus,
  assignee: z.string().email().nullable(),
  createdAt: z.string().datetime(),
});
export type Task = z.infer<typeof Task>;

export const TaskCreate = Task.omit({ id: true, createdAt: true }).extend({
  status: TaskStatus.default('open'),
});
export type TaskCreate = z.infer<typeof TaskCreate>;
