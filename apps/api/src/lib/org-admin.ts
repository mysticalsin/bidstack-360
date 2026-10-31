/**
 * Owner-or-admin overrides (saved views, edit locks, crew runs) decided by
 * RBAC, not by the legacy `User.role === 'admin'` column.
 *
 * WHY: the rbac plugin dropped the claim-based admin fallback
 * (docs/adr/0001-rbac-no-claim-fallback.md), but these three owner checks
 * still trusted the legacy column, so a revoked Admin kept moderating other
 * users' resources and an RBAC-granted Admin without the column could not.
 *
 * The override is `settings:write`: org administration, held only by the
 * seeded Admin role (packages/shared/src/types/rbac-matrix.ts). API keys never
 * get an ownership override; they act as a service, not as an org admin.
 */
import type { PermissionKey } from '@bidstack/shared';
import type { FastifyRequest } from 'fastify';

import { userHasPermission } from './rbac-decision-cache.js';

export const ORG_ADMIN_OVERRIDE_PERMISSION: PermissionKey = 'settings:write';

export async function canOverrideOwnership(req: FastifyRequest): Promise<boolean> {
  if (req.auth.role === 'api') return false;
  return userHasPermission(req.auth.orgId, req.auth.userId, ORG_ADMIN_OVERRIDE_PERMISSION);
}
