import type { Prisma } from '@bidstack/db';

import { applyOpportunityScope, getAccessScope } from './access-scope.js';

/**
 * Where clause for one opportunity the caller may see: same org, not deleted,
 * and inside their M7 access scope. By-id deal routes use it so an
 * out-of-scope deal answers 404 exactly like GET /opportunities/:id.
 */
export async function visibleOpportunityWhere(
  auth: { orgId: string; userId: string },
  id: string,
): Promise<Prisma.OpportunityWhereInput> {
  const scope = await getAccessScope(auth.orgId, auth.userId);
  return applyOpportunityScope({ id, orgId: auth.orgId, deletedAt: null }, scope);
}

/** Relation filter for child rows (bid scores, win/loss) of visible opportunities only. */
export async function visibleOpportunityRelation(auth: {
  orgId: string;
  userId: string;
}): Promise<Prisma.OpportunityWhereInput | undefined> {
  const scope = await getAccessScope(auth.orgId, auth.userId);
  if (scope.unrestricted) return undefined;
  return applyOpportunityScope({ orgId: auth.orgId }, scope);
}
