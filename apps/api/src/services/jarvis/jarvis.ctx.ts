/**
 * Tool context for a Jarvis user. The shared tools only know the org, so the
 * user's REST boundaries travel with the call: company visibility from access
 * groups, the owner-or-admin rule for proposals, and RBAC for the extra
 * resources a composite tool returns.
 */
import type { AgentToolCtx } from '@bidstack/db/agent-tools';

import { companyScopePredicate, getAccessScope } from '../../lib/access-scope.js';
import { ORG_ADMIN_OVERRIDE_PERMISSION } from '../../lib/org-admin.js';
import { userHasPermission } from '../../lib/rbac-decision-cache.js';

export async function jarvisToolCtx(orgId: string, userId: string): Promise<AgentToolCtx> {
  const [scope, viewAllProposals] = await Promise.all([
    getAccessScope(orgId, userId),
    userHasPermission(orgId, userId, ORG_ADMIN_OVERRIDE_PERMISSION),
  ]);
  return {
    orgId,
    userId,
    surface: 'jarvis',
    companyScope: companyScopePredicate(scope),
    viewAllProposals,
    can: (permission) => userHasPermission(orgId, userId, permission),
  };
}
