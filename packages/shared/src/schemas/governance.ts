// Comitology / governance meeting log (A4) — per-account governance meetings
// and their assigned actions. Fills the pre-sales visibility gap.
import { z } from 'zod';

import { GovernanceStatus } from './cross-sell.js';

export const GovernanceMeetingType = z.enum([
  'monthly_committee',
  'quarterly_c_level',
  'brm',
  'sar_review',
  'other',
]);
export type GovernanceMeetingType = z.infer<typeof GovernanceMeetingType>;

export const GovernanceAction = z.object({
  id: z.string().uuid(),
  meetingId: z.string().uuid(),
  description: z.string().min(1).max(2000),
  ownerId: z.string().uuid().nullable(),
  ownerName: z.string().nullable(),
  dueDate: z.string().datetime().nullable(),
  status: GovernanceStatus,
  createdAt: z.string().datetime(),
});
export type GovernanceAction = z.infer<typeof GovernanceAction>;

export const GovernanceMeeting = z.object({
  id: z.string().uuid(),
  accountKey: z.string().min(1),
  meetingType: GovernanceMeetingType,
  date: z.string().datetime(),
  participants: z.array(z.string().min(1).max(255)),
  outcomes: z.string().max(8000).nullable(),
  actions: z.array(GovernanceAction),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GovernanceMeeting = z.infer<typeof GovernanceMeeting>;

export const GovernanceActionInput = z.object({
  description: z.string().min(1).max(2000),
  ownerId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  status: GovernanceStatus.default('open'),
});
export type GovernanceActionInput = z.infer<typeof GovernanceActionInput>;

export const GovernanceMeetingCreate = z.object({
  accountKey: z.string().min(1).max(255),
  meetingType: GovernanceMeetingType,
  date: z.string().datetime(),
  participants: z.array(z.string().min(1).max(255)).max(50).default([]),
  outcomes: z.string().max(8000).nullable().optional(),
  actions: z.array(GovernanceActionInput).max(50).default([]),
});
export type GovernanceMeetingCreate = z.infer<typeof GovernanceMeetingCreate>;

export const GovernanceMeetingPatch = z
  .object({
    meetingType: GovernanceMeetingType.optional(),
    date: z.string().datetime().optional(),
    participants: z.array(z.string().min(1).max(255)).max(50).optional(),
    outcomes: z.string().max(8000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type GovernanceMeetingPatch = z.infer<typeof GovernanceMeetingPatch>;

export const GovernanceActionPatch = z
  .object({
    description: z.string().min(1).max(2000).optional(),
    ownerId: z.string().uuid().nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    status: GovernanceStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type GovernanceActionPatch = z.infer<typeof GovernanceActionPatch>;

export const GovernanceMeetingList = z.object({
  items: z.array(GovernanceMeeting),
});
export type GovernanceMeetingList = z.infer<typeof GovernanceMeetingList>;
