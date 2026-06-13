// M7 — access-based data scoping: admin-managed user groups.
// Groups mirror group access in the source systems (ABC, Opportunity
// Management). Until a live connector exists they are maintained by org
// admins in Settings; the future sync writes the same shape.

import { z } from 'zod';

/// ISO-2 country code, normalized to uppercase ("fr" → "FR").
const CountryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Must be an ISO-2 country code');

export const UserGroupMember = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string(),
  createdAt: z.string().datetime(),
});
export type UserGroupMember = z.infer<typeof UserGroupMember>;

export const UserGroup = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  scopeCountries: z.array(z.string()),
  scopeAll: z.boolean(),
  memberCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserGroup = z.infer<typeof UserGroup>;

export const UserGroupWithMembers = UserGroup.extend({
  members: z.array(UserGroupMember),
});
export type UserGroupWithMembers = z.infer<typeof UserGroupWithMembers>;

export const UserGroupCreate = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  scopeCountries: z.array(CountryCode).max(100).default([]),
  scopeAll: z.boolean().default(false),
});
export type UserGroupCreate = z.infer<typeof UserGroupCreate>;

export const UserGroupPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  scopeCountries: z.array(CountryCode).max(100).optional(),
  scopeAll: z.boolean().optional(),
});
export type UserGroupPatch = z.infer<typeof UserGroupPatch>;

export const UserGroupMemberAdd = z.object({
  userId: z.string().uuid(),
});
export type UserGroupMemberAdd = z.infer<typeof UserGroupMemberAdd>;

export const UserGroupList = z.object({
  items: z.array(UserGroup),
});
export type UserGroupList = z.infer<typeof UserGroupList>;
