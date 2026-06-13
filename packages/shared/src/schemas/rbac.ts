// RBAC wire schemas shared by the API and web: the per-user capability manifest
// (what the signed-in user can do) and the role-assignment views (which custom
// roles a user holds + assign/revoke payloads).
import { z } from 'zod';

/**
 * The signed-in user's effective authorization, resolved server-side from their
 * UserRole grants. The frontend uses `permissions` to gate UI instead of the
 * binary admin/member flag, so the product reflects the real RBAC model.
 */
export const CapabilityManifest = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  // Legacy coarse role string on the user row (member | admin).
  legacyRole: z.string(),
  // Names of the granular Roles the user holds.
  roles: z.array(z.string()),
  // Distinct permission keys granted across all of the user's roles.
  permissions: z.array(z.string()),
  isAdmin: z.boolean(),
});
export type CapabilityManifest = z.infer<typeof CapabilityManifest>;

/** A custom role currently granted to a user. */
export const AssignedRole = z.object({
  roleId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
});
export type AssignedRole = z.infer<typeof AssignedRole>;

export const AssignedRoleList = z.object({
  items: z.array(AssignedRole),
});
export type AssignedRoleList = z.infer<typeof AssignedRoleList>;

export const AssignRoleInput = z.object({
  roleId: z.string().uuid(),
});
export type AssignRoleInput = z.infer<typeof AssignRoleInput>;
