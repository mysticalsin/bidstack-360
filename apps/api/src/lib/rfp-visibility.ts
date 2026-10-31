// RFP visibility helper.
//
// Requirement: a regular user sees (and manages) only the RFPs they own;
// admins get the org-wide view (all RFPs + their values + analytics).

import type { FastifyRequest } from 'fastify';

import { canOverrideOwnership } from './org-admin.js';

/**
 * Whether the caller may see and manage every RFP in the org, rather than only
 * the ones they own.
 *
 * Decided by RBAC (`settings:write`, the same org-admin override as saved
 * views, edit locks and crew runs in lib/org-admin.ts), not by the legacy
 * `User.role === 'admin'` column. With the column, a revoked Admin kept the
 * org-wide view and an RBAC-granted Admin without the column never got it.
 * API keys keep the owner-scoped view (they have no owner, so they see none);
 * that is unchanged.
 */
export async function canViewAllRfps(req: FastifyRequest): Promise<boolean> {
  return canOverrideOwnership(req);
}
