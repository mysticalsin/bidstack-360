import { z } from 'zod';

export const CasePriority = z.enum(['low', 'medium', 'high', 'critical']);
export type CasePriority = z.infer<typeof CasePriority>;

export const CaseStatus = z.enum([
  'new',
  'open',
  'waiting_customer',
  'waiting_internal',
  'resolved',
  'closed',
  'escalated',
]);
export type CaseStatus = z.infer<typeof CaseStatus>;

export const ServiceCase = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  number: z.string(),
  subject: z.string().min(1),
  description: z.string().nullable(),
  priority: CasePriority,
  status: CaseStatus,
  accountId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  ownerId: z.string().uuid().nullable(),
  ownerName: z.string().nullable(),
  source: z.string(),
  satisfaction: z.number().int().min(1).max(5).nullable(),
  resolvedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  slaDeadline: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ServiceCase = z.infer<typeof ServiceCase>;

export const ServiceCaseFilter = z.object({
  status: CaseStatus.optional(),
  priority: CasePriority.optional(),
  ownerId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ServiceCaseFilter = z.infer<typeof ServiceCaseFilter>;

export const ServiceCaseCreate = ServiceCase.omit({
  id: true,
  orgId: true,
  number: true,
  ownerName: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type ServiceCaseCreate = z.infer<typeof ServiceCaseCreate>;
