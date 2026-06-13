// Cross-sell action log (A2) — structured, assignable cross-country/cross-team
// actions on a shared account. Pre-sales owns it; it is a tracked action list,
// not a chat thread.
import { z } from 'zod';

export const GovernanceStatus = z.enum(['open', 'in_progress', 'done']);
export type GovernanceStatus = z.infer<typeof GovernanceStatus>;

export const CrossSellAction = z.object({
  id: z.string().uuid(),
  accountKey: z.string().min(1),
  description: z.string().min(1).max(2000),
  requestingUnit: z.string().min(1).max(120),
  assignedUnit: z.string().min(1).max(120),
  assigneeId: z.string().uuid().nullable(),
  assigneeName: z.string().nullable(),
  dueDate: z.string().datetime().nullable(),
  status: GovernanceStatus,
  notes: z.string().max(4000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CrossSellAction = z.infer<typeof CrossSellAction>;

export const CrossSellActionCreate = z.object({
  accountKey: z.string().min(1).max(255),
  description: z.string().min(1).max(2000),
  requestingUnit: z.string().min(1).max(120),
  assignedUnit: z.string().min(1).max(120),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  status: GovernanceStatus.default('open'),
  notes: z.string().max(4000).nullable().optional(),
});
export type CrossSellActionCreate = z.infer<typeof CrossSellActionCreate>;

export const CrossSellActionPatch = z
  .object({
    description: z.string().min(1).max(2000).optional(),
    requestingUnit: z.string().min(1).max(120).optional(),
    assignedUnit: z.string().min(1).max(120).optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    status: GovernanceStatus.optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type CrossSellActionPatch = z.infer<typeof CrossSellActionPatch>;

export const CrossSellActionFilter = z.object({
  accountKey: z.string().max(255).optional(),
  status: GovernanceStatus.optional(),
});
export type CrossSellActionFilter = z.infer<typeof CrossSellActionFilter>;

export const CrossSellActionPage = z.object({
  items: z.array(CrossSellAction),
});
export type CrossSellActionPage = z.infer<typeof CrossSellActionPage>;
