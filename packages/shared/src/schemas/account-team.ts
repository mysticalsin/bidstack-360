// Account team (internal staffing and allocation) and account follow wire schemas.
import { z } from 'zod';

export const AccountTeamRole = z.enum([
  'account_lead',
  'delivery_lead',
  'pre_sales',
  'bid_manager',
  'executive_sponsor',
  'other',
]);
export type AccountTeamRole = z.infer<typeof AccountTeamRole>;

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const AllocationPct = z.number().int().min(0).max(100);

export const AccountTeamMember = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  role: AccountTeamRole,
  allocationPct: AllocationPct.nullable(),
  startDate: IsoDay.nullable(),
  endDate: IsoDay.nullable(),
  /** The member's allocation summed across every account in the org. */
  totalAllocationPct: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type AccountTeamMember = z.infer<typeof AccountTeamMember>;

export const AccountTeamPerson = z.object({
  userId: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
});
export type AccountTeamPerson = z.infer<typeof AccountTeamPerson>;

export const AccountTeam = z.object({
  /** Company.keyAccountOwnerId, shown as the account lead of record. */
  keyAccountOwner: AccountTeamPerson.nullable(),
  members: z.array(AccountTeamMember),
});
export type AccountTeam = z.infer<typeof AccountTeam>;

function datesInOrder(v: { startDate?: string | null; endDate?: string | null }): boolean {
  return !v.startDate || !v.endDate || v.startDate <= v.endDate;
}

export const AccountTeamMemberCreate = z
  .object({
    userId: z.string().uuid(),
    role: AccountTeamRole,
    allocationPct: AllocationPct.nullable().optional(),
    startDate: IsoDay.nullable().optional(),
    endDate: IsoDay.nullable().optional(),
  })
  .refine(datesInOrder, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type AccountTeamMemberCreate = z.infer<typeof AccountTeamMemberCreate>;

export const AccountTeamMemberPatch = z
  .object({
    role: AccountTeamRole.optional(),
    allocationPct: AllocationPct.nullable().optional(),
    startDate: IsoDay.nullable().optional(),
    endDate: IsoDay.nullable().optional(),
  })
  .refine(datesInOrder, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type AccountTeamMemberPatch = z.infer<typeof AccountTeamMemberPatch>;

export const UserAllocation = z.object({
  userId: z.string().uuid(),
  totalPct: z.number().int().nonnegative(),
  accounts: z.array(
    z.object({
      companyId: z.string().uuid(),
      companyName: z.string(),
      allocationPct: z.number().int().nonnegative(),
    }),
  ),
});
export type UserAllocation = z.infer<typeof UserAllocation>;

export const AccountFollowReason = z.enum([
  'team',
  'key_account_owner',
  'opportunity_owner',
  'explicit',
]);
export type AccountFollowReason = z.infer<typeof AccountFollowReason>;

export const AccountFollowState = z.object({
  /** True when alerts for this account reach the caller. */
  following: z.boolean(),
  muted: z.boolean(),
  reasons: z.array(AccountFollowReason),
});
export type AccountFollowState = z.infer<typeof AccountFollowState>;

export const AccountFollowAction = z.object({
  action: z.enum(['follow', 'unfollow', 'mute', 'unmute']),
});
export type AccountFollowAction = z.infer<typeof AccountFollowAction>;
